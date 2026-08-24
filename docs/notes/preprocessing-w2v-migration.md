> **Status:** Implemented · **Updated:** 2026-08-20
>
> Historical record of Wikipedia2Vec + lemmatization migration. Done. Split from old
> `preprocessing/plan.md`; open half now
> [`../design/0002-word-selection.md`](../design/0002-word-selection.md).
>
> Kept because training + validation commands = retrain procedure, which
> `preprocessing/README.md` points at.

---

# Migration Notes: Wikipedia2Vec + Supplementary Corpus + Lemmatization

Was implementation roadmap for migration to Wikipedia2Vec embedding model with
lemmatization-aware vocab. **Migration complete.**

**Before:** KB-SBERT (`KBLab/sentence-bert-swedish-cased`) in `stage_5.py`, 768 dims,
dual-embedding, no lemmatization.

**Now:** Wikipedia2Vec trained on Swedish Wikipedia (`svwiki-w2v-300d`), 300 dims,
single symmetric embedding file, general words keyed by lemma, surface-form resolution map
exported to Go as `lemma_map.json`.

---

## Phase 1: Wikipedia2Vec Training

### 1.1 Prerequisites

```bash
pip install wikipedia2vec
```

Hardware: 16+ GB RAM, decent multi-core CPU. 12–24 h wall time on normal dev machine.
No GPU, wikipedia2vec is CPU-bound skip-gram. Model file ~3-4 GB before trimming.

### 1.2 Download the Swedish Wikipedia dump

```bash
# Save the dump into preprocessing/data/ (git-ignored)
mkdir -p preprocessing/data
wget -P preprocessing/data \
  https://dumps.wikimedia.org/svwiki/latest/svwiki-latest-pages-articles.xml.bz2
```

~3 GB compressed. No decompress needed, wikipedia2vec read `.xml.bz2` direct.

### 1.3 The Lsjbot problem and how to handle it

Lsjbot = bot account, auto-made ~1 million stub articles for villages and animal
species. Near-zero real content, add noise to word co-occurrences if treated as full
articles.

Best filter: `--min-entity-count`. Flag set min times entity must be _linked to from
other Wikipedia articles_ before getting vector. Lsjbot stubs obscure, rarely linked,
so higher threshold kill most of them without preprocessing XML dump.

For game entity set (celebrities, brands, games, geography, food), threshold 10 safe.
Entities in seeding CSVs well-known enough to appear far past 10 times in link context
across Swedish Wikipedia.

### 1.4 Training command

```bash
wikipedia2vec train \
  --dim-size 300 \
  --window 5 \
  --iteration 10 \
  --negative 15 \
  --min-entity-count 10 \
  --min-word-count 10 \
  preprocessing/data/svwiki-latest-pages-articles.xml.bz2 \
  preprocessing/model/svwiki-w2v-300d.bin
```

Params:

- `--dim-size 300`: word2vec standard; what original Contexto use.
  300 dims float32 = ~60 MB out vs current 200+ MB.
- `--window 5`: context window. Good general default.
- `--iteration 10`: more iterations = better quality, more time. Start here.
- `--negative 15`: negative sampling count. Higher = better quality, slower.
- `--min-word-count 10`: drop low-frequency words with noisy vectors.

### 1.5 Validate the trained model before touching the pipeline

```python
from wikipedia2vec import Wikipedia2Vec
model = Wikipedia2Vec.load("preprocessing/model/svwiki-w2v-300d.bin")

# Test word neighbours , should be semantically coherent
print(model.most_similar(model.get_word("curling"), count=10))
print(model.most_similar(model.get_word("röd"), count=10))

# Test entity neighbours , this is the key quality check
# Entity names use the Wikipedia article title format
rasmus = model.get_entity("Rasmus Wranå")
print(model.most_similar(rasmus, count=20))
# Expect: curling, Lag Edin, OS, Karlstad, ishockey-adjacent terms

avicii = model.get_entity("Avicii")
print(model.most_similar(avicii, count=20))
# Expect: musik, DJ, elektronisk, Wake Me Up adjacent , NOT drug/death vocabulary
```

Run checks before pipeline integration. Expected entity return `None` = entity below
`--min-entity-count` or titled different on Swedish Wikipedia. Check article title
exact (case-sensitive).

---

## Phase 2: Supplementary Corpus (Optional, Do Later)

Wikipedia likely cover all game-target words fine, general vocab already filtered by
Korp frequency + Kelly dictionary, so all target words are common Swedish words
frequent in Wikipedia. Skip this phase until Phase 1 + Phase 3 done and playtested.

If playtest show weak neighbours for some general word categories (colloquial words,
everyday verbs, food terms), supplement with:

**Swedish Culturomics Gigaword Corpus**
One-billion-word Swedish reference dataset, 1950 onward, diverse sources.
At: `https://spraakbanken.gu.se/en/resources/gigaword`
Free after register at Språkbanken (research use).

**SOU Corpus** (Statens offentliga utredningar)
Cleaned Swedish Government Official Reports 1994-2020. Neutral, topically diverse:
health, education, environment, culture, sports, law.
Via Språkbanken: search "SOU" in resource catalogue.

**How to use supplementary corpora alongside Wikipedia2Vec:**

Do not mix into Wikipedia2Vec training run, wikipedia2vec want Wikipedia XML input,
not plain text. Instead:

1. Train separate standard word2vec on supplementary text with `gensim`
2. In stage 5, fallback lookup: general word not in Wikipedia2Vec word vocab → fetch
   vector from supplementary gensim model
