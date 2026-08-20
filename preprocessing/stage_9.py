"""
Stage 9: Target quality enrichment.

Loads the embeddings from stage 5 and the target list from stage 7, then for
every target:

  1. Computes the full cosine-similarity ranking against the whole vocabulary.
  2. Filters out targets whose similarity distribution is too concentrated
     (all words equally close → boring) or too diffuse (nothing close → frustrating).
  3. Attaches per-target metadata that the Go backend uses at runtime:

       sim_at_rank          Similarity value at ranks 10 / 50 / 100 / 500 / 1000.
                            Lets Contexto show calibrated hot/warm/cold hints that
                            are meaningful regardless of target word.

       antihive_threshold   Cosine *distance* at rank 500, the natural boundary
                            for "this word is related enough to count" in Anti-Hivemind.
                            Replaces the single global MaxDistance constant.

       impostor_candidates  Up to 12 same-category words with similarity in
                            [IMPOSTOR_MIN_SIM, IMPOSTOR_MAX_SIM]. Impostor mode
                            picks from here instead of doing an expensive runtime
                            search that can fail.

Inputs:
  - server/wordfiles/targets.json             (stage 7)
  - intermediate/stage5_encoded/embeddings.npy
  - intermediate/stage5_encoded/vocab.json
  - intermediate/stage5_encoded/sources.json  (optional, for impostor category match)
  - intermediate/stage5_encoded/lemma_map.json

Output (overwrites server/wordfiles/targets.json):
  - Enriched JSON list, same words, extra metadata fields per entry.
"""

import json
import logging
from pathlib import Path
import re
from collections import Counter

import numpy as np
import pandas as pd

BASE_DIR    = Path(__file__).resolve().parent
EMB_FILE    = BASE_DIR / "intermediate" / "stage5_encoded" / "embeddings.npy"
VOCAB_FILE  = BASE_DIR / "intermediate" / "stage5_encoded" / "vocab.json"
SRC_FILE    = BASE_DIR / "intermediate" / "stage5_encoded" / "sources.json"
LEMMA_FILE  = BASE_DIR / "intermediate" / "stage5_encoded" / "lemma_map.json"
TARGET_FILE = BASE_DIR.parent / "server" / "wordfiles" / "targets.json"
KORP_CSV    = BASE_DIR / "intermediate" / "korp_cleaned" / "korp_combined_cleaned.csv"
STAGE3_ATTRS_DIR = BASE_DIR / "intermediate" / "stage3_attrs"

# ── Cone quality thresholds ────────────────────────────────────────────────────
# cone_width = sim@rank10 − sim@rank500  (how much similarity drops across the ranking)
# Too small → all words cluster at the same distance (boring, easy to guess by luck)
# Too large → almost nothing is close to the target (frustrating, players feel lost)
MIN_TOP10_SIM  = 0.55   # the 10th-nearest word must be at least this similar
MIN_CONE_WIDTH = 0.06   # minimum required drop from rank 10 to rank 500
MAX_CONE_WIDTH = 0.72   # maximum allowed drop

# ── Impostor candidate selection ──────────────────────────────────────────────
IMPOSTOR_MIN_SIM       = 0.50   # similar enough to confuse the impostor (used for general targets)
IMPOSTOR_MAX_SIM       = 0.80   # distinct enough to not give the game away (used for general targets)
IMPOSTOR_MAX_SEARCH    = 500    # look at this many nearest neighbours per target
IMPOSTOR_MAX_CANDIDATES = 12    # store at most this many candidates

