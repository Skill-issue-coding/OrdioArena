"""
Stage 8: Post-process encoded vocabulary for the server.

Two optional reductions can be combined:

  --dims D     PCA-reduce from the original embedding dimension (1024 for E5)
               down to D before export. Vectors are re-normalised after
               projection so cosine similarity (= dot product) still works.
               Halves vocab.bin size at --dims 512.

  --top-k K    Keep only the K nearest neighbours of each Contexto target.
               NOTE: with 7 000+ diverse targets this has almost no effect —
               every word in the vocab ends up near some target. Only useful
               when the target list is small (< ~500 words).

Inputs:
  - intermediate/stage5_encoded/embeddings.npy   (float32, NxD, L2-normalised)
  - intermediate/stage5_encoded/vocab.json        (list of N strings)
  - server/wordfiles/targets.json                 (list of T target strings)

Output (overwrites stage-6 output):
  - server/wordfiles/vocab.bin    raw little-endian float32, MxD'
  - server/wordfiles/vocab.json   list of M canonical word strings
  - server/wordfiles/meta.json    {"n": M, "dims": D'}

Usage:
  python stage_8.py                      # export as-is (same as stage 6)
  python stage_8.py --dims 512           # PCA to 512 dims  (~625 MB)
  python stage_8.py --dims 256           # PCA to 256 dims  (~312 MB)
  python stage_8.py --dims 512 --top-k 50
"""

import argparse
import json
import logging
import sys
from pathlib import Path

import numpy as np

BASE_DIR    = Path(__file__).resolve().parent
INPUT_DIR   = BASE_DIR / "intermediate" / "stage5_encoded"
OUTPUT_DIR  = BASE_DIR.parent / "server" / "wordfiles"

EMB_FILE       = INPUT_DIR  / "embeddings.npy"
EMB_QUERY_FILE = INPUT_DIR  / "embeddings_query.npy"
VOCAB_FILE     = INPUT_DIR  / "vocab.json"
SOURCES_FILE   = INPUT_DIR  / "sources.json"
TARGET_FILE    = OUTPUT_DIR / "targets.json"

OUT_BIN       = OUTPUT_DIR / "vocab.bin"
OUT_QUERY_BIN = OUTPUT_DIR / "vocab_query.bin"
OUT_VOCAB     = OUTPUT_DIR / "vocab.json"
OUT_META      = OUTPUT_DIR / "meta.json"
OUT_SOURCES   = OUTPUT_DIR / "sources.json"

BATCH_SIZE = 128  # targets per matmul for top-K step


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


def reduce_dims(embeddings: np.ndarray, target_dims: int) -> np.ndarray:
    """PCA-reduce embeddings to target_dims and re-normalise to unit length."""
    n, d = embeddings.shape
    if target_dims >= d:
        return embeddings

    print(f"\nPCA: {d} → {target_dims} dimensioner ({n:,} vektorer)…")
    log.info(f"Stage 8: PCA {d} → {target_dims}")

    try:
        from sklearn.decomposition import TruncatedSVD
    except ImportError:
        print("scikit-learn saknas. Kör: pip install scikit-learn")
        sys.exit(1)

    svd = TruncatedSVD(n_components=target_dims, algorithm="randomized", n_iter=5, random_state=42)
    reduced = svd.fit_transform(embeddings)          # (N, target_dims), float64

    # Re-normalise so dot product == cosine similarity
    norms = np.linalg.norm(reduced, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1.0, norms)
    reduced /= norms

    explained = svd.explained_variance_ratio_.sum() * 100
    print(f"  Förklarad varians: {explained:.1f}%")
    log.info(f"Stage 8: PCA explained variance {explained:.1f}%")

    return reduced.astype(np.float32)


