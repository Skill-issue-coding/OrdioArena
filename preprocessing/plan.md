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

## Word Selection Improvement Plan

## Background: Two Distinct Problems

Playtesting exposed two independent failures. Fixing them requires different interventions.

**Problem A , Unknown entity as target:** A celebrity, company, or show appears as a
game word but players have never heard of it. Caused by weak notability gating in
stage_7 (notability_score is computed but never used as a filter).

**Problem B , Missing associate vocabulary:** The player knows the target and types
an obvious related word ("aktier" for BlackRock, "atlet" for an athlete), but the
backend rejects it as unknown. Caused by the general vocabulary stage (stage_4) being
too conservative: Kelly + Korp ≥ 1000 filters out domain-specific but common Swedish
words that are not in Kelly's core ~8,000-word list.

Problem B causes worse UX than Problem A. A slightly obscure target is frustrating;
a correct guess being rejected breaks trust in the game.

---

## Critique of the Multi-Signal Scoring Plan

The ChatGPT-authored plan is architecturally correct for media (TV shows, films).
Apply the multi-signal principle to all categories but note its gaps.

**What works:**

- Swedish Wikipedia as primary filter is the right proxy: if Swedish-language editors
  considered something notable enough to write an article, Swedish readers likely
  recognize it.
- Swedish TV presence (SVT, TV4, TV3…) is a strong real-world exposure signal for
  media specifically.
- Adversarial LLM review is a cheap way to surface systematic bias (recency, age-group,
  international) that weighted scoring misses.
- Multi-signal composite avoids brittleness: one noisy metric can't dominate.

**What it misses:**

- Problem B entirely. The plan treats vocabulary coverage as solved. It is not.
- Sitelinks are a poor proxy for company recognizability. BlackRock has ~80 sitelinks
  (internationally notable) but is essentially unknown to Swedish consumers. The plan
  does not distinguish international notability from Swedish consumer awareness.
- Stages 6–8 (adversarial loop, multi-persona consensus, stability testing) are
  expensive, non-deterministic, and hard to version. Useful for an initial calibration
  run; bad as a recurring pipeline step. Run once, encode results as explicit
  threshold overrides, do not automate the loop.
- No minimum threshold defined. The plan produces a ranked list but never says "below
  this score, exclude from the game." Without a cutoff, unknown entities still slip
  through.
- Swedish pageviews cited as the top signal but with no implementation path.

---

## Problem A: Fixing Entity Selection

### Root cause

`stage_7.py` → `collect_entity_targets()` includes any entity that has wiki context
and is in `vocab.json`. The `notability_score` is attached to the output JSON but
**never used as a filter**. The effective threshold is 0.

### Fix 1: Swedish Wikipedia pageviews gate (new enrichment step)

Swedish pageviews are the single strongest signal that Swedish readers care about an
entity. Wikimedia provides this for free:

```text
GET https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/sv.wikipedia/
    all-access/all-agents/{ARTICLE_TITLE}/monthly/{YYYYMM}/{YYYYMM}
```

Add to `stage_3.py` or as a new `stage_3b.py`:

- For every entity with a Swedish Wikipedia article (already fetched in stage_2),
  call the pageviews API for the trailing 12 months.
