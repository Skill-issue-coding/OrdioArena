> **Status:** Implemented · **Updated:** 2026-08-20
>
> Historical record of the Wikipedia2Vec + lemmatization migration, which is complete. Split out of
> the old `preprocessing/plan.md`; its open half is now
> [`../design/0002-word-selection.md`](../design/0002-word-selection.md).
>
> Kept because the training and validation commands are the procedure for retraining the model,
> which `preprocessing/README.md` points at.

---

# Migration Notes: Wikipedia2Vec + Supplementary Corpus + Lemmatization

This document was the implementation roadmap for migrating to a Wikipedia2Vec-based
embedding model with a lemmatization-aware vocabulary. **The migration is complete.**

**Previous state:** KB-SBERT (`KBLab/sentence-bert-swedish-cased`) in `stage_5.py`, 768 dims,
dual-embedding structure, no lemmatization.

**Current state:** Wikipedia2Vec trained on Swedish Wikipedia (`svwiki-w2v-300d`), 300 dims,
single symmetric embedding file, general words keyed by lemma, surface-form resolution map
exported to Go as `lemma_map.json`.

---

## Phase 1: Wikipedia2Vec Training

### 1.1 Prerequisites

```bash
pip install wikipedia2vec
```

Hardware: 16+ GB RAM, decent multi-core CPU. Expect 12–24 hours of wall time on a
standard developer machine. No GPU needed , wikipedia2vec is CPU-bound skip-gram.
Output model file will be around 3-4 GB before any trimming.

### 1.2 Download the Swedish Wikipedia dump

```bash
# Save the dump into preprocessing/data/ (git-ignored)
mkdir -p preprocessing/data
wget -P preprocessing/data \
  https://dumps.wikimedia.org/svwiki/latest/svwiki-latest-pages-articles.xml.bz2
```

The file is around 3 GB compressed. You do not need to decompress it ,
wikipedia2vec reads `.xml.bz2` directly.

### 1.3 The Lsjbot problem and how to handle it

Lsjbot is a bot account that auto-generated roughly one million stub articles for
villages and animal species. These articles have almost no real content and will add
noise to word-level co-occurrences if they are treated like full articles.

The most effective filter is `--min-entity-count`. This flag sets the minimum number
of times an entity must be _linked to from other Wikipedia articles_ before it gets a
vector. Lsjbot stubs are obscure , they are rarely linked to from other articles ,
so raising this threshold naturally removes most of them without needing to preprocess
the XML dump.

For the game's entity set (celebrities, brands, games, geography, food), a threshold
of 10 is safe. The entities in your seeding CSVs are all well-known enough to appear
far more than 10 times in link context across Swedish Wikipedia.

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

Parameter notes:

- `--dim-size 300`: standard for word2vec; this is what original Contexto uses.
  300 dims at float32 = ~60 MB output vs current 200+ MB.
- `--window 5`: context window. 5 is a good general default.
- `--iteration 10`: more iterations = better quality, more time. Start here.
- `--negative 15`: negative sampling count. Higher is better quality, slower training.
- `--min-word-count 10`: filters low-frequency words that would get noisy vectors.

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

Run these checks before proceeding to pipeline integration. If an expected entity
returns `None`, the entity is below `--min-entity-count` or titled differently on
Swedish Wikipedia. Check the article title exactly (case-sensitive).

---

## Phase 2: Supplementary Corpus (Optional, Do Later)

Wikipedia likely covers all your game-target words well , the general vocabulary
is already filtered by Korp frequency and Kelly dictionary, meaning all target words
are common Swedish words that appear frequently in Wikipedia. Do not do this phase
until Phase 1 and Phase 3 are complete and you have playtested the result.

If playtesting reveals that certain general word categories have poor neighbours
(colloquial words, everyday verbs, food-specific terms), supplement with:

**Swedish Culturomics Gigaword Corpus**
A one-billion-word Swedish reference dataset from 1950 onwards, diverse sources.
Available at: `https://spraakbanken.gu.se/en/resources/gigaword`
Free to download after registering at Språkbanken (research use).

**SOU Corpus** (Statens offentliga utredningar)
Cleaned Swedish Government Official Reports 1994-2020. Very neutral, topically
diverse, covers health, education, environment, culture, sports, law.
Available via Språkbanken: search for "SOU" in their resource catalogue.

**How to use supplementary corpora alongside Wikipedia2Vec:**

Do not try to mix them into the Wikipedia2Vec training run , wikipedia2vec expects
Wikipedia XML as input, not plain text. Instead:

1. Train a separate standard word2vec model on the supplementary text using `gensim`
2. In stage 5, do a fallback lookup: if a general word is not in the Wikipedia2Vec
   model's word vocabulary, fetch its vector from the supplementary gensim model
