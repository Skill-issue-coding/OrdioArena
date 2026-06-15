"""
Stage 7: Build the curated Contexto target word list.

Not all words make good Contexto targets. "de", "ett", "ha" are too
abstract; highly technical or rare terms frustrate players. This script
filters stage 4's general vocabulary and stage 3's entities down to a
list of concrete, recognisable Swedish words that work as game targets.

Input:
  - intermediate/stage4_general/general_words.csv  (word, lemma, pos, Totalt, in_kelly)
  - intermediate/stage3_attrs/*.csv                (entities with wiki_summary / wiki_attributes)
  - intermediate/stage5_encoded/vocab.json         (only words that were actually encoded make it)

Output:
  - server/wordfiles/targets.json   JSON list of target word strings

At runtime the Go backend picks a random entry from this list and calls
CalculateDistance() for every guess — no precomputed rankings needed.
"""

import json
import sys
import logging
from pathlib import Path

import pandas as pd

try:
    from shared import CATEGORY_MAPPING, _is_valid_label
except ImportError:
    CATEGORY_MAPPING: dict = {}
    def _is_valid_label(value: str) -> bool:  # type: ignore[misc]
        import re
        value = (value or "").strip()
        return bool(value) and not value.startswith("http") and not re.match(r"^Q\d+$", value) and any(c.isalpha() for c in value)

BASE_DIR          = Path(__file__).resolve().parent
STAGE3_DIR        = BASE_DIR / "intermediate" / "stage3_attrs"
STAGE4_CSV        = BASE_DIR / "intermediate" / "stage4_general" / "general_words.csv"
VOCAB_FILE        = BASE_DIR / "intermediate" / "stage5_encoded" / "vocab.json"
SEEDING_CLEAN_DIR = BASE_DIR / "intermediate" / "seeding_cleaned"
OUTPUT_DIR        = BASE_DIR.parent / "server" / "wordfiles"
OUT_FILE          = OUTPUT_DIR / "targets.json"

# Only these POS types are interesting as Contexto targets.
# PROPN (proper nouns) come from entities and are included separately.
TARGET_POS = {"NOUN"}

# Must appear at least this often in Korp AND be in Kelly to pass.
MIN_KORP_FREQ = 1_000

# Word length limits — too short = ambiguous, too long = obscure
MIN_WORD_LEN = 4
MAX_WORD_LEN = 20

def _setup_logger() -> logging.Logger:
    log_path = Path(__file__).resolve().parent / "pipeline.log"
    root = logging.getLogger()
    if not any(
        isinstance(h, logging.FileHandler) and h.baseFilename == str(log_path)
        for h in root.handlers
    ):
        handler = logging.FileHandler(log_path, encoding="utf-8")
        handler.setLevel(logging.INFO)
        handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
        root.addHandler(handler)
        root.setLevel(logging.INFO)
    return logging.getLogger(__name__)

log = _setup_logger()


def load_encoded_vocab() -> set[str]:
    """Words that were actually encoded in stage 5 (our source of truth)."""
    if not VOCAB_FILE.exists():
        print(f"Varning: {VOCAB_FILE} saknas — körs utan vocab-filter.")
        return set()
    with VOCAB_FILE.open("r", encoding="utf-8") as f:
        return {w.lower() for w in json.load(f)}


def collect_general_targets(encoded: set[str]) -> list[tuple[str, str]]:
    """Returns [(word, type), …] for general vocabulary targets."""
    if not STAGE4_CSV.exists():
        print(f"Varning: {STAGE4_CSV} saknas — inga generella målord.")
        return []

    df = pd.read_csv(STAGE4_CSV)
    df["Totalt"] = pd.to_numeric(df["Totalt"], errors="coerce").fillna(0)

    mask = (
        df["pos"].isin(TARGET_POS)
        & (df["Totalt"] >= MIN_KORP_FREQ)
        & df["in_kelly"].astype(str).str.lower().isin({"true", "1", "yes"})
        & (df["word"].str.len() >= MIN_WORD_LEN)
        & (df["word"].str.len() <= MAX_WORD_LEN)
    )
    df_filtered = df.loc[mask].copy()
    df_filtered["word"]  = df_filtered["word"].astype(str).str.lower()
    df_filtered["lemma"] = df_filtered["lemma"].astype(str).str.lower()

    # Keep one word per lemma: base form first (word == lemma), then highest frequency.
    df_filtered["is_base"] = df_filtered["word"] == df_filtered["lemma"]
    df_filtered = (
        df_filtered
        .sort_values(["is_base", "Totalt"], ascending=[False, False])
        .drop_duplicates(subset=["lemma"], keep="first")
    )

    words = df_filtered["word"].tolist()

    if encoded:
        words = [w for w in words if w.lower() in encoded]

    return [(w, "general") for w in words]