- Compute `sv_pageviews_monthly_avg` and store it in the enriched CSV.
- Rate-limit to 100 req/min (Wikimedia's documented limit).
- Cache responses to disk , do not re-fetch on reruns.

Suggested minimum: `sv_pageviews_monthly_avg >= 300`. This rejects genuine stubs
while keeping well-known entities. Tune after one playtest cycle.

### Fix 2: Notability threshold in stage_7

In `collect_entity_targets()`, apply the score as a gate, not just a label:

```python
MIN_NOTABILITY_BY_CAT = {
    "celebrity": 0.08,
    "company":   0.10,
    "media":     0.05,   # lower , Swedish productions score lower on sitelinks
    "character": 0.03,
    "game":      0.05,
}

# inside the loop:
score = compute_notability_score(name, sitelinks_lookup, makt_lookup, max_sl, max_mk)
threshold = MIN_NOTABILITY_BY_CAT.get(cat, 0.05)
if score > 0 and score < threshold:
    continue  # known to be obscure , skip
```

Entities with `score == 0` (no sitelinks, not in Maktbarometern) should also be
skipped unless they pass the pageviews gate from Fix 1.

### Fix 3: Company SPARQL , separate consumer from B2B

The current `swedish_companies.sparql` includes enterprise/B2B entity types
(Q6881511, Q891723) alongside consumer brands. Split into two queries:

**`swedish_consumer_companies.sparql`** , high weight, no country restriction:

```sparql
VALUES ?consumerType {
    wd:Q245081    # clothing/fashion brand
    wd:Q270791    # supermarket chain
    wd:Q212108    # restaurant chain
    wd:Q180792    # department store
    wd:Q1632403   # automotive manufacturer
    wd:Q1294722   # food company
}
?company wdt:P31 ?consumerType .
# No P17 country filter , IKEA, Porsche, H&M are Swedish-known global brands
FILTER(?sitelinks > 20)
```

**`swedish_omx_companies.sparql`** , companies listed on Nasdaq OMX Stockholm:

```sparql
?company wdt:P414 wd:Q204677 .   # stock exchange: Nasdaq Stockholm
?company wdt:P17 wd:Q34 .        # country: Sweden
```

OMX-listed Swedish companies (Volvo, Ericsson, H&M, Handelsbanken) are household
names in Sweden. Use these as guaranteed inclusions, bypassing score thresholds.

**`swedish_b2b_companies.sparql`** , high notability threshold required:

- Keep private equity, asset management, consultancy types here.
- Only include if `notability_score > 0.20` AND `sv_pageviews > 1000`.
- BlackRock: US HQ, asset management, ~50 Swedish pageviews/month → excluded.

### Fix 4: Celebrity SPARQL , age range and career stage

The current `swedish_celebrities.sparql` filters `sitelinks > 3 && < 60`. The
upper cap of 60 is intended to exclude international megastars but it inadvertently
excludes major Swedish celebrities (Robyn, Zlatan, Avicii all exceed 60 sitelinks).

Remove the upper cap. Instead gate by Swedish pageviews (Fix 1). An athlete born
after 1990 with 8 sitelinks and 100 monthly Swedish pageviews is not a good target;
Zlatan with 300+ sitelinks and 50,000 monthly pageviews obviously is.

---

## Problem B: Fixing Associate Vocabulary

### Root cause (Problem B)

Stage_4 general vocabulary requires `in_kelly=True AND Korp freq ≥ 1000`. Kelly is
an ~8,000-word pedagogical core vocabulary that prioritizes breadth over domain depth.
Domain-specific but genuinely common Swedish words , financial terms, sports terms,
industry jargon , are often absent from Kelly even though every adult Swede knows them.

When the backend rejects "aktier", "kapital", "atlet", or "idrottsman", the player
reads it as a bug. It is not a scoring problem; it is a vocabulary coverage problem.

### Fix 1: Domain vocabulary expansions in shared.py

Add to `shared.py`:

```python
# Words that bypass Kelly and use a lower Korp threshold.
# Each list covers the semantic field players naturally reach for per category.
DOMAIN_VOCAB_EXPANSIONS: dict[str, list[str]] = {
    "celebrity": [
        "atlet", "idrottare", "idrottsman", "mästare", "tränare",
        "rekord", "tävling", "turnering", "debut", "karriär",
        "meritlista", "lagkapten", "landslagsman",
    ],
    "company": [
        "aktier", "aktie", "kapital", "fond", "investering",
        "portfölj", "vinst", "omsättning", "börs", "marknad",
        "varumärke", "koncern", "dotterbolag", "vd", "styrelse",
    ],
    "media": [
        "säsong", "avsnitt", "regissör", "manus", "premiär",
        "handling", "karaktär", "rollista", "remake",
        "dokumentär", "reality",
    ],
    "game": [
        "spelmekanik", "expansion", "patch", "multiplayer",
        "singleplayer", "storyline", "gameplay", "esport",
    ],
}

DOMAIN_VOCAB_KORP_MIN = 50   # much lower than DEFAULT_KORP_FREQ=300
```

### Fix 2: Inject domain words in stage_4 or stage_7

In `stage_4.py`, after the standard Korp/Kelly filter, append domain expansion words:

```python
from shared import DOMAIN_VOCAB_EXPANSIONS, DOMAIN_VOCAB_KORP_MIN

# Load Korp for frequency lookup
korp_rows = read_korp()
korp_freq = {row["word"].lower(): int(row.get("Totalt", 0) or 0) for row in korp_rows}

domain_extras = []
for cat, words in DOMAIN_VOCAB_EXPANSIONS.items():
    for w in words:
        freq = korp_freq.get(w, 0)
        if freq >= DOMAIN_VOCAB_KORP_MIN:
            domain_extras.append({"word": w, "lemma": w, "pos": "NOUN",
                                   "Totalt": freq, "in_kelly": False,
                                   "_domain_cat": cat})

df_extras = pd.DataFrame(domain_extras)
df_filtered = pd.concat([df_filtered, df_extras], ignore_index=True)
```

Words that fail the Korp minimum (< 50) are not common enough in Swedish text to
have a reliable vector , skip them rather than adding noise.

### Fix 3: Vocabulary gap report in stage_5

After building the vocabulary in stage_5, print a gap report:

```python
from shared import DOMAIN_VOCAB_EXPANSIONS

missing_by_cat: dict[str, list[str]] = {}
for cat, words in DOMAIN_VOCAB_EXPANSIONS.items():
    missing = [w for w in words if model.get_word(w) is None]
    if missing:
        missing_by_cat[cat] = missing

if missing_by_cat:
    log.warning("Domain vocab gaps (no vector in w2v model):")
    for cat, words in missing_by_cat.items():
        log.warning(f"  [{cat}]: {words}")
```

If a word has no vector, it cannot be added regardless of thresholds. These need
Phase 2 (supplementary corpus) to resolve.

### Fix 4: Rejected-word feedback loop in Go

In the Go backend, when a player submits a word not found in vocab, log it:

```go
// In the guess handler, after IsValid() returns false:
log.Printf("REJECTED_GUESS: %s", word)
```

Pipe this to a file. After playtesting, feed `rejected_words.log` through stage_4
with `DOMAIN_VOCAB_KORP_MIN` to see which are genuinely common. Add frequent
rejectees to `DOMAIN_VOCAB_EXPANSIONS`. This creates a player-driven vocabulary
improvement loop that costs nothing.

---

## Applying the Multi-Signal Scoring Plan to All Categories

Adapt the weighted score formula per entity category. Run this in stage_7 to
produce `notability_score` (already the field name in `targets.json`).

### Celebrity

```python
score = (
    0.35 * normalize(sv_pageviews_monthly_avg, cap=50_000) +
    0.30 * normalize(maktbarometern_score) +
    0.25 * normalize(sitelinks, cap=300) +
    0.10 * float(has_sv_wikipedia_article)
)
```

### Company (consumer)

```python
score = (
    0.40 * normalize(sv_pageviews_monthly_avg, cap=20_000) +
    0.30 * consumer_type_weight +   # 1.0 consumer, 0.5 mixed, 0.2 B2B
    0.20 * float(is_omx_listed) +
    0.10 * normalize(sitelinks, cap=200)
)
```

### TV / Film (ChatGPT plan applies directly)

```python
score = (
    0.30 * normalize(sv_pageviews_monthly_avg, cap=30_000) +
    0.25 * normalize(swedish_channel_broadcast_count) +
    0.20 * normalize(sitelinks, cap=150) +
    0.15 * float(is_swedish_production) +
    0.10 * normalize(tmdb_popularity)   # add TMDB fetch if desired
)
```

Minimum score to qualify as a target: **0.08** across all categories as a starting
point. Tune after first post-fix playtest session.

---

## Implementation Priority

| Fix                                       | Where                                        | Complexity | Impact                                                |
| ----------------------------------------- | -------------------------------------------- | ---------- | ----------------------------------------------------- |
| Domain vocab expansions                   | `shared.py` + `stage_4.py`                   | Low        | **High** , directly fixes aktier/atlet                |
| Notability threshold in `stage_7`         | `stage_7.py`                                 | Low        | **High** , stops unknown targets immediately          |
| Company SPARQL split (consumer vs B2B)    | `seeding/queries/`                           | Low        | **High** , removes BlackRock-class mistakes at source |
| Remove sitelinks upper cap on celebrities | `seeding/queries/swedish_celebrities.sparql` | Low        | High , stops excluding Zlatan/Robyn                   |
| Swedish pageviews gate                    | `stage_3.py` or `stage_3b.py`                | Medium     | High , strongest long-term signal                     |
| OMX-listed query                          | `seeding/queries/`                           | Low        | Medium , guaranteed quality floor for companies       |
| Rejected-word log in Go                   | `main.go` or handler                         | Low        | Medium , free feedback loop                           |
| Vocabulary gap report                     | `stage_5.py`                                 | Low        | Medium , surfaces Phase 2 needs                       |

Do domain vocab expansions and notability threshold first , they are one-day changes
that directly fix both complaints without re-running the embedding model.

---

## What to Skip from the ChatGPT Plan

- **Consensus multi-persona reviewers (stages 7–8):** Useful for an initial one-off
  calibration. Do not automate. The signal is noisy and expensive; encode conclusions
  as explicit threshold overrides instead.
- **Stability testing (stage 9):** This is QA, not ranking. Run it manually after
  major pipeline changes, not as a pipeline stage.
- **TMDB integration:** Only worth adding if you find that Swedish productions score
  too low relative to international ones. Do not add data sources preemptively.
