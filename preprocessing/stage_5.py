"""
Stage 5: Vocabulary building via entity-neighbourhood expansion + reverse lemmatisation.

Pipeline
--------
1. Load seeding entities from intermediate/stage3_attrs/.
2. Get entity vectors from Wikipedia2Vec; batch-compute the WORDS_PER_ENTITY
   nearest words in the shared embedding space for every entity.
3. If the word bank is below TARGET_VOCAB_SIZE, fill up with top-frequency
   Korp words (stopwords removed).
4. Reverse lemmatisation: for every lemma already in the bank, add all
   attested Korp surface forms that share that lemma.  The inflected form
   gets the same embedding vector as its lemma.
5. Encode everything: entities via entity vectors, words via word vectors
   looked up at lemma level.
6. Write intermediate outputs consumed by stage 6 / 8.

Outputs (intermediate/stage5_encoded/)
  embeddings.npy   float32, L2-normalised, shape (N, 300)
  vocab.json       display names
  sources.json     category per entry ("celebrity", "game", …, "general")
  lemma_map.json   {surface_form → lemma}  kept for server back-compat

Tunable knobs near the top of this file.
"""

import json
import logging
import pickle
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

try:
    from shared import CATEGORY_MAPPING, _is_valid_label, load_custom_stopwords
except ImportError:
    CATEGORY_MAPPING: dict = {}

    def _is_valid_label(value: str) -> bool:  # type: ignore[misc]
        value = (value or "").strip()
        return bool(value) and not value.startswith("http") and not re.match(r"^Q\d+$", value) and any(c.isalpha() for c in value)

    def load_custom_stopwords() -> set:  # type: ignore[misc]
        return set()


# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).resolve().parent
STAGE3_DIR  = BASE_DIR / "intermediate" / "stage3_attrs"
KORP_CSV    = BASE_DIR / "intermediate" / "korp_cleaned" / "korp_combined_cleaned.csv"
OUTPUT_DIR  = BASE_DIR / "intermediate" / "stage5_encoded"
SERVER_DIR  = BASE_DIR.parent / "server" / "wordfiles"
MODEL_PATH  = BASE_DIR / "model" / "svwiki-w2v-300d.bin"
LEMMA_CACHE = BASE_DIR / "intermediate" / "korp_lemma_cache.pkl"

# ── Tunable knobs ─────────────────────────────────────────────────────────────
WORDS_PER_ENTITY    = 250     # neighborhood words per entity seed
TARGET_VOCAB_SIZE   = 80_000  # supplement with Korp words below this
MIN_SIM             = 0.15    # discard word-neighbors with lower cosine similarity
MIN_WORD_LEN        = 3
KORP_MIN_FREQ       = 100     # minimum Korp frequency for direct supplementation
KORP_LEMMA_MIN_FREQ = 30      # minimum Korp frequency for reverse-lemma candidates
ENTITY_BATCH        = 200     # entities per matmul chunk


# ── Logging ───────────────────────────────────────────────────────────────────
def _setup_logger() -> logging.Logger:
    log_path = BASE_DIR / "pipeline.log"
    root = logging.getLogger()
    if not any(
        isinstance(h, logging.FileHandler) and h.baseFilename == str(log_path)
        for h in root.handlers
    ):
        h = logging.FileHandler(log_path, encoding="utf-8")
        h.setLevel(logging.INFO)
        h.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
        root.addHandler(h)
        root.setLevel(logging.INFO)
    return logging.getLogger(__name__)


log = _setup_logger()

_SWEDISH_RE     = re.compile(r"[a-zåäöA-ZÅÄÖ]")
_BAD_RE         = re.compile(r"[_/\\]")
# Reject words that contain any character outside the Swedish alphabet (a-z, å, ä, ö),
# digits, and hyphens. This removes Norwegian ø, Czech č/š, Turkish ş/ü, etc.
_NON_SWEDISH_RE = re.compile(r"[^a-zåäö0-9\-]", re.IGNORECASE)


def _is_valid_word(text: str, stopwords: set) -> bool:
    if len(text) < MIN_WORD_LEN:
        return False
    if text.lower() in stopwords:
        return False
    if not _SWEDISH_RE.search(text):
        return False
    if _NON_SWEDISH_RE.search(text):
        return False
    if _BAD_RE.search(text):
        return False
    if text.startswith("http"):
        return False
    return True