def main():
    parser = argparse.ArgumentParser(description="Stage 8: post-process vocab for server.")
    parser.add_argument("--dims", type=int, default=None,
                        help="PCA-reduce to this many dimensions (e.g. 512). Default: keep original.")
    parser.add_argument("--top-k", type=int, default=None,
                        help="Keep only top-K nearest neighbours per target. "
                             "Has little effect when there are thousands of targets.")
    args = parser.parse_args()

    # ── Validate inputs ───────────────────────────────────────────────────────
    for p in (EMB_FILE, VOCAB_FILE, TARGET_FILE):
        if not p.exists():
            print(f"Fel: {p} saknas. Kör föregående steg först.")
            sys.exit(1)

    log.info(f"Stage 8: start dims={args.dims} top_k={args.top_k}")

    # ── Load ──────────────────────────────────────────────────────────────────
    print("Laddar embeddings…")
    embeddings = np.load(str(EMB_FILE))      # (N, D), float32
    n, dims = embeddings.shape
    print(f"  {n:,} ord, {dims} dimensioner  ({embeddings.nbytes / 1_048_576:.0f} MB)")
    log.info(f"Stage 8: loaded embeddings {n}x{dims}")

    with VOCAB_FILE.open("r", encoding="utf-8") as f:
        vocab: list[str] = json.load(f)
    if len(vocab) != n:
        print(f"Fel: vocab har {len(vocab)} poster men embeddings har {n} rader.")
        sys.exit(1)

    sources: list[str] | None = None
    if SOURCES_FILE.exists():
        with SOURCES_FILE.open("r", encoding="utf-8") as f:
            loaded_sources: list[str] = json.load(f)
        if len(loaded_sources) != n:
            print(f"Varning: sources.json har {len(loaded_sources)} poster men vocab har {n}, ignoreras.")
        else:
            sources = loaded_sources

    # Load query embeddings if produced by stage 5
    embeddings_query: np.ndarray | None = None
    if EMB_QUERY_FILE.exists():
        print("Laddar query-embeddings…")
        eq = np.load(str(EMB_QUERY_FILE))
        if eq.shape != embeddings.shape:
            print(f"Varning: query-embeddings har fel form {eq.shape} (förväntat {embeddings.shape}), ignoreras.")
        else:
            embeddings_query = eq
            log.info(f"Stage 8: loaded query embeddings {eq.shape}")

    with TARGET_FILE.open("r", encoding="utf-8") as f:
        targets_raw = json.load(f)
    # Handle both old format (list[str]) and new format (list[{"word":…,"type":…}])
    if targets_raw and isinstance(targets_raw[0], dict):
        targets: list[str] = [t["word"] for t in targets_raw]
    else:
        targets = targets_raw
    print(f"  {len(targets):,} målord")
    log.info(f"Stage 8: {len(targets)} targets")

    # ── Optional top-K vocabulary filter ─────────────────────────────────────
    if args.top_k is not None:
        top_k = args.top_k
        key_to_idx: dict[str, int] = {w.lower(): i for i, w in enumerate(vocab)}
        target_indices = [key_to_idx[t.lower()] for t in targets if t.lower() in key_to_idx]
        missing_count = len(targets) - len(target_indices)
        if missing_count:
            print(f"  Varning: {missing_count} målord saknas i vocab.")
        print(f"\nBeräknar topp-{top_k} grannar per målord (batch={BATCH_SIZE})…")
        keep: set[int] = set(target_indices)
        total_batches = (len(target_indices) + BATCH_SIZE - 1) // BATCH_SIZE
        for batch_num, i in enumerate(range(0, len(target_indices), BATCH_SIZE), 1):
            batch_emb = embeddings[target_indices[i : i + BATCH_SIZE]]
            sims      = batch_emb @ embeddings.T
            k         = min(top_k, n)
            keep.update(np.argpartition(-sims, k, axis=1)[:, :k].ravel().tolist())
            if batch_num % 10 == 0 or batch_num == total_batches:
                print(f"  batch {batch_num}/{total_batches} ,  {len(keep):,} unika ord")
        keep_sorted = sorted(keep)
        embeddings  = embeddings[keep_sorted]
        if embeddings_query is not None:
            embeddings_query = embeddings_query[keep_sorted]
        vocab       = [vocab[i] for i in keep_sorted]
        if sources is not None:
            sources = [sources[i] for i in keep_sorted]
        n = len(vocab)
        log.info(f"Stage 8: top-K filter → {n} words")

    # ── Optional PCA dimensionality reduction ─────────────────────────────────
    if args.dims is not None and args.dims < dims:
        embeddings = reduce_dims(embeddings, args.dims)
        if embeddings_query is not None:
            print("Applicerar PCA på query-embeddings…")
            embeddings_query = reduce_dims(embeddings_query, args.dims)
        dims = args.dims
    elif args.dims is not None and args.dims >= dims:
        print(f"  --dims {args.dims} >= befintliga {dims}, hoppas över.")

    # ── Finalise ──────────────────────────────────────────────────────────────
    out_emb = embeddings.astype("<f4")   # guarantee little-endian float32
    m       = len(vocab)
    size_mb = out_emb.nbytes / 1_048_576
    dual    = embeddings_query is not None

    print(f"\nResultat:")
    print(f"  Ord:        {n:>10,}")
    print(f"  Dimensioner: {dims}")
    print(f"  Fil-storlek: {size_mb:>8.1f} MB  (ursprung: {306318 * 1024 * 4 / 1_048_576:.0f} MB)")
    print(f"  RAM (Go):    {size_mb:>8.1f} MB  (float32)")
    print(f"  Dual-vektor: {'ja' if dual else 'nej'}")
    log.info(f"Stage 8: output {m}x{dims}  {size_mb:.1f} MB  dual={dual}")

    # ── Sanity check: all targets still present ───────────────────────────────
    filtered_keys = {w.lower() for w in vocab}
    dropped = [t for t in targets if t.lower() not in filtered_keys]
    if dropped:
        print(f"  VARNING: {len(dropped)} målord saknas i filtrerat vocab!")
        log.warning(f"Stage 8: dropped targets: {dropped[:10]}")
    else:
        print(f"  Alla målord finns kvar i filtrerat vocab. ✓")

    # ── Write outputs ─────────────────────────────────────────────────────────
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\nSkriver {OUT_BIN}  ({size_mb:.1f} MB)…")
    with OUT_BIN.open("wb") as f:
        f.write(out_emb.tobytes())
    log.info(f"Stage 8: wrote {OUT_BIN}")

    if dual:
        out_query = embeddings_query.astype("<f4")  # type: ignore[union-attr]
        print(f"Skriver {OUT_QUERY_BIN}  ({out_query.nbytes / 1_048_576:.1f} MB)…")
        with OUT_QUERY_BIN.open("wb") as f:
            f.write(out_query.tobytes())
        log.info(f"Stage 8: wrote {OUT_QUERY_BIN}")

    print(f"Skriver {OUT_VOCAB}…")
    with OUT_VOCAB.open("w", encoding="utf-8") as f:
        json.dump(vocab, f, ensure_ascii=False)
    log.info(f"Stage 8: wrote {OUT_VOCAB}")

    meta = {"n": m, "dims": dims, "dual": dual}
    with OUT_META.open("w", encoding="utf-8") as f:
        json.dump(meta, f)
    print(f"Skriver {OUT_META}: {meta}")
    log.info(f"Stage 8: wrote {OUT_META} {meta}")

    if sources is not None:
        with OUT_SOURCES.open("w", encoding="utf-8") as f:
            json.dump(sources, f, ensure_ascii=False)
        log.info(f"Stage 8: wrote {OUT_SOURCES}")

    # ── Round-trip sanity check ───────────────────────────────────────────────
    raw = OUT_BIN.read_bytes()
    first_vec = np.frombuffer(raw[: dims * 4], dtype="<f4")
    if not np.allclose(first_vec, out_emb[0], atol=1e-6):
        print("VARNING: round-trip-kontroll misslyckades, binärfilen kan vara korrupt.")
        sys.exit(1)

    print(f"\nKlar! {m:,} vektorer ({dims} dims) exporterade till {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