# For entity targets (company / celebrity / game) the neighbour-search approach
# surfaces specific peer entities (other brands, other DJs) rather than broad
# category descriptors.  Instead we pick from this curated pool of domain words
# and rank them by similarity to the specific target, so Sony gets "konsol" and
# "dator" before "bil", while Google gets "söktjänst" and "webbtjänst" first.
#
# Candidates are kept if they rank in the top IMPOSTOR_POOL_GUARANTEED positions
# OR their similarity is at least IMPOSTOR_POOL_MIN_SIM.  This prevents weakly-
# related words from padding the list while still guaranteeing a minimum number
# of candidates for niche entities with low overall similarity to the pool.
IMPOSTOR_POOL_MIN_SIM    = 0.35   # exclude pool words below this sim (beyond guaranteed)
IMPOSTOR_POOL_GUARANTEED = 4      # always keep this many top-sim pool words regardless
ENTITY_DESCRIPTOR_POOL: dict[str, list[str]] = {
    "company": [
        "telefon", "telefoner", "dator", "datorer", "internet", "söktjänst",
        "webbtjänst", "bolag", "företag", "tjänst", "produkt", "industri",
        "handel", "affär", "märke", "musik", "film", "underhållning", "kläder",
        "bil", "konsol", "spel", "streaming", "butik", "bank", "försäkring",
        "media", "kamera", "programvara", "programmet", "livsmedel",
        "läkemedel", "energi", "olja", "stål", "verkstad", "transport",
    ],
    "celebrity": [
        "musik", "artist", "kändis", "sång", "album", "konsert", "låtar",
        "sångare", "film", "skådespelare", "sport", "fotboll", "ishockey",
        "tennis", "friidrott", "television", "serie", "underhållning",
        "kultur", "mode", "media", "journalist", "politiker", "komiker",
        "influencer", "youtuber", "rappare",
    ],
    "game": [
        "datorspel", "konsol", "spel", "äventyr", "action", "rollspel",
        "strategi", "pussel", "underhållning", "online", "multiplayer",
        "videospel",
    ],
}

# Augment the descriptor pool by mining frequent, general-purpose words from
# the stage3 attribute CSVs (wiki_summary / wiki_attributes). This helps align
# the pool with the actual entity data without hard-coding everything.
ENTITY_ATTR_SOURCES: dict[str, list[str]] = {
    "company": ["global_brands.csv", "swedish_companies.csv"],
    "celebrity": ["swedish_celebrities.csv", "swedish_music.csv"],
    "game": ["video_games.csv"],
}

POOL_STOPWORDS = {
    "och", "att", "som", "den", "det", "de", "en", "ett", "i", "av", "på",
    "för", "med", "till", "är", "har", "var", "från", "samt", "om", "vid",
    "där", "även", "kan", "bland", "under", "över", "sina", "hans", "hennes",
    "sin", "sitt", "sina", "mellan", "efter", "före", "sedan",
}
MIN_POOL_TOKEN_LEN = 3
MIN_POOL_KORP_FREQ = 20
DYNAMIC_POOL_MAX = 40

# Slurs / profanity that must never be surfaced to players as impostor words,
# regardless of how frequent they are in the (casual-register) Korp corpus.
# These slip past POS / frequency / stopword filters, flashback/familjeliv text
# makes them common. Exact lowercased-token match. Extend as playtests surface more.
PROFANITY_BLOCKLIST: set[str] = {
    "svartskalle", "svartskallar", "blatte", "blattar", "neger", "negern", "negrer",
    "hora", "horan", "horor", "fitta", "fittan", "fittor", "bitterfitta", "bitterfittan",
    "kuk", "kuken", "kukar", "knulla", "knullar", "fitt", "cp", "mongo", "mongon",
    "bög", "bögen", "bögar", "fjolla", "subba", "subban", "slyna", "slynan",
    "pucko", "idiot", "idioten", "jävla", "jävlar", "helvete", "satan", "fan",
    "kärring", "kärringen", "våldtäkt", "våldta",
}

# ── Rank markers written to targets.json ─────────────────────────────────────
RANK_MARKERS = [10, 50, 100, 500, 1000]

BATCH_SIZE = 128


def _setup_logger() -> logging.Logger:
    log_path = BASE_DIR / "pipeline.log"
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


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-zA-ZåäöÅÄÖ]+", text.lower())