def collect_entity_targets(encoded: set[str]) -> list[tuple[str, str]]:
    """Returns [(name, type), …] for entity targets."""
    if not STAGE3_DIR.exists():
        return []

    entities = []
    for csv_path in sorted(STAGE3_DIR.glob("*.csv")):
        cat = CATEGORY_MAPPING.get(csv_path.stem, ("general", ""))[0]
        df  = pd.read_csv(csv_path)

        label_col = next((c for c in df.columns if c.endswith("Label")), None)
        if label_col is None:
            label_col = next((c for c in ("name", "word") if c in df.columns), None)
        if label_col is None:
            continue

        for name in df[label_col].dropna().astype(str):
            name = name.strip()
            if not name or not _is_valid_label(name) or len(name) < MIN_WORD_LEN or len(name) > MAX_WORD_LEN:
                continue
            row = df.loc[df[label_col] == name].iloc[0]
            has_context = bool(str(row.get("wiki_summary", "")).strip()) or bool(
                str(row.get("wiki_attributes", "")).strip()
            )
            if not has_context:
                continue
            if encoded and name.lower() not in encoded:
                continue
            entities.append((name, cat))

    return entities


# Minimum notability_score per category to qualify as a game target.
# Entities with score > 0 but below this threshold are known to be obscure.
# Entities with score == 0 are gated by pageviews instead (no sitelinks data available).
MIN_NOTABILITY_BY_CAT: dict[str, float] = {
    "celebrity": 0.08,
    "company":   0.10,
    "media":     0.05,   # Swedish productions score lower on global sitelinks
    "character": 0.03,
    "game":      0.05,
    "culture":   0.03,
    "geography": 0.02,
    "food":      0.02,
}

# Minimum monthly average sv.wikipedia pageviews to accept as a target.
# Applied when notability_score == 0 (no sitelinks/Maktbarometern data).
# Also used as a secondary gate: score_below_threshold AND pageviews_below_min → reject.
MIN_SV_PAGEVIEWS: float = 300.0


def build_pageviews_lookup() -> dict[str, float]:
    """Read sv_pageviews_monthly_avg from all stage3_attrs CSVs."""
    lookup: dict[str, float] = {}
    if not STAGE3_DIR.exists():
        return lookup
    for csv_path in sorted(STAGE3_DIR.glob("*.csv")):
        df = pd.read_csv(csv_path)
        if "sv_pageviews_monthly_avg" not in df.columns:
            continue
        label_col = next((c for c in df.columns if c.endswith("Label")), None)
        if label_col is None:
            continue
        df["sv_pageviews_monthly_avg"] = pd.to_numeric(
            df["sv_pageviews_monthly_avg"], errors="coerce"
        ).fillna(0.0)
        for _, row in df.iterrows():
            name = str(row[label_col]).strip()
            if name:
                key = name.lower()
                val = float(row["sv_pageviews_monthly_avg"])
                if val > lookup.get(key, 0.0):
                    lookup[key] = val
    return lookup


def build_notability_lookup() -> tuple[dict[str, int], dict[str, float]]:
    """
    Scans the cleaned seeding CSVs for sitelinks and maktbarometern_cleaned.csv
    for scores. Returns two name→value dicts (keys lowercased).
    """
    sitelinks_lookup: dict[str, int] = {}
    for csv_path in sorted(SEEDING_CLEAN_DIR.glob("*.csv")):
        if csv_path.name == "maktbarometern_cleaned.csv":
            continue
        df = pd.read_csv(csv_path)
        label_col = next((c for c in df.columns if c.endswith("Label")), None)
        if label_col is None or "sitelinks" not in df.columns:
            continue
        df["sitelinks"] = pd.to_numeric(df["sitelinks"], errors="coerce").fillna(0)
        for _, row in df.iterrows():
            name = str(row[label_col]).strip()
            if not name or name.startswith("http"):
                continue
            sl = int(row["sitelinks"])
            key = name.lower()
            if sl > sitelinks_lookup.get(key, 0):
                sitelinks_lookup[key] = sl

    makt_lookup: dict[str, float] = {}
    makt_path = SEEDING_CLEAN_DIR / "maktbarometern_cleaned.csv"
    if makt_path.exists():
        df = pd.read_csv(makt_path)
        df["score"] = pd.to_numeric(df["score"], errors="coerce").fillna(0)
        for _, row in df.iterrows():
            name = str(row["name"]).strip()
            if name:
                makt_lookup[name.lower()] = float(row["score"])

    return sitelinks_lookup, makt_lookup


