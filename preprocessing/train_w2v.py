"""
Download the Swedish Wikipedia dump and train Wikipedia2Vec.
Run this and leave for the day:

    python train_w2v.py

Progress and validation output are written to train_w2v.log in addition to stdout.
The trained model lands at model/svwiki-w2v-300d.bin.
"""

import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths (relative to this file, so you can run from anywhere)
# ---------------------------------------------------------------------------
BASE = Path(__file__).parent
DATA_DIR = BASE / "data"
MODEL_DIR = BASE / "model"
DUMP = DATA_DIR / "svwiki-latest-pages-articles.xml.bz2"
MODEL = MODEL_DIR / "svwiki-w2v-300d.bin"
LOG_FILE = BASE / "train_w2v.log"

DUMP_URL = (
    "https://dumps.wikimedia.org/svwiki/latest/"
    "svwiki-latest-pages-articles.xml.bz2"
)

# Swedish Wikipedia needs ~15 GB of LMDB address space for the dump DB.
# This is a virtual reservation on 64-bit Linux, it does not pre-allocate disk.
LMDB_MAPSIZE_MB = 30000

DICT_ARGS = ["--min-word-count", "10", "--min-entity-count", "10"]
EMBED_ARGS = ["--dim-size", "300", "--window", "5", "--iteration", "10", "--negative", "15"]


# ---------------------------------------------------------------------------
# Logging, write to both stdout and log file
# ---------------------------------------------------------------------------
_log_fh = None

def log(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    if _log_fh:
        _log_fh.write(line + "\n")
        _log_fh.flush()


# ---------------------------------------------------------------------------
# Step 1: check wikipedia2vec is importable
# ---------------------------------------------------------------------------
def check_deps() -> None:
    try:
        import wikipedia2vec  # noqa: F401
    except ImportError:
        log("wikipedia2vec not found, installing via pip...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "wikipedia2vec"])
        log("wikipedia2vec installed.")


# ---------------------------------------------------------------------------
# Step 2: download dump with a progress bar
# ---------------------------------------------------------------------------
def download_dump() -> None:
    if DUMP.exists():
        size_gb = DUMP.stat().st_size / 1e9
        log(f"Dump already exists ({size_gb:.1f} GB), skipping download.")
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    log(f"Downloading {DUMP_URL}")
    log("This is ~3 GB; may take a while depending on your connection.")

    last_logged = [0.0]

    def reporthook(block_num: int, block_size: int, total_size: int) -> None:
        downloaded = block_num * block_size
        pct = downloaded / total_size * 100 if total_size > 0 else 0
        if pct - last_logged[0] >= 5:
            log(f"  {pct:.0f}% ({downloaded / 1e6:.0f} MB / {total_size / 1e6:.0f} MB)")
            last_logged[0] = pct

    tmp = DUMP.with_suffix(".bz2.tmp")
    urllib.request.urlretrieve(DUMP_URL, tmp, reporthook)
    tmp.rename(DUMP)
    log(f"Download complete: {DUMP}")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def run(cmd: list[str]) -> None:
    log("Command: " + " ".join(cmd))
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip()
        if line:
            log(line)
    proc.wait()
    if proc.returncode != 0:
        log(f"FAILED (exit code {proc.returncode})")
        sys.exit(proc.returncode)


# ---------------------------------------------------------------------------
# Step 3a: build dump DB via Python API so we can set a large LMDB map_size
# (the CLI does not expose this flag, leading to MDB_MAP_FULL on Swedish Wikipedia)
# ---------------------------------------------------------------------------
def build_dump_db() -> Path:
    db_file = DATA_DIR / "svwiki.db"
    if db_file.exists():
        log(f"Dump DB already exists at {db_file}, skipping build-dump-db.")
        return db_file

    map_size_bytes = LMDB_MAPSIZE_MB * 1024 * 1024
    log(f"Building dump DB (map_size={LMDB_MAPSIZE_MB} MB), this takes ~10 min.")

    from wikipedia2vec.dump_db import DumpDB
    from wikipedia2vec.utils.wiki_dump_reader import WikiDumpReader

    dump_reader = WikiDumpReader(str(DUMP))
    DumpDB.build(dump_reader, str(db_file), pool_size=1, chunk_size=100, init_map_size=map_size_bytes)

    log(f"Dump DB written to {db_file}")
    return db_file


# ---------------------------------------------------------------------------
# Step 3b: run build-dictionary → build-link-graph → build-mention-db → train-embedding
# ---------------------------------------------------------------------------
def train(db_file: Path) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    dic_file     = DATA_DIR / "svwiki_dic.pkl"
    lg_file      = DATA_DIR / "svwiki_lg.pkl"
    mention_file = DATA_DIR / "svwiki_mention.pkl"

    if not dic_file.exists():
        log("Building dictionary…")
        run(["wikipedia2vec", "build-dictionary", *DICT_ARGS, str(db_file), str(dic_file)])
    else:
        log(f"Dictionary exists, skipping.")

    if not lg_file.exists():
        log("Building link graph…")
        run(["wikipedia2vec", "build-link-graph", str(db_file), str(dic_file), str(lg_file)])
    else:
        log(f"Link graph exists, skipping.")

    if not mention_file.exists():
        log("Building mention DB…")
        run(["wikipedia2vec", "build-mention-db", str(db_file), str(dic_file), str(mention_file)])
    else:
        log(f"Mention DB exists, skipping.")

    if MODEL.exists():
        log(f"Model already exists at {MODEL}, skipping embedding training.")
        return

    log("Training embeddings. Expect 12–24 hours on a standard machine.")
    start = time.time()
    run([
        "wikipedia2vec", "train-embedding",
        "--link-graph", str(lg_file),
        "--mention-db", str(mention_file),
        *EMBED_ARGS,
        str(db_file), str(dic_file), str(MODEL),
    ])
    elapsed = (time.time() - start) / 3600
    log(f"Training complete in {elapsed:.1f} hours. Model: {MODEL}")


# ---------------------------------------------------------------------------
# Step 4: validate
# ---------------------------------------------------------------------------
def validate() -> None:
    from wikipedia2vec import Wikipedia2Vec

    log("Loading model for validation…")
    model = Wikipedia2Vec.load(str(MODEL))
    log("Model loaded.")

    checks = [
        ("word", "curling"),
        ("word", "röd"),
        ("entity", "Rasmus Wranå"),
        ("entity", "Avicii"),
    ]

    all_ok = True
    for kind, name in checks:
        try:
            if kind == "word":
                vec = model.get_word(name)
            else:
                vec = model.get_entity(name)

            if vec is None:
                log(f"  WARN  {kind} '{name}' returned None (not in model)")
                all_ok = False
                continue

            neighbours = model.most_similar(vec, count=10)
            neighbour_strs = []
            for n in neighbours:
                try:
                    neighbour_strs.append(n[0].text)
                except AttributeError:
                    neighbour_strs.append(str(n[0]))
            log(f"  OK    {kind} '{name}' → {neighbour_strs}")
        except Exception as exc:
            log(f"  ERROR {kind} '{name}': {exc}")
            all_ok = False

    if all_ok:
        log("Validation passed.")
    else:
        log("Validation finished with warnings, check the WARN/ERROR lines above.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main() -> None:
    global _log_fh
    _log_fh = open(LOG_FILE, "a", encoding="utf-8")
    log("=" * 60)
    log("train_w2v.py started")

    check_deps()
    download_dump()
    db_file = build_dump_db()
    train(db_file)
    validate()

    log("All done.")
    _log_fh.close()


if __name__ == "__main__":
    main()