# ── Entity loading ─────────────────────────────────────────────────────────────
def load_entity_seeds() -> list[tuple[str, str, str]]:
    """Return [(display_name, wiki_title, category)] from stage3_attrs CSVs."""
    seeds: list[tuple[str, str, str]] = []
    seen: set[str] = set()

    for csv_path in sorted(STAGE3_DIR.glob("*.csv")):
        cat = CATEGORY_MAPPING.get(csv_path.stem, ("general", ""))[0]
        df  = pd.read_csv(csv_path)

        label_col = next((c for c in df.columns if c.endswith("Label")), None)
        if label_col is None:
            label_col = next((c for c in ("name", "word") if c in df.columns), None)
        if label_col is None:
            continue

        for _, row in df.iterrows():
            name = str(row.get(label_col, "")).strip()
            if not name or not _is_valid_label(name):
                continue
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            wiki_title = str(row.get("wiki_title", name)).strip() or name
            seeds.append((name, wiki_title, cat))

    return seeds


# ── Korp helpers ───────────────────────────────────────────────────────────────
def load_korp_df() -> pd.DataFrame:
    if not KORP_CSV.exists():
        return pd.DataFrame(columns=["word", "freq"])
    df = pd.read_csv(KORP_CSV, header=0)
    df.columns = ["word", "freq"]
    df["freq"] = pd.to_numeric(df["freq"], errors="coerce").fillna(0)
    return df