3. Keep entity vectors exclusively from Wikipedia2Vec

This keeps the two training regimes clean and avoids vector space alignment problems.
Only implement this if you find a real gap after playtesting Phase 1+3.

**Sources to avoid:** Aftonbladet, Expressen, raw Common Crawl without quality filtering,
social media. Single-perspective or high-recency-bias corpora cause the exact
Aftonbladet problem you already encountered.

---

## Phase 3: Lemmatization Map

This is independent of Wikipedia2Vec and can be implemented alongside it or after.
It solves the inflection-proliferation problem: `röd`, `röda`, `rött` all resolve
to the same vector entry `röd`.

### 3.1 Stage 5 changes

In `load_general_words()`, switch from surface form to lemma as the canonical key.
Use `nlp.pipe()` (batch processing) to lemmatize , do not call `nlp()` per word, it
is orders of magnitude slower.

Two things to output from this function:

- `records`: keyed by lemma, used as before for embedding
- `lemma_map`: `{ surface_form: lemma }` for every word in the Korp CSV, exported
  as `lemma_map.json` to both `intermediate/stage5_encoded/` and
  `server/wordfiles/`

Entity names do not need lemmatization , they are proper nouns and the Wikipedia2Vec
entity lookup uses the article title directly.

### 3.2 Go changes

In the `words` package, add `LemmaMap map[string]string` to the `Dictionary` struct.
Load `server/wordfiles/lemma_map.json` at startup in `InitializeDictionary()`.

Add a `Resolve(input string) string` method that does a case-insensitive lookup in
`LemmaMap` and falls back to the raw lowercased input if not found.

Call `dict.Resolve(input)` before every `IsValid()` and `CalculateDistance()` call
in `main.go`. The resolved form is what gets displayed back to the player too ,
avoid showing the canonical lemma if the player typed an inflected form, just use
the resolved form internally for the vector lookup but echo their original input
in the UI.

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

spaCy's Swedish lemmatizer is rule-based and is occasionally wrong on uncommon words.
If you spot errors during playtesting, maintain a small `preprocessing/lemma_overrides.json`
with corrections (e.g. `{"körde": "köra", "löpte": "löpa"}`) and merge it into the
map before saving. This is a later concern , don't preempt it.

---

## Pipeline Change Summary

| Stage            | Status           | What changes                                                                                                                  |
| ---------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `stage_1.py`     | Unchanged        | ,                                                                                                                             |
| `stage_2.py`     | Unchanged        | ,                                                                                                                             |
| `stage_3.py`     | Unchanged        | ,                                                                                                                             |
| `stage_4.py`     | Unchanged        | Still produces `general_words.csv` with `word` + `lemma` columns                                                              |
| `stage_5.py`     | **Full rewrite** | Wikipedia2Vec lookup instead of sentence transformer; lemma as canonical key; single embedding file; exports `lemma_map.json` |
| `stage_6.py`     | Unchanged        | Same binary export, just 300 dims instead of 768                                                                              |
| `stage_7.py`     | Unchanged        | Target list logic unchanged                                                                                                   |
| `stage_8.py`     | Simplified       | PCA step is rarely needed at 300 dims; `--top-k` still useful                                                                 |
| `main.go`        | Small change     | Add `Resolve()` call before lookups                                                                                           |
| `words/` package | Small change     | Load `lemma_map.json`, add `LemmaMap` field and `Resolve()` method                                                            |

Files added to `server/wordfiles/`:

- `lemma_map.json` (surface → lemma, used by Go at runtime)

Files removed from `server/wordfiles/` (no longer needed):

- `vocab_query.bin` (dual embedding was a KB-SBERT workaround; Wikipedia2Vec is genuinely symmetric)

`meta.json` will update automatically: `n` changes, `dims` becomes 300, `dual` becomes `false`.

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

Proceed with the migration when:

- Wikipedia2Vec entity validation passes (curling near Wranå, musik near Avicii)
- Lemma map sanity checks pass (röd/röda/rött all resolve correctly)
- End-to-end pipeline runs without errors

Roll back to KB-SBERT and investigate if:

- Key entities from your seeding CSVs return `None` from the Wikipedia2Vec model
  (title mismatch , fix the entity name or lower `--min-entity-count`)
- Word neighbours are obviously wrong for common Swedish nouns
  (try more `--iteration` passes or a lower `--min-word-count`)

Add supplementary corpus (Phase 2) if:

- Playtesting shows that common everyday words (food, colours, verbs) feel
  randomly ranked , this indicates they are undertrained in Wikipedia-only text

---

---
