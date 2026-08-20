"""
Stage 6: Export encoded embeddings to binary format for the Go backend.

Wikipedia2Vec is a symmetric space, a single embedding file suffices.
dual is always false and vocab_query.bin is never written.

Input:
  - intermediate/stage5_encoded/embeddings.npy   (float32, shape Nx300)
  - intermediate/stage5_encoded/vocab.json        (list of N word strings)
  - intermediate/stage5_encoded/lemma_map.json    ({surface: lemma}, optional)

Output (server/wordfiles/):
  - vocab.bin        raw little-endian float32, Nx300
  - vocab.json       JSON list of N canonical word strings
  - meta.json        {"n": N, "dims": 300, "dual": false}
  - sources.json     category per entry (if produced by stage 5)
  - lemma_map.json   surface→lemma map (if produced by stage 5)
"""

import json
import sys
import logging
from pathlib import Path

import numpy as np

BASE_DIR   = Path(__file__).resolve().parent
INPUT_DIR  = BASE_DIR / "intermediate" / "stage5_encoded"
OUTPUT_DIR = BASE_DIR.parent / "server" / "wordfiles"

EMB_FILE      = INPUT_DIR  / "embeddings.npy"
VOCAB_FILE    = INPUT_DIR  / "vocab.json"
SOURCES_FILE  = INPUT_DIR  / "sources.json"
LEMMA_FILE    = INPUT_DIR  / "lemma_map.json"

OUT_BIN      = OUTPUT_DIR / "vocab.bin"
OUT_VOCAB    = OUTPUT_DIR / "vocab.json"
OUT_META     = OUTPUT_DIR / "meta.json"
OUT_SOURCES  = OUTPUT_DIR / "sources.json"
OUT_LEMMA    = OUTPUT_DIR / "lemma_map.json"

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


def main():
    # ── Validate inputs ───────────────────────────────────────────────────────
    if not EMB_FILE.exists():
        print(f"Fel: {EMB_FILE} saknas. Kör stage 5 först.")
        sys.exit(1)
    if not VOCAB_FILE.exists():
        print(f"Fel: {VOCAB_FILE} saknas. Kör stage 5 först.")
        sys.exit(1)

    log.info("Stage 6: start")
    log.info(f"Input embeddings: {EMB_FILE}")
    log.info(f"Input vocab: {VOCAB_FILE}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── Load ──────────────────────────────────────────────────────────────────
    print("Laddar embeddings…")
    embeddings = np.load(str(EMB_FILE))          # float32, (N, D)

    with VOCAB_FILE.open("r", encoding="utf-8") as f:
        vocab = json.load(f)                     # list[str], length N

    n, dims = embeddings.shape
    print(f"  {n:,} ord, {dims} dimensioner")
    log.info(f"Stage 6: loaded {n} vectors dims={dims}")

    if len(vocab) != n:
        print(f"Fel: vocab har {len(vocab)} poster men embeddings har {n} rader.")
        sys.exit(1)

    # ── Write vocab.bin ───────────────────────────────────────────────────────
    data = embeddings.astype("<f4")
    print(f"Skriver {OUT_BIN} ({data.nbytes / 1_048_576:.1f} MB)…")
    with OUT_BIN.open("wb") as f:
        f.write(data.tobytes())
    log.info(f"Stage 6: wrote {OUT_BIN}")

    # ── Write vocab.json ──────────────────────────────────────────────────────
    print(f"Skriver {OUT_VOCAB}…")
    with OUT_VOCAB.open("w", encoding="utf-8") as f:
        json.dump(vocab, f, ensure_ascii=False)
    log.info(f"Stage 6: wrote {OUT_VOCAB}")

    # ── Write meta.json (dual always false, Wikipedia2Vec is symmetric) ──────
    meta = {"n": n, "dims": dims, "dual": False}
    with OUT_META.open("w", encoding="utf-8") as f:
        json.dump(meta, f)
    print(f"Skriver {OUT_META}: {meta}")
    log.info(f"Stage 6: wrote {OUT_META} {meta}")

    # ── Write sources.json (optional) ────────────────────────────────────────
    if SOURCES_FILE.exists():
        with SOURCES_FILE.open("r", encoding="utf-8") as f:
            sources = json.load(f)
        with OUT_SOURCES.open("w", encoding="utf-8") as f:
            json.dump(sources, f, ensure_ascii=False)
        print(f"Skriver {OUT_SOURCES}…")
        log.info(f"Stage 6: wrote {OUT_SOURCES}")

    # ── Write lemma_map.json (optional) ──────────────────────────────────────
    if LEMMA_FILE.exists():
        with LEMMA_FILE.open("r", encoding="utf-8") as f:
            lemma_map = json.load(f)
        with OUT_LEMMA.open("w", encoding="utf-8") as f:
            json.dump(lemma_map, f, ensure_ascii=False)
        print(f"Skriver {OUT_LEMMA} ({len(lemma_map)} poster)…")
        log.info(f"Stage 6: wrote {OUT_LEMMA} ({len(lemma_map)} entries)")

    # ── Sanity check: round-trip one vector ──────────────────────────────────
    raw = OUT_BIN.read_bytes()
    first_vec = np.frombuffer(raw[:dims * 4], dtype="<f4")
    if not np.allclose(first_vec, embeddings[0], atol=1e-6):
        print("VARNING: round-trip-kontroll misslyckades, binärfilen kan vara korrupt.")
        sys.exit(1)

    print(f"\nKlar! {n:,} vektorer exporterade till {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