def compute_notability_score(
    word: str,
    sitelinks_lookup: dict[str, int],
    makt_lookup: dict[str, float],
    max_sitelinks: int,
    max_makt: float,
) -> float:
    """[0, 1] — average of normalised sitelinks and normalised maktbarometern score."""
    key = word.lower()
    sl_norm   = sitelinks_lookup.get(key, 0) / max_sitelinks if max_sitelinks > 0 else 0.0
    makt_norm = makt_lookup.get(key, 0.0)    / max_makt      if max_makt > 0      else 0.0
    return round((sl_norm + makt_norm) / 2, 4)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    log.info("Stage 7: start")

    encoded = load_encoded_vocab()
    log.info(f"Stage 7: encoded vocab size {len(encoded)}")

    entities = collect_entity_targets(encoded)
    log.info(f"Stage 7: entity targets {len(entities)}")

    general = collect_general_targets(encoded)
    log.info(f"Stage 7: general targets {len(general)}")

    seen: set[str] = set()
    targets: list[dict] = []
    # Entities first so they take priority when a word appears in both lists.
    for word, word_type in entities + general:
        key = word.lower()
        if key not in seen:
            seen.add(key)
            targets.append({"word": word, "type": word_type})

    if not targets:
        print("Inga målord hittades — kontrollera att stage 3 körts och att entiteter har wiki-kontext.")
        sys.exit(1)

    targets.sort(key=lambda t: t["word"].lower())

    # Attach notability scores from Wikidata sitelinks + Maktbarometern.
    sitelinks_lookup, makt_lookup = build_notability_lookup()
    max_sitelinks = max(sitelinks_lookup.values(), default=1)
    max_makt      = max(makt_lookup.values(),      default=1.0)
    for t in targets:
        t["notability_score"] = compute_notability_score(
            t["word"], sitelinks_lookup, makt_lookup, max_sitelinks, max_makt
        )
    notable = sum(1 for t in targets if t["notability_score"] > 0)
    log.info(f"Stage 7: {notable} targets with notability_score > 0")

    # Gate: remove entity targets that are demonstrably obscure.
    # General vocabulary words are never gated — they are common Swedish nouns.
    pageviews_lookup = build_pageviews_lookup()
    has_pageviews    = bool(pageviews_lookup)

    filtered: list[dict] = []
    skipped_score = 0
    skipped_pv    = 0
    for t in targets:
        if t["type"] == "general":
            filtered.append(t)
            continue

        score     = t["notability_score"]
        threshold = MIN_NOTABILITY_BY_CAT.get(t["type"], 0.05)
        pageviews = pageviews_lookup.get(t["word"].lower(), 0.0) if has_pageviews else None

        # Score above threshold → always keep.
        if score >= threshold:
            filtered.append(t)
            continue

        # Score > 0 but below threshold: obscure according to sitelinks/Maktbarometern.
        # Rescue if pageviews show real Swedish readership.
        if score > 0:
            if pageviews is not None and pageviews >= MIN_SV_PAGEVIEWS:
                filtered.append(t)  # high pageviews override low sitelinks
                continue
            skipped_score += 1
            continue

        # Score == 0: no sitelinks data. Rely entirely on pageviews.
        if pageviews is not None:
            if pageviews >= MIN_SV_PAGEVIEWS:
                filtered.append(t)
            else:
                skipped_pv += 1
        else:
            # No pageviews data available yet — keep to avoid over-filtering.
            filtered.append(t)

    log.info(
        f"Stage 7: gating removed {skipped_score} (low score) "
        f"+ {skipped_pv} (low pageviews) targets"
    )
    print(
        f"  Notabilitetsfilter: tog bort {skipped_score} (låg poäng) "
        f"+ {skipped_pv} (låga sidvisningar) entiteter"
    )
    targets = filtered

    with OUT_FILE.open("w", encoding="utf-8") as f:
        json.dump(targets, f, ensure_ascii=False, indent=2)
    log.info(f"Stage 7: wrote {OUT_FILE} ({len(targets)})")

    cats: dict[str, int] = {}
    for t in targets:
        cats[t["type"]] = cats.get(t["type"], 0) + 1
    breakdown = "  ".join(f"{c}: {n:,}" for c, n in sorted(cats.items()))
    print(f"Klar! {len(targets):,} målord sparade till {OUT_FILE}")
    print(f"  {breakdown}")
    print(f"  {notable:,} målord med notabilitetspoäng > 0")
    print("Kör stage_9.py för att berika med likhetsmetadata och impostorkandidater.")


if __name__ == "__main__":
    main()