3. Entity vectors stay Wikipedia2Vec-only

Keep two training regimes clean, dodge vector space alignment problems. Only build if
real gap found after playtesting Phase 1+3.

**Sources to avoid:** Aftonbladet, Expressen, raw Common Crawl without quality filter,
social media. Single-perspective or high-recency-bias corpora cause same Aftonbladet
problem already hit.

---

## Phase 3: Lemmatization Map

Independent of Wikipedia2Vec, can run alongside or after. Fix inflection-proliferation:
`röd`, `röda`, `rött` all resolve to same vector entry `röd`.

### 3.1 Stage 5 changes

In `load_general_words()`, switch canonical key from surface form to lemma.
Use `nlp.pipe()` (batch) to lemmatize, never `nlp()` per word, orders of magnitude
slower.

Output two things from function:

- `records`: keyed by lemma, used as before for embedding
- `lemma_map`: `{ surface_form: lemma }` for every word in Korp CSV, exported
  as `lemma_map.json` to both `intermediate/stage5_encoded/` and
  `server/wordfiles/`

Entity names need no lemmatization, proper nouns, and Wikipedia2Vec entity lookup use
article title direct.

### 3.2 Go changes

In `words` package, add `LemmaMap map[string]string` to `Dictionary` struct.
Load `server/wordfiles/lemma_map.json` at startup in `InitializeDictionary()`.

Add `Resolve(input string) string` method: case-insensitive lookup in `LemmaMap`,
fall back to raw lowercased input if miss.

Call `dict.Resolve(input)` before every `IsValid()` and `CalculateDistance()` call in
`main.go`. Resolved form used internally for vector lookup only, do not show canonical
lemma when player typed inflected form; echo their original input in UI.

### 3.3 Validation

```python
# Quick sanity check after stage 5 runs
import json
with open("intermediate/stage5_encoded/lemma_map.json") as f:
    m = json.load(f)

# These should all map to the same lemma
assert m["röda"]  == "röd"
assert m["rött"]  == "röd"
assert m["bilar"] == "bil"
assert m["sprang"] == "springa"
print("Lemma map looks correct")
```

spaCy Swedish lemmatizer is rule-based, sometimes wrong on uncommon words. If errors
show in playtest, keep small `preprocessing/lemma_overrides.json` with corrections
(e.g. `{"körde": "köra", "löpte": "löpa"}`) and merge into map before save. Later
concern, don't preempt.

---

## Pipeline Change Summary

| Stage            | Status           | What changes                                                                                                                  |
| ---------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `stage_1.py`     | Unchanged        | ,                                                                                                                             |
| `stage_2.py`     | Unchanged        | ,                                                                                                                             |
| `stage_3.py`     | Unchanged        | ,                                                                                                                             |
| `stage_4.py`     | Unchanged        | Still emits `general_words.csv` with `word` + `lemma` columns                                                                 |
| `stage_5.py`     | **Full rewrite** | Wikipedia2Vec lookup instead of sentence transformer; lemma as canonical key; single embedding file; exports `lemma_map.json` |
| `stage_6.py`     | Unchanged        | Same binary export, 300 dims not 768                                                                                          |
| `stage_7.py`     | Unchanged        | Target list logic same                                                                                                        |
| `stage_8.py`     | Simplified       | PCA rarely needed at 300 dims; `--top-k` still useful                                                                         |
| `main.go`        | Small change     | Add `Resolve()` call before lookups                                                                                           |
| `words/` package | Small change     | Load `lemma_map.json`, add `LemmaMap` field and `Resolve()` method                                                            |

Added to `server/wordfiles/`:

- `lemma_map.json` (surface → lemma, used by Go at runtime)

Removed from `server/wordfiles/` (dead):

- `vocab_query.bin` (dual embedding was KB-SBERT workaround; Wikipedia2Vec truly symmetric)

`meta.json` updates itself: `n` changes, `dims` → 300, `dual` → `false`.

---

## Execution Order

```text
Phase 1 (can start immediately):
  Download Wikipedia dump
  → Train Wikipedia2Vec (~1 day)
  → Validate model with Python sanity checks

Phase 3 (can be done in parallel with Phase 1):
  Rewrite stage_5.py for Wikipedia2Vec + lemmatization
  → Run stage_5.py once model is ready
  → Run stage_6.py
  → Run stage_7.py
  → Update Go words package (LemmaMap + Resolve)
  → Test full pipeline end-to-end

Phase 2 (only if Phase 1+3 playtest reveals gaps):
  Download Gigaword or SOU corpus
  → Train supplementary gensim word2vec
  → Add fallback lookup to stage_5.py
  → Re-run stage_5 onwards
```

---

## Decision Criteria

Migrate when:

- Wikipedia2Vec entity validation pass (curling near Wranå, musik near Avicii)
- Lemma map sanity checks pass (röd/röda/rött all resolve right)
- End-to-end pipeline run clean

Roll back to KB-SBERT and investigate if:

- Key entities from seeding CSVs return `None` from Wikipedia2Vec model
  (title mismatch, fix entity name or lower `--min-entity-count`)
- Word neighbours obviously wrong for common Swedish nouns
  (more `--iteration` passes or lower `--min-word-count`)

Add supplementary corpus (Phase 2) if:

- Playtest show common everyday words (food, colours, verbs) rank random, means
  undertrained in Wikipedia-only text

---

---
