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

       antihive_threshold   Cosine *distance* at rank 500 — the natural boundary
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
  - intermediate/stage5_encoded/sources.json  (optional — for impostor category match)
  - intermediate/stage5_encoded/lemma_map.json

Output (overwrites server/wordfiles/targets.json):
  - Enriched JSON list, same words, extra metadata fields per entry.
"""

import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd

BASE_DIR    = Path(__file__).resolve().parent
EMB_FILE    = BASE_DIR / "intermediate" / "stage5_encoded" / "embeddings.npy"
VOCAB_FILE  = BASE_DIR / "intermediate" / "stage5_encoded" / "vocab.json"
SRC_FILE    = BASE_DIR / "intermediate" / "stage5_encoded" / "sources.json"
LEMMA_FILE  = BASE_DIR / "intermediate" / "stage5_encoded" / "lemma_map.json"
TARGET_FILE = BASE_DIR.parent / "server" / "wordfiles" / "targets.json"
KORP_CSV    = BASE_DIR / "intermediate" / "korp_cleaned" / "korp_combined_cleaned.csv"

# ── Cone quality thresholds ────────────────────────────────────────────────────
# cone_width = sim@rank10 − sim@rank500  (how much similarity drops across the ranking)
# Too small → all words cluster at the same distance (boring, easy to guess by luck)
# Too large → almost nothing is close to the target (frustrating, players feel lost)
MIN_TOP10_SIM  = 0.55   # the 10th-nearest word must be at least this similar
MIN_CONE_WIDTH = 0.06   # minimum required drop from rank 10 to rank 500
MAX_CONE_WIDTH = 0.72   # maximum allowed drop

# ── Impostor candidate selection ──────────────────────────────────────────────
IMPOSTOR_MIN_SIM       = 0.50   # similar enough to confuse the impostor
IMPOSTOR_MAX_SIM       = 0.80   # distinct enough to not give the game away
IMPOSTOR_MAX_SEARCH    = 500    # look at this many nearest neighbours per target
IMPOSTOR_MAX_CANDIDATES = 12    # store at most this many candidates

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
            print(f"  Varning: sources.json har fel längd ({len(loaded_src)} ≠ {n}) — ignoreras för impostorkandidater.")

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
            log.warning(f"Stage 9: '{t['word']}' saknas i vocab — hoppas över")
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
            # Collect all qualifying neighbours, then sort by Korp frequency
            # descending so the impostor receives a broader/more general word.
            raw_candidates: list[tuple[str, int]] = []
            for k in range(1, min(IMPOSTOR_MAX_SEARCH, cap)):
                c_idx = int(sorted_idx[k])
                c_sim = float(sim_row[c_idx])

                if c_sim < IMPOSTOR_MIN_SIM:
                    break  # sorted descending, nothing further qualifies

                if c_sim > IMPOSTOR_MAX_SIM:
                    continue  # too close — would give the game away

                c_word  = vocab[c_idx]
                c_lower = c_word.lower()
                c_lemma = lemma_map.get(c_lower, c_lower)

                if c_lemma == t_lemma:
                    continue  # morphological variant of the target
                if t_lower in c_lower or c_lower in t_lower:
                    continue  # substring overlap

                if sources is not None:
                    c_type = sources[c_idx]
                    if c_type != t_type and c_type != "general" and t_type != "general":
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