def _build_dynamic_descriptor_pool(
    kind: str,
    word_to_idx: dict[str, int],
    sources: list[str] | None,
    korp_freq: dict[str, int],
) -> list[str]:
    csv_names = ENTITY_ATTR_SOURCES.get(kind, [])
    if not csv_names:
        return []

    counts: Counter[str] = Counter()
    for name in csv_names:
        path = STAGE3_ATTRS_DIR / name
        if not path.exists():
            continue
        df = pd.read_csv(path)
        cols = [c for c in ("wiki_summary", "wiki_attributes") if c in df.columns]
        if not cols:
            continue
        for col in cols:
            for raw in df[col].dropna().astype(str):
                for tok in _tokenize(raw):
                    if len(tok) < MIN_POOL_TOKEN_LEN or tok in POOL_STOPWORDS:
                        continue
                    if tok in PROFANITY_BLOCKLIST:
                        continue
                    idx = word_to_idx.get(tok)
                    if idx is None:
                        continue
                    if sources is not None and sources[idx] != "general":
                        continue
                    if korp_freq and korp_freq.get(tok, 0) < MIN_POOL_KORP_FREQ:
                        continue
                    counts[tok] += 1

    if not counts:
        return []

    ranked = sorted(
        counts.items(),
        key=lambda kv: (kv[1], korp_freq.get(kv[0], 0)),
        reverse=True,
    )
    return [w for w, _ in ranked[:DYNAMIC_POOL_MAX]]


log = _setup_logger()


