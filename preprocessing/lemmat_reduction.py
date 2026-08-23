"""
Experiment: measure vocabulary reduction from grouping w2v word vectors by
SALDO (saldom.xml) lemma, instead of the spaCy-based lemmatiser stage_5.py
uses today. Standalone, does not touch the numbered pipeline or
server/wordfiles/, everything is read from and written to preprocessing/model/.

Method
------
1. Load the full Wikipedia2Vec word vocabulary (same validity filter as
   stage_5._is_valid_word), lowercase and dedupe it -> the baseline.
2. Stream-parse saldom.xml (~250MB, too big to DOM-load) into a
   {surface_lower: lemma_lower} map. A surface form that resolves to more
   than one distinct lemma across the file (cross-POS homographs, e.g.
   "får" = noun "får" (sheep) vs verb "få" (get) present tense) is dropped
   entirely, kept as its own untouched entry, never merged.
3. For each surface->lemma pair where both the surface and the lemma already
   have a vector in the baseline, drop the surface entry. The lemma's own
   (real, not synthesised) vector stands in for it. A pair where the lemma
   has no vector of its own is left unmerged.
4. Write the reduced vocab, in the same raw-float32 + vocab.json + meta.json
   layout stage_6.py uses for server/wordfiles/, plus the surface->lemma map.

Usage
-----
    python lemmat_reduction.py
"""

import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np

from shared import load_custom_stopwords
from stage_5 import MODEL_PATH, _is_valid_word

BASE_DIR   = Path(__file__).resolve().parent
SALDOM_XML = BASE_DIR / "model" / "saldom.xml"
OUT_DIR    = BASE_DIR / "model"

OUT_BIN    = OUT_DIR / "svwiki-w2v-lemmat-300d.bin"
OUT_VOCAB  = OUT_DIR / "svwiki-w2v-lemmat-300d.vocab.json"
OUT_META   = OUT_DIR / "svwiki-w2v-lemmat-300d.meta.json"
OUT_LEMMA  = OUT_DIR / "lemma_map.json"


def load_baseline_vocab(stopwords: set) -> dict[str, np.ndarray]:
    """Full, lowercased, deduped w2v word vocab: {lower_text: vector}."""
    try:
        from wikipedia2vec import Wikipedia2Vec
    except ImportError:
        print("wikipedia2vec saknas. Kör: pip install wikipedia2vec")
        sys.exit(1)

    if not MODEL_PATH.exists():
        print(f"Fel: modellen saknas på {MODEL_PATH}")
        sys.exit(1)

    print("Laddar Wikipedia2Vec-modell…")
    model = Wikipedia2Vec.load(str(MODEL_PATH))
    syn0 = model.syn0
    if syn0 is None:
        print("Fel: model.syn0 är inte tillgänglig, uppgradera wikipedia2vec.")
        sys.exit(1)

    print("Bygger baseline-vokabulär (lowercased, deduplicerad)…")
    baseline: dict[str, np.ndarray] = {}
    for word_obj in model.dictionary.words():
        text = word_obj.text
        if not _is_valid_word(text, stopwords):
            continue
        low = text.lower()
        if low not in baseline:
            baseline[low] = syn0[word_obj.index].astype(np.float32)

    print(f"  Baseline: {len(baseline):,} ord")
    return baseline


def parse_saldo_lemma_map(valid_lowers: set[str]) -> tuple[dict[str, str], int, int]:
    """Stream saldom.xml -> {surface_lower: lemma_lower}, ambiguous surfaces dropped.

    valid_lowers restricts which surfaces/lemmas are worth tracking at all
    (must already be in the w2v baseline), keeps the map small.
    Returns (map, n_entries_parsed, n_ambiguous_dropped).
    """
    surface_to_lemma: dict[str, str] = {}
    ambiguous: set[str] = set()
    n_entries = 0

    print("Läser saldom.xml…")
    context = ET.iterparse(str(SALDOM_XML), events=("end",))
    for _, elem in context:
        if elem.tag != "LexicalEntry":
            continue
        n_entries += 1
        if n_entries % 20_000 == 0:
            print(f"  {n_entries:,} poster…")

        lemma_feat = elem.find("./Lemma/FormRepresentation/feat[@att='writtenForm']")
        lemma_text = (lemma_feat.get("val") if lemma_feat is not None else "") or ""
        lemma_l = lemma_text.strip().lower()

        surfaces = {lemma_l} if lemma_l else set()
        for wf_feat in elem.findall("./WordForm/feat[@att='writtenForm']"):
            val = (wf_feat.get("val") or "").strip().lower()
            if val:
                surfaces.add(val)

        if lemma_l and lemma_l in valid_lowers:
            for surf in surfaces:
                if surf not in valid_lowers:
                    continue
                existing = surface_to_lemma.get(surf)
                if existing is None:
                    surface_to_lemma[surf] = lemma_l
                elif existing != lemma_l:
                    ambiguous.add(surf)

        elem.clear()

    for surf in ambiguous:
        surface_to_lemma.pop(surf, None)

    print(f"  {n_entries:,} LexicalEntry, {len(ambiguous):,} tvetydiga ytformer borttagna")
    return surface_to_lemma, n_entries, len(ambiguous)


def main() -> None:
    if not SALDOM_XML.exists():
        print(f"Fel: {SALDOM_XML} saknas")
        sys.exit(1)

    stopwords = load_custom_stopwords()
    baseline = load_baseline_vocab(stopwords)

    surface_to_lemma, n_entries, n_ambiguous = parse_saldo_lemma_map(set(baseline))

    print("Slår ihop ytformer mot sina lemman…")
    final_vectors = dict(baseline)
    lemma_map: dict[str, str] = {}
    skipped_no_lemma_vector = 0

    for surface_l, lemma_l in surface_to_lemma.items():
        if surface_l == lemma_l:
            continue
        if lemma_l not in baseline:
            skipped_no_lemma_vector += 1
            continue
        if surface_l in final_vectors:
            del final_vectors[surface_l]
            lemma_map[surface_l] = lemma_l

    baseline_count = len(baseline)
    final_count = len(final_vectors)

    print(f"\nBaseline (w2v-modellens fulla vokabulär): {baseline_count:,} ord")
    print(f"SALDO LexicalEntry parsade:                {n_entries:,}")
    print(f"Tvetydiga ytformer (hoppade över):         {n_ambiguous:,}")
    print(f"Grupper utan vektor för lemmat (hoppade):  {skipped_no_lemma_vector:,}")
    print(f"Slagit ihop (borttagna ytformer):          {len(lemma_map):,}")
    print(f"Resultat: {final_count:,} ord ({100 * (1 - final_count / baseline_count):.1f}% reduktion)")

    print("\nSkriver output…")
    words = sorted(final_vectors)
    embeddings = np.vstack([final_vectors[w] for w in words]).astype(np.float32)
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1.0, norms)
    embeddings /= norms

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    embeddings.tofile(str(OUT_BIN))
    with OUT_VOCAB.open("w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False)
    with OUT_META.open("w", encoding="utf-8") as f:
        json.dump({"n": len(words), "dims": int(embeddings.shape[1])}, f)
    with OUT_LEMMA.open("w", encoding="utf-8") as f:
        json.dump(lemma_map, f, ensure_ascii=False)

    print(f"  {OUT_BIN}  {embeddings.shape}")
    print(f"  {OUT_VOCAB}")
    print(f"  {OUT_META}")
    print(f"  {OUT_LEMMA}  ({len(lemma_map):,} poster)")


if __name__ == "__main__":
    main()