def build_reverse_lemma_map(
    bank_lemmas: set[str],
    stopwords: set,
) -> dict[str, list[str]]:
    """Return {lemma: [surface_forms]} for all Korp words above KORP_LEMMA_MIN_FREQ.

    Results are cached in LEMMA_CACHE so subsequent runs are instant.
    Only inflected forms whose lemma is already in *bank_lemmas* are kept.
    """
    # ── load or build the full korp→lemma map ────────────────────────────────
    korp_lemma: dict[str, str] = {}  # korp surface → its lemma

    if LEMMA_CACHE.exists():
        print("  Laddar lemma-cache…")
        with open(LEMMA_CACHE, "rb") as f:
            korp_lemma = pickle.load(f)
    else:
        import spacy
        try:
            nlp = spacy.load("sv_core_news_sm", disable=["parser", "ner", "senter"])
        except OSError:
            print("spaCy-modell 'sv_core_news_sm' saknas — installera den med:")
            print("  python -m spacy download sv_core_news_sm")
            sys.exit(1)

        df_korp = load_korp_df()
        candidates = (
            df_korp[df_korp["freq"] >= KORP_LEMMA_MIN_FREQ]["word"]
            .dropna()
            .astype(str)
            .str.strip()
            .str.lower()
            .drop_duplicates()
            .tolist()
        )
        candidates = [w for w in candidates if _is_valid_word(w, stopwords)]

        print(f"  Lemmatiserar {len(candidates):,} Korp-ord med spaCy…")
        batch_size = 2000
        for i in range(0, len(candidates), batch_size):
            if i % 20_000 == 0 and i > 0:
                print(f"    {i:,}/{len(candidates):,}…")
            batch = candidates[i : i + batch_size]
            docs = list(nlp.pipe(batch, batch_size=batch_size))
            for word, doc in zip(batch, docs):
                lemma = doc[0].lemma_.lower() if doc else word
                korp_lemma[word] = lemma

        print(f"  Sparar lemma-cache ({len(korp_lemma):,} poster)…")
        LEMMA_CACHE.parent.mkdir(parents=True, exist_ok=True)
        with open(LEMMA_CACHE, "wb") as f:
            pickle.dump(korp_lemma, f)

    # ── build reverse map restricted to lemmas already in the bank ───────────
    reverse: dict[str, list[str]] = {}
    for surface, lemma in korp_lemma.items():
        if lemma in bank_lemmas:
            reverse.setdefault(lemma, []).append(surface)

    return reverse


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    SERVER_DIR.mkdir(parents=True, exist_ok=True)
    log.info("Stage 5: start (entity-neighbourhood + reverse lemmatisation)")

    # 1 ── load model ──────────────────────────────────────────────────────────
    try:
        from wikipedia2vec import Wikipedia2Vec
    except ImportError:
        print("wikipedia2vec saknas. Kör: pip install wikipedia2vec")
        sys.exit(1)

    if not MODEL_PATH.exists():
        print(f"Fel: modellen saknas på {MODEL_PATH}")
        sys.exit(1)

    print(f"Laddar Wikipedia2Vec-modell…")
    model = Wikipedia2Vec.load(str(MODEL_PATH))
    log.info("Stage 5: model loaded")

    # 2 ── load stopwords ──────────────────────────────────────────────────────
    stopwords = load_custom_stopwords()
    print(f"Stoppord: {len(stopwords):,}")

    # 3 ── build word sub-matrix from model vocabulary ─────────────────────────
    # Using model.syn0 directly avoids one Python call per word.
    print("Bygger ordmatris från modellens vokabulär…")
    valid_word_texts: list[str] = []
    valid_word_idx:   list[int] = []

    for word_obj in model.dictionary.words():
        text = word_obj.text
        if _is_valid_word(text, stopwords):
            valid_word_texts.append(text)
            valid_word_idx.append(word_obj.index)

    syn0 = model.syn0
    if syn0 is None:
        print("Fel: model.syn0 är inte tillgänglig — uppgradera wikipedia2vec.")
        sys.exit(1)
    word_matrix = syn0[valid_word_idx].astype(np.float32)
    norms = np.linalg.norm(word_matrix, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1.0, norms)
    word_matrix /= norms
    print(f"  {len(valid_word_texts):,} giltiga ord i modellen")
    log.info(f"Stage 5: word matrix {word_matrix.shape}")

    # 4 ── load entity seeds & get their vectors ───────────────────────────────
    print("Laddar entitets-seeds…")
    seeds = load_entity_seeds()
    print(f"  {len(seeds):,} seeds från stage3_attrs")

    entity_names:   list[str]        = []
    entity_vecs:    list[np.ndarray] = []
    entity_cats:    list[str]        = []
    missing_entities: list[str]      = []

    for name, wiki_title, cat in seeds:
        vec = None
        for title_try in (wiki_title, name):
            try:
                obj = model.get_entity(title_try)
                if obj is not None:
                    vec = syn0[obj.index].astype(np.float32).copy()
                    break
            except Exception:
                continue
        if vec is None:
            missing_entities.append(name)
            continue
        entity_names.append(name)
        entity_vecs.append(vec)
        entity_cats.append(cat)

    print(f"  Entiteter med vektor: {len(entity_names):,}  |  saknar vektor: {len(missing_entities):,}")
    log.info(f"Stage 5: {len(entity_names)} entities with vectors, {len(missing_entities)} missing")

    entity_matrix = np.array(entity_vecs, dtype=np.float32)
    e_norms = np.linalg.norm(entity_matrix, axis=1, keepdims=True)
    e_norms = np.where(e_norms == 0, 1.0, e_norms)
    entity_matrix /= e_norms

    # 5 ── batch-compute nearest words for every entity ─────────────────────────
    print(f"Skördar topp-{WORDS_PER_ENTITY} ord per entitet (batch={ENTITY_BATCH})…")
    word_bank: dict[str, float] = {}  # surface → best cosine sim

    n_entities = len(entity_names)
    for batch_start in range(0, n_entities, ENTITY_BATCH):
        batch_vecs = entity_matrix[batch_start : batch_start + ENTITY_BATCH]  # (B, 300)
        sims       = batch_vecs @ word_matrix.T                                # (B, N_words)

        for j in range(len(batch_vecs)):
            sim_row = sims[j]
            top_k   = min(WORDS_PER_ENTITY, len(valid_word_texts))
            top_idx = np.argpartition(-sim_row, top_k)[:top_k]

            for idx in top_idx:
                sim = float(sim_row[idx])
                if sim < MIN_SIM:
                    continue
                word = valid_word_texts[idx]
                if sim > word_bank.get(word, -1.0):
                    word_bank[word] = sim

        done = min(batch_start + ENTITY_BATCH, n_entities)
        if done % 400 == 0 or done == n_entities:
            print(f"  {done:,}/{n_entities:,} entiteter → {len(word_bank):,} ord")

    print(f"Ord efter entitet-expansion: {len(word_bank):,}")
    log.info(f"Stage 5: word bank after entity expansion: {len(word_bank)}")

    # 6 ── supplement with Korp if below TARGET_VOCAB_SIZE ─────────────────────
    if len(word_bank) < TARGET_VOCAB_SIZE and KORP_CSV.exists():
        need = TARGET_VOCAB_SIZE - len(word_bank)
        print(f"Fyller på med Korp-ord (behöver {need:,} till)…")

        df_korp = load_korp_df()
        df_korp = df_korp[df_korp["freq"] >= KORP_MIN_FREQ].sort_values("freq", ascending=False)

        added = 0
        for word in df_korp["word"].astype(str):
            word = word.strip().lower()
            if word in word_bank:
                continue
            if not _is_valid_word(word, stopwords):
                continue
            word_bank[word] = 0.0
            added += 1
            if added >= need:
                break

        print(f"  Lade till {added:,} Korp-ord. Totalt ord: {len(word_bank):,}")
        log.info(f"Stage 5: added {added} Korp words, total {len(word_bank)}")

    # 6b ── inject domain vocabulary expansions ────────────────────────────────
    # These words bypass the Kelly/Korp frequency gates in stage_4 because they are
    # domain-specific but common in Swedish (e.g. "aktier", "atlet"). Only add if
    # the w2v model has a vector for them — no vector means no useful neighbour info.
    try:
        from shared import DOMAIN_VOCAB_EXPANSIONS
        domain_added = 0
        domain_missing: list[str] = []
        for _cat, words in DOMAIN_VOCAB_EXPANSIONS.items():
            for w in words:
                w = w.lower().strip()
                if w in word_bank:
                    continue
                try:
                    v = model.get_word_vector(w)
                except Exception:
                    v = None
                if v is not None:
                    word_bank[w] = 0.0
                    domain_added += 1
                else:
                    domain_missing.append(w)
        print(f"  Domänord tillagda: {domain_added:,}  |  saknar vektor: {len(domain_missing):,}")
        log.info(f"Stage 5: domain vocab added {domain_added}, missing vectors {domain_missing}")
    except ImportError:
        pass

    # 7 ── forward-lemmatise the bank (needed for reverse step & vector lookup) ─
    # We reuse the Korp lemma cache built in build_reverse_lemma_map.
    # First load/build the cache so we can look up each bank word's lemma.
    print("Reverse-lemmatisering…")

    # ── build / load korp_lemma cache ────────────────────────────────────────
    korp_lemma: dict[str, str] = {}
    if LEMMA_CACHE.exists():
        print("  Laddar lemma-cache…")
        with open(LEMMA_CACHE, "rb") as f:
            korp_lemma = pickle.load(f)
    else:
        import spacy
        try:
            nlp = spacy.load("sv_core_news_sm", disable=["parser", "ner", "senter"])
        except OSError:
            print("spaCy-modell 'sv_core_news_sm' saknas — hoppar över lemmatisering.")
            nlp = None

        if nlp is not None:
            df_korp = load_korp_df()
            candidates = (
                df_korp[df_korp["freq"] >= KORP_LEMMA_MIN_FREQ]["word"]
                .dropna().astype(str).str.strip().str.lower()
                .drop_duplicates().tolist()
            )
            candidates = [w for w in candidates if _is_valid_word(w, stopwords)]
            print(f"  Lemmatiserar {len(candidates):,} Korp-ord med spaCy…")

            batch_size = 2000
            for i in range(0, len(candidates), batch_size):
                if i % 30_000 == 0 and i > 0:
                    print(f"    {i:,}/{len(candidates):,}…")
                batch = candidates[i : i + batch_size]
                docs  = list(nlp.pipe(batch, batch_size=batch_size))
                for word, doc in zip(batch, docs):
                    korp_lemma[word] = doc[0].lemma_.lower() if doc else word

            print(f"  Sparar lemma-cache ({len(korp_lemma):,} poster)…")
            LEMMA_CACHE.parent.mkdir(parents=True, exist_ok=True)
            with open(LEMMA_CACHE, "wb") as f:
                pickle.dump(korp_lemma, f)

    # ── lemma for each bank word ──────────────────────────────────────────────
    # Fall back to the surface form itself if not in cache.
    fwd_lemma: dict[str, str] = {w: korp_lemma.get(w, w) for w in word_bank}

    # ── build reverse map restricted to lemmas in bank ────────────────────────
    bank_lemmas = set(fwd_lemma.values())
    reverse_lemma: dict[str, list[str]] = {}
    for surface, lemma in korp_lemma.items():
        if lemma in bank_lemmas and _is_valid_word(surface, stopwords):
            reverse_lemma.setdefault(lemma, []).append(surface)

    # ── expand bank with inflected forms ─────────────────────────────────────
    expansion: dict[str, float] = {}
    for _, lemma in fwd_lemma.items():
        for inflected in reverse_lemma.get(lemma, []):
            if inflected not in word_bank and inflected not in expansion:
                expansion[inflected] = 0.0  # same score tier as Korp supplement

    word_bank.update(expansion)
    print(f"  Ord efter reverse-lemmatisering: {len(word_bank):,} (+{len(expansion):,})")
    log.info(f"Stage 5: after reverse lemmatisation {len(word_bank)}, expansion +{len(expansion)}")

    # ── forward-lemma map for all entries (bank + expansion) ─────────────────
    full_lemma_map: dict[str, str] = {w: korp_lemma.get(w, w) for w in word_bank}

    # 8 ── encode ──────────────────────────────────────────────────────────────
    print("Kodifierar…")
    vocab:   list[str]        = []
    sources: list[str]        = []
    vectors: list[np.ndarray] = []
    lemma_map: dict[str, str] = {}

    # ── entities ─────────────────────────────────────────────────────────────
    for name, vec, cat in zip(entity_names, entity_vecs, entity_cats):
        vocab.append(name)
        sources.append(cat)
        vectors.append(vec)

    # ── words (sorted so output is deterministic) ─────────────────────────────
    missing_words: list[str] = []

    for surface in sorted(word_bank):
        lemma = full_lemma_map.get(surface, surface)
        lemma_map[surface] = lemma

        # Look up vector at lemma level; fall back to surface form
        vec = None
        for key in (lemma, surface):
            try:
                v = model.get_word_vector(key)
                if v is not None:
                    vec = v.astype(np.float32)
                    break
            except Exception:
                continue

        if vec is None:
            missing_words.append(surface)
            continue

        vocab.append(surface)
        sources.append("general")
        vectors.append(vec)

    print(f"  Totalt: {len(vocab):,} poster  (ord saknar vektor: {len(missing_words):,})")
    log.info(f"Stage 5: vocab size {len(vocab)}, missing word vectors {len(missing_words)}")

    # 8b ── domain vocabulary gap report ──────────────────────────────────────
    # Words in DOMAIN_VOCAB_EXPANSIONS that ended up missing from the final vocab
    # need Phase 2 (supplementary corpus) to resolve — flag them clearly.
    try:
        from shared import DOMAIN_VOCAB_EXPANSIONS
        vocab_set = set(v.lower() for v in vocab)
        gap_by_cat: dict[str, list[str]] = {}
        for cat, words in DOMAIN_VOCAB_EXPANSIONS.items():
            missing_domain = [w for w in words if w.lower() not in vocab_set]
            if missing_domain:
                gap_by_cat[cat] = missing_domain
        if gap_by_cat:
            print("\n  [!] Domänord utan vektor (behöver fas 2 / supplementärkorpus):")
            for cat, words in gap_by_cat.items():
                print(f"      [{cat}]: {words}")
                log.warning(f"Stage 5 domain gap [{cat}]: {words}")
        else:
            print("  Alla domänord ingår i vokabulären.")
            log.info("Stage 5: all domain vocab words present in vocab")
    except ImportError:
        pass

    # 9 ── L2-normalise ────────────────────────────────────────────────────────
    embeddings = np.vstack(vectors).astype(np.float32)
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1.0, norms)
    embeddings /= norms

    # 10 ── write outputs ──────────────────────────────────────────────────────
    emb_path     = OUTPUT_DIR / "embeddings.npy"
    vocab_path   = OUTPUT_DIR / "vocab.json"
    sources_path = OUTPUT_DIR / "sources.json"
    lemma_path   = OUTPUT_DIR / "lemma_map.json"

    np.save(str(emb_path), embeddings)
    with vocab_path.open("w", encoding="utf-8") as f:
        json.dump(vocab, f, ensure_ascii=False)
    with sources_path.open("w", encoding="utf-8") as f:
        json.dump(sources, f, ensure_ascii=False)
    with lemma_path.open("w", encoding="utf-8") as f:
        json.dump(lemma_map, f, ensure_ascii=False)

    log.info(f"Stage 5: wrote {emb_path} {embeddings.shape}")

    for out_dir in (OUTPUT_DIR, SERVER_DIR):
        for fname, data in [("sources.json", sources), ("lemma_map.json", lemma_map)]:
            path = out_dir / fname
            with path.open("w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False)

    print(f"\nKlar! {len(vocab):,} poster ({embeddings.shape[1]} dims)")
    print(f"  embeddings : {emb_path}  {embeddings.shape}")
    print(f"  vocab      : {vocab_path}")
    print(f"  sources    : {sources_path}")
    print(f"  lemma_map  : {lemma_path}  ({len(lemma_map):,} poster)")


if __name__ == "__main__":
    main()