def main() -> None:
    for p in (EMB_FILE, VOCAB_FILE, TARGET_FILE):
        if not p.exists():
            print(f"Fel: {p} saknas. Kör föregående steg först.")
            raise SystemExit(1)

    log.info("Stage 9: start")

    # ── Load embeddings + vocab ───────────────────────────────────────────────
    print("Laddar embeddings…")
    embeddings = np.load(str(EMB_FILE))      # (N, D), float32, L2-normalised
    n, dims = embeddings.shape
    print(f"  {n:,} ord, {dims} dimensioner")

    with VOCAB_FILE.open("r", encoding="utf-8") as f:
        vocab: list[str] = json.load(f)

    word_to_idx: dict[str, int] = {w.lower(): i for i, w in enumerate(vocab)}

    # ── Load sources (category per vocab entry) ───────────────────────────────
    sources: list[str] | None = None
    if SRC_FILE.exists():
        with SRC_FILE.open("r", encoding="utf-8") as f:
            loaded_src: list[str] = json.load(f)
        if len(loaded_src) == n:
            sources = loaded_src
        else:
            print(f"  Varning: sources.json har fel längd ({len(loaded_src)} ≠ {n}), ignoreras för impostorkandidater.")

    # ── Load lemma map ────────────────────────────────────────────────────────
    lemma_map: dict[str, str] = {}
    if LEMMA_FILE.exists():
        with LEMMA_FILE.open("r", encoding="utf-8") as f:
            lemma_map = json.load(f)

    # ── Load Korp frequencies (used to prefer broader impostor candidates) ────
    korp_freq: dict[str, int] = {}
    if KORP_CSV.exists():
        kf = pd.read_csv(KORP_CSV, header=0)
        kf.columns = ["word", "freq"]
        kf["freq"] = pd.to_numeric(kf["freq"], errors="coerce").fillna(0)
        korp_freq = {str(w).lower(): int(f) for w, f in zip(kf["word"], kf["freq"])}
        print(f"  Korp-frekvenser: {len(korp_freq):,} ord")

    # ── Load targets ──────────────────────────────────────────────────────────
    with TARGET_FILE.open("r", encoding="utf-8") as f:
        raw = json.load(f)

    if raw and isinstance(raw[0], str):
        targets: list[dict] = [{"word": w, "type": "general"} for w in raw]
    else:
        targets = raw

    # Strip any previously computed metadata so we can recompute cleanly.
    for t in targets:
        t.pop("sim_at_rank", None)
        t.pop("antihive_threshold", None)
        t.pop("impostor_candidates", None)

    print(f"  {len(targets):,} målord inlästa")

    # Map each target to its embedding index; skip targets not in vocab.
    valid_targets: list[dict] = []
    valid_idxs:   list[int]  = []
    for t in targets:
        idx = word_to_idx.get(t["word"].lower())
        if idx is None:
            log.warning(f"Stage 9: '{t['word']}' saknas i vocab, hoppas över")
            continue
        valid_targets.append(t)
        valid_idxs.append(idx)

    print(f"  {len(valid_targets):,} målord finns i vocab")

    # ── Batch-compute similarities + enrich ───────────────────────────────────
    print(f"\nBeräknar likhetsfördelning per målord (batch={BATCH_SIZE})…")
    enriched: list[dict] = []
    dropped_top10    = 0
    dropped_cone     = 0
    n_batches = (len(valid_targets) + BATCH_SIZE - 1) // BATCH_SIZE

    for b in range(n_batches):
        sl = slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE)
        batch_idxs  = valid_idxs[sl]
        batch_items = valid_targets[sl]

        target_vecs = embeddings[batch_idxs]              # (B, D)
        sims = (target_vecs @ embeddings.T).astype(float) # (B, N)

        for j, (item, sim_row) in enumerate(zip(batch_items, sims)):
            t_idx        = batch_idxs[j]
            t_lower      = item["word"].lower()
            t_lemma      = lemma_map.get(t_lower, t_lower)
            t_type       = item.get("type", "general")

            # Exclude self from ranking.
            sim_row[t_idx] = -2.0
            sorted_idx = np.argsort(-sim_row)
            cap = len(sorted_idx)

            # ── Cone quality ─────────────────────────────────────────────────
            sim10  = float(sim_row[sorted_idx[min(RANK_MARKERS[0]  - 1, cap - 1)]])
            sim500 = float(sim_row[sorted_idx[min(RANK_MARKERS[3]  - 1, cap - 1)]])
            cone   = sim10 - sim500

            if sim10 < MIN_TOP10_SIM:
                dropped_top10 += 1
                continue
            if not (MIN_CONE_WIDTH <= cone <= MAX_CONE_WIDTH):
                dropped_cone += 1
                continue

            # ── Rank markers ─────────────────────────────────────────────────
            sim_at_rank: dict[str, float] = {}
            for rank in RANK_MARKERS:
                r_idx = min(rank - 1, cap - 1)
                sim_at_rank[str(rank)] = round(float(sim_row[sorted_idx[r_idx]]), 4)

            antihive_threshold = round(1.0 - sim_at_rank["500"], 4)

            # ── Impostor candidates ───────────────────────────────────────────
            # Entity types (company / celebrity / game): pick from a curated pool
            # of broad domain words, ranked by similarity to this specific target.
            # This surfaces "artist", "musik", "konsert" for Avicii rather than
            # peer-entity names like "tiesto" or "guetta".
            #
            # General targets: use the original nearest-neighbour search so that
            # abstract concepts still get semantically adjacent peer words.
            descriptor_pool = ENTITY_DESCRIPTOR_POOL.get(t_type)
            if descriptor_pool is not None:
                pool_candidates: list[tuple[str, float]] = []
                for c_word in descriptor_pool:
                    c_lower = c_word.lower()
                    c_idx   = word_to_idx.get(c_lower)
                    if c_idx is None:
                        continue
                    c_lemma = lemma_map.get(c_lower, c_lower)
                    if c_lemma == t_lemma:
                        continue
                    if t_lower in c_lower or c_lower in t_lower:
                        continue
                    if c_lower in PROFANITY_BLOCKLIST:
                        continue
                    pool_candidates.append((c_word, float(sim_row[c_idx])))
                pool_candidates.sort(key=lambda x: x[1], reverse=True)
                candidates = []
                for rank, (c_word, c_sim) in enumerate(pool_candidates):
                    if rank < IMPOSTOR_POOL_GUARANTEED or c_sim >= IMPOSTOR_POOL_MIN_SIM:
                        candidates.append(c_word)
                    if len(candidates) >= IMPOSTOR_MAX_CANDIDATES:
                        break
            else:
                # Original nearest-neighbour search for general targets.
                raw_candidates: list[tuple[str, int]] = []
                for k in range(1, min(IMPOSTOR_MAX_SEARCH, cap)):
                    c_idx = int(sorted_idx[k])
                    c_sim = float(sim_row[c_idx])

                    if c_sim < IMPOSTOR_MIN_SIM:
                        break  # sorted descending, nothing further qualifies

                    if c_sim > IMPOSTOR_MAX_SIM:
                        continue  # too close, would give the game away

                    c_word  = vocab[c_idx]
                    c_lower = c_word.lower()
                    c_lemma = lemma_map.get(c_lower, c_lower)

                    if c_lemma == t_lemma:
                        continue  # morphological variant of the target
                    if t_lower in c_lower or c_lower in t_lower:
                        continue  # substring overlap
                    if c_lower in PROFANITY_BLOCKLIST:
                        continue  # never surface slurs to players

                    # Only common-vocabulary words make good fallback impostors.
                    # Other entities (PROPN) here are peer names, for a target like
                    # "Zlatan" the nearest neighbours are footballer/Balkan names and
                    # casual-corpus slang, which read as garbage. Restrict to the
                    # "general" source so culture/general targets get real words.
                    if sources is not None and sources[c_idx] != "general":
                        continue

                    raw_candidates.append((c_word, korp_freq.get(c_lower, 0)))

                raw_candidates.sort(key=lambda x: x[1], reverse=True)
                candidates = [w for w, _ in raw_candidates[:IMPOSTOR_MAX_CANDIDATES]]

            entry = dict(item)
            entry["sim_at_rank"]         = sim_at_rank
            entry["antihive_threshold"]  = antihive_threshold
            entry["impostor_candidates"] = candidates
            enriched.append(entry)

        done = min((b + 1) * BATCH_SIZE, len(valid_targets))
        if (b + 1) % 10 == 0 or b == n_batches - 1:
            print(f"  {done:,}/{len(valid_targets):,} behandlade  →  {len(enriched):,} godkända")

    # ── Report ────────────────────────────────────────────────────────────────
    print(f"\nResultat:")
    print(f"  Inlästa målord:             {len(valid_targets):,}")
    print(f"  Filtrerade (svag topp-10):  {dropped_top10:,}")
    print(f"  Filtrerade (dålig kon):     {dropped_cone:,}")
    print(f"  Godkända målord:            {len(enriched):,}")

    no_imp = sum(1 for t in enriched if not t["impostor_candidates"])
    print(f"  Utan impostorkandidater:    {no_imp:,}  (hanteras via fallback)")

    log.info(
        f"Stage 9: {len(enriched)} targets kept "
        f"(dropped top10={dropped_top10} cone={dropped_cone})"
    )

    if not enriched:
        print(
            "\nFel: inga målord klarade filtret. "
            "Justera MIN_TOP10_SIM / MIN_CONE_WIDTH / MAX_CONE_WIDTH och kör om."
        )
        raise SystemExit(1)

    enriched.sort(key=lambda t: t["word"].lower())

    with TARGET_FILE.open("w", encoding="utf-8") as f:
        json.dump(enriched, f, ensure_ascii=False, indent=2)

    log.info(f"Stage 9: wrote {TARGET_FILE} ({len(enriched)} targets)")
    print(f"\nKlar! {len(enriched):,} berikade målord sparade till {TARGET_FILE}")


if __name__ == "__main__":
    main()
