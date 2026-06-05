# Preprocessing Pipeline

This directory contains the NLP pipeline that builds the word embeddings used by the game server. The pipeline is based on **Wikipedia2Vec** trained on Swedish Wikipedia (`svwiki-w2v-300d`, 300-dimensional), replacing earlier approaches based on FastText and sentence transformers.

The core idea is that Wikipedia2Vec places both _words_ and _named entities_ in the same vector space. This means "Zlatan" as an entity and "fotboll" as a word end up near each other naturally — no manual context enrichment required at encode time.

State is passed between stages via files in `intermediate/` (git-ignored). The final output lands in `server/wordfiles/` where the Go backend loads it at startup.

---

## Prerequisites & Setup

1. **Environment variables**

   Create `.env.local` in this directory:

   ```bash
   MAIL=your-email@example.com   # used as User-Agent for SPARQL / Wikimedia API requests
   ```

2. **spaCy Swedish model**

   ```bash
   python -m spacy download sv_core_news_sm
   ```

3. **Python dependencies**

   ```bash
   pip install -r requirements.txt
   ```

   Key packages: `wikipedia2vec`, `spacy`, `pandas`, `requests`, `numpy`.

4. **Wikipedia2Vec model**

   The trained model file (`svwiki-w2v-300d.bin`, ~3–4 GB) must be placed at `preprocessing/model/svwiki-w2v-300d.bin`. See `plan.md` for training instructions if you need to retrain it.

5. **Korp frequency data**

   Place raw Korp CSV files inside [`korp/`](korp). The cleaning step runs automatically the first time.

---

## Running the Pipeline

Stages must be run in order from the `preprocessing/` directory. Each stage is idempotent — re-running a completed stage skips already-processed files.

```bash
# Korp data cleaning (run once, or after updating raw Korp files)
python -m korp.clean_korp

# Main pipeline
python stage_1.py   # SPARQL seeding + seeding cleaning → seeding/output/, intermediate/seeding_cleaned/
python stage_2.py   # Wikipedia summaries → intermediate/stage2_wiki/
python stage_3.py   # Wikidata attributes → intermediate/stage3_attrs/
python stage_4.py   # Korp + Kelly + spaCy → intermediate/stage4_general/
python stage_5.py   # Wikipedia2Vec encoding → intermediate/stage5_encoded/
python stage_6.py   # Binary export → server/wordfiles/
python stage_7.py   # Curated targets + notability scores → server/wordfiles/targets.json

# Optional: replace stage 6 output with PCA-reduced or top-K-filtered vocab
# python stage_8.py --dims 256         # PCA to 256 dims
# python stage_8.py --dims 256 --top-k 50

python stage_9.py   # Target quality enrichment → server/wordfiles/targets.json (overwrite)
```

### Logging

- **Terminal:** High-level progress only (warnings and above).
- **`pipeline.log`:** Full diagnostics, row counts, API errors, and timing. Check this file when a stage fails.

---

## Pipeline Overview

```mermaid
flowchart TD
    subgraph RAW [Raw Sources]
        KORP["Korp blog corpus\n(frequency data)"]
        KELLY["Kelly XML\n(Swedish dictionary)"]
        SPARQL["Wikidata SPARQL\n(entities per category)"]
        MAKT["Maktbarometern\n(social media influencers)"]
    end

    subgraph CLEAN [Data Cleaning]
        CK["korp/clean_korp.py\n→ intermediate/korp_cleaned/korp_combined_cleaned.csv"]
    end

    subgraph STAGE1 [Stage 1 — SPARQL Seeding + Cleaning]
        S1["stage_1.py\nSPARQL queries → seeding/output/*.csv\nclean_seeding → intermediate/seeding_cleaned/*.csv"]
    end

    subgraph STAGE2 [Stage 2 — Wikipedia Context]
        S2["stage_2.py\nFetches sv.wikipedia intro summaries\n→ intermediate/stage2_wiki/*.csv"]
    end

    subgraph STAGE3 [Stage 3 — Wikidata Attributes]
        S3["stage_3.py\nFetches P31/P106/P136… claims\nTranslates to Swedish strings\n→ intermediate/stage3_attrs/*.csv"]
    end

    subgraph STAGE4 [Stage 4 — General Vocabulary]
        S4["stage_4.py\nspaCy POS filter (NOUN/VERB/ADJ/PROPN)\nKorp frequency threshold\nKelly list validation\n→ intermediate/stage4_general/general_words.csv"]
    end

    subgraph STAGE5 [Stage 5 — Wikipedia2Vec Encoding]
        S5["stage_5.py\nEntity vectors from Wikipedia2Vec model\nHarvests top-250 nearest words per entity\nLemmatisation + reverse inflection expansion\n→ intermediate/stage5_encoded/\n   embeddings.npy  (N x 300 float32)\n   vocab.json      (N word strings)\n   lemma_map.json  (surface → lemma)\n→ server/wordfiles/\n   sources.json  lemma_map.json"]
    end

    subgraph STAGE6 [Stage 6 — Binary Export]
        S6["stage_6.py\n→ server/wordfiles/\n   vocab.bin   (raw float32, little-endian)\n   vocab.json  (word list)\n   meta.json   ({n, dims, dual})\n   sources.json  lemma_map.json"]
    end

    subgraph STAGE7 [Stage 7 — Contexto Targets]
        S7["stage_7.py\nFilters to game-worthy nouns + entities\nAttaches notability_score per target\n→ server/wordfiles/targets.json"]
    end

    subgraph STAGE8 [Stage 8 — Optional Post-processing]
        S8["stage_8.py  (optional)\nPCA dimensionality reduction  --dims D\nTop-K vocabulary filter  --top-k K\nRewrites server/wordfiles/vocab.bin, vocab.json, meta.json"]
    end

    subgraph STAGE9 [Stage 9 — Target Quality Enrichment]
        S9["stage_9.py\nCone quality filter (drops boring/frustrating targets)\nPer-target: sim_at_rank, antihive_threshold,\nimpostor_candidates\n→ server/wordfiles/targets.json (overwrite)"]
    end

    KORP --> CK
    SPARQL --> S1
    MAKT --> S1
    S1 --> S2
    S1 --> S7
    CK --> S4
    KELLY --> S4
    S2 --> S3
    S3 --> S5
    S4 --> S5
    S5 --> S6
    S5 --> S7
    S5 --> S9
    S6 --> S7
    S7 --> S8
    S6 --> S8
    S8 --> S9
    S7 --> S9
    S6 --> GO["Go backend\n(words.Dictionary)"]
    S8 --> GO
    S9 --> GO

    style RAW fill:transparent,stroke:#555,stroke-dasharray:5 5
    style CLEAN fill:transparent,stroke:#555,stroke-dasharray:5 5
    style STAGE1 fill:transparent,stroke:#333
    style STAGE2 fill:transparent,stroke:#333
    style STAGE3 fill:transparent,stroke:#333
    style STAGE4 fill:transparent,stroke:#333
    style STAGE5 fill:transparent,stroke:#333
    style STAGE6 fill:transparent,stroke:#333
    style STAGE7 fill:transparent,stroke:#333
    style STAGE8 fill:transparent,stroke:#555,stroke-dasharray:5 5
    style STAGE9 fill:transparent,stroke:#333
```

---

## Shared Configuration — [`shared.py`](shared.py)

All stages import constants and loaders from here. Key exports:

| Symbol                    | Purpose                                            |
| ------------------------- | -------------------------------------------------- |
| `BASE_DIR`                | Absolute path to this directory                    |
| `INTERMEDIATE_DIR`        | `intermediate/` — stage-to-stage scratch space     |
| `SEEDING_CLEANED_DIR`     | `intermediate/seeding_cleaned/` — cleaned CSVs     |
| `CLEANED_KORP_DIR`        | `intermediate/korp_cleaned/` — merged Korp file    |
| `OUTPUT_DIR`              | `server/wordfiles/` — final output for Go          |
| `DEFAULT_KORP_FREQ`       | Minimum Korp frequency for general words (300)     |
| `ALLOWED_POS`             | `{NOUN, PROPN, VERB, ADJ}`                         |
| `read_korp()`             | Loads `korp_combined_cleaned.csv` as list of dicts |
| `load_kelly()`            | Parses `kelly.xml` into a word set (cached)        |
| `load_custom_stopwords()` | Loads all CSVs from `stopwords/` (cached)          |
| `load_seeding()`          | Loads all CSVs from `seeding_cleaned/`             |
| `load_spacy()`            | Loads `sv_core_news_sm` with parser/NER disabled   |

---

## Stage Architecture

### Data Cleaning

**`korp/clean_korp.py`**

Run manually before stage 4, or whenever raw Korp files change. Reads raw Korp CSV files from `korp/`, filters to valid Swedish words (regex, minimum frequency, length checks), merges all files, and writes `intermediate/korp_cleaned/korp_combined_cleaned.csv` with schema `word, Totalt`.

**`seeding/clean_seeding.py`**

Called automatically by stage 1 — no separate invocation needed. Exposes two functions:

- `process_seeding()` — resolves raw Wikidata Q-IDs in `seeding/output/*.csv` to Swedish labels via the Wikidata API, cleans text, drops duplicates. Outputs to `intermediate/seeding_cleaned/`.
- `process_maktbarometern()` — processes Maktbarometern influencer CSVs from `seeding/maktbarometern/csv/` — normalises Unicode (NFKC), strips emojis and full-width characters, deduplicates by name (keeping highest score across platforms), sorts by score descending. Score thresholds per platform are configurable via `SCORE_LIMITS`.

---

### Stage 1 — SPARQL Seeding + Cleaning [`stage_1.py`](stage_1.py)

Queries Wikidata via SPARQL to fetch named entities grouped by category. Uses query definitions from [`seeding/queries/`](seeding/queries). After the queries complete, stage 1 calls `clean_seeding.process_seeding()` and `clean_seeding.process_maktbarometern()` so the cleaned seeding data is ready for stage 2 without a separate step.

Current queries:

| File                         | Category                                                     |
| ---------------------------- | ------------------------------------------------------------ |
| `swedish_celebrities.sparql` | Swedish public figures — athletes, politicians, royals       |
| `swedish_companies.sparql`   | Swedish-headquartered companies and brands                   |
| `global_brands.sparql`       | International consumer brands with high Wikidata sitelinks   |
| `video_games.sparql`         | Notable video games with Swedish Wikipedia articles          |
| `swedish_tv_and_film.sparql` | Swedish TV shows and films                                   |
| `swedish_music.sparql`       | Swedish musical artists                                      |
| `swedish_food.sparql`        | Swedish food and drink                                       |
| `swedish_characters.sparql`  | Fictional characters associated with Sweden                  |
| `swedish_geography.sparql`   | Swedish places, municipalities, and landmarks                |
| `apps_and_platforms.sparql`  | Social media platforms, streaming services, and popular apps |

All queries return at least `*Label` and `sitelinks` columns. Results are sorted by sitelinks descending and capped at 500 entries per category before saving.

- **Output:** `seeding/output/*.csv` — one file per category; `intermediate/seeding_cleaned/*.csv` — cleaned and label-resolved copies.

---

### Stage 2 — Wikipedia Context [`stage_2.py`](stage_2.py)

For each entity in the cleaned seeding CSVs, fetches the introductory paragraph from **Swedish Wikipedia** (`sv.wikipedia.org`). This is used for display context and Wikidata enrichment in later stages. Wikipedia2Vec already internalised Wikipedia content during training, so this data is not needed for embedding — it is used by stage 3 to supplement entity records.

Includes resume support: already-processed files are skipped, so the stage can safely be interrupted and restarted.

- **Reads:** `intermediate/seeding_cleaned/*.csv` (falls back to `seeding/output/` if cleaned dir is missing)
- **Output:** `intermediate/stage2_wiki/*.csv` — same schema plus a `wiki_summary` column

---

### Stage 3 — Wikidata Attributes [`stage_3.py`](stage_3.py)

Fetches structured Wikidata P-claims for each entity and translates them into readable Swedish attribute strings. Used alongside stage 2 data to enrich entity records stored in `stage3_attrs/`.

Properties fetched:

| Property | Swedish label | Example output                 |
| -------- | ------------- | ------------------------------ |
| P31      | Typ           | `Typ: datorspel.`              |
| P106     | Yrke          | `Yrke: skådespelare, sångare.` |
| P136     | Genre         | `Genre: action.`               |
| P452     | Bransch       | `Bransch: detaljhandel.`       |
| P178     | Utvecklare    | `Utvecklare: Mojang.`          |
| P641     | Sport         | `Sport: fotboll.`              |

Files without Wikidata Q-ID columns (e.g. Maktbarometern) pass through unchanged with an empty `wiki_attributes` column.

- **Reads:** `intermediate/stage2_wiki/*.csv`
- **Output:** `intermediate/stage3_attrs/*.csv` — adds a `wiki_attributes` column

---

### Stage 4 — General Vocabulary [`stage_4.py`](stage_4.py)

Builds the base Swedish dictionary from Korp frequency data. This covers everyday words (nouns, verbs, adjectives) that are not named entities.

Pipeline:

1. Load Korp rows, keep only those with `Totalt >= 300`
2. Drop custom stopwords (loaded from `stopwords/`)
3. Run spaCy POS tagging — keep `NOUN`, `VERB`, `ADJ`, `PROPN` only
4. Drop spaCy-identified stopwords
5. Cross-reference lemmas against the Kelly Swedish dictionary

- **Reads:** `korp_cleaned/korp_combined_cleaned.csv`, `kelly.xml`, `stopwords/*.csv`
- **Output:** `intermediate/stage4_general/general_words.csv` — columns: `word, lemma, pos, Totalt, in_kelly`

---

### Stage 5 — Wikipedia2Vec Encoding [`stage_5.py`](stage_5.py)

The core stage. Loads `svwiki-w2v-300d.bin` (the Wikipedia2Vec model trained on Swedish Wikipedia) and uses it to build the vocabulary and embeddings.

**How entity vectors are harvested:**

1. For each entity in `stage3_attrs/`, look up its entity vector directly from the Wikipedia2Vec model.
2. Batch matrix-multiply all entity vectors against the full model word matrix to get cosine similarities.
3. Keep the top 250 nearest words per entity (threshold: cosine sim ≥ 0.15). Each word keeps its best similarity score across all entities.
4. If the word bank is still below `TARGET_VOCAB_SIZE` (80 000), supplement with high-frequency Korp words.

**Lemmatisation and inflection expansion:**

- Every word in the bank is forward-lemmatised via spaCy (`sv_core_news_sm`). The canonical key in the vocab is the lemma.
- A reverse lookup then adds all attested Korp inflected forms of each lemma (e.g., if `bil` is in the bank, `bilar`, `bilens`, `bilarna` are added too). Inflected forms share the same vector as their lemma.
- The surface→lemma mapping is exported as `lemma_map.json` so the Go backend can resolve player input at runtime.

All vectors are **L2-normalised** so cosine similarity equals a dot product — no `sqrt` needed in the Go backend.

- **Reads:** `intermediate/stage3_attrs/*.csv`, `model/svwiki-w2v-300d.bin`
- **Output:**
  - `intermediate/stage5_encoded/embeddings.npy` — float32, shape (N, 300)
  - `intermediate/stage5_encoded/vocab.json` — list of N word strings, same row order
  - `intermediate/stage5_encoded/sources.json` — category per entry ("celebrity", "game", …, "general")
  - `intermediate/stage5_encoded/lemma_map.json` — `{surface_form: lemma}` for all attested inflections
  - `server/wordfiles/sources.json` and `server/wordfiles/lemma_map.json` — written directly so stage 6 can overwrite or confirm them

---

### Stage 6 — Binary Export [`stage_6.py`](stage_6.py)

Converts the numpy embeddings into a compact binary format that the Go backend can load instantly via `encoding/binary`. Avoids parsing large CSV floats at server startup.

Wikipedia2Vec is a symmetric embedding space (words and entities share one matrix, no query/passage distinction), so `dual` is always `false` and only one embedding file is written.

**Output files in `server/wordfiles/`:**

| File             | Contents                                                 |
| ---------------- | -------------------------------------------------------- |
| `vocab.bin`      | Raw little-endian float32, N x 300 bytes                 |
| `vocab.json`     | JSON list of N word strings (same order as rows)         |
| `meta.json`      | `{"n": N, "dims": 300, "dual": false}` -- shape metadata |
| `sources.json`   | Category label per entry (if produced by stage 5)        |
| `lemma_map.json` | Surface-to-lemma map for Go runtime resolution           |

A round-trip sanity check is run before exit: the first vector is re-read from disk and compared against the original numpy array.

- **Reads:** `intermediate/stage5_encoded/embeddings.npy`, `intermediate/stage5_encoded/vocab.json`
- **Output:** `server/wordfiles/vocab.bin`, `vocab.json`, `meta.json`, `sources.json`, `lemma_map.json`

---

### Stage 7 — Contexto Target List [`stage_7.py`](stage_7.py)

Not all words make good Contexto targets — function words, rare technical terms, and ambiguous short words all make for a bad game experience. This stage filters the full vocabulary down to a curated list of concrete, recognisable Swedish words and attaches a notability score to each.

Criteria for **general words:** POS = `NOUN`, Korp frequency ≥ 1 000, present in Kelly, length 4–20 characters.

Criteria for **entities:** must have at least some Wikipedia summary or Wikidata attributes, length 4–20 characters.

Both lists are additionally filtered against `stage5_encoded/vocab.json` to ensure only actually-encoded words are included.

**Notability scoring:**

After the target list is assembled, stage 7 attaches a `notability_score ∈ [0, 1]` to every entry. The score is the average of two independently normalised signals:

- **Wikidata sitelinks** — scraped by the SPARQL queries. Indicates how many Wikipedia language editions cover the entity; a proxy for global recognition. Normalised by the maximum sitelinks value across all seeding CSVs.
- **Maktbarometern score** — from `maktbarometern_cleaned.csv`. Ranks Swedish social media influencers by reach. Normalised by the maximum score in that dataset.

`notability_score = (sitelinks / max_sitelinks + makt_score / max_makt) / 2`

General vocabulary words (not found in either source) receive a score of `0.0`. The scores are written as-is to `targets.json`; the Go backend re-normalises them at load time so the highest value in the loaded list always maps to `1.0`.

- **Reads:** `intermediate/stage4_general/general_words.csv`, `intermediate/stage3_attrs/*.csv`, `intermediate/stage5_encoded/vocab.json`, `intermediate/seeding_cleaned/*.csv`
- **Output:** `server/wordfiles/targets.json` — sorted JSON list with schema `{word, type, notability_score}`

---

### Stage 8 — Optional Post-processing [`stage_8.py`](stage_8.py)

Optional stage that rewrites the `server/wordfiles/` binary output from stage 6. Run it after stage 7 (it requires `targets.json` to validate that no target words are dropped).

Two independent reductions can be combined:

- `--dims D` — PCA-reduces the embedding matrix from 300 to D dimensions using `TruncatedSVD`, then re-normalises. Halves file size at `--dims 150`. Explained variance is printed.
- `--top-k K` — keeps only the K nearest neighbours of each Contexto target. Has negligible effect when there are thousands of diverse targets (effectively every word ends up near some target). Only useful for small target lists.

If neither flag is passed, stage 8 is equivalent to stage 6.

- **Reads:** `intermediate/stage5_encoded/embeddings.npy`, `intermediate/stage5_encoded/vocab.json`, `server/wordfiles/targets.json`
- **Output:** overwrites `server/wordfiles/vocab.bin`, `vocab.json`, `meta.json`, `sources.json`

---

### Stage 9 — Target Quality Enrichment [`stage_9.py`](stage_9.py)

Overwrites `targets.json` with a richer format. For every target it computes the full cosine-similarity ranking across the whole vocabulary and attaches metadata. Fields from stage 7 (including `notability_score`) are preserved.

**`sim_at_rank`** — similarity values at ranks 10, 50, 100, 500, 1000. Lets the Contexto UI show calibrated hot/warm/cold hints that are consistent across all target words (a rank-200 guess near "Fotboll" means something different than rank-200 near "Avicii").

**`antihive_threshold`** — cosine distance at rank 500 for this specific target. Replaces the single global `MaxDistance` constant in Anti-Hivemind mode with a threshold that reflects the natural density of each word's neighbourhood.

**`impostor_candidates`** — up to 12 words selected as the impostor's hint word. Selection strategy differs by target type:

- **Entity targets** (`company`, `celebrity`, `game`, …): picks from `ENTITY_DESCRIPTOR_POOL`, a curated set of broad domain words (e.g. `["streaming", "dator", "konsol", …]` for companies; `["musik", "artist", "kändis", …]` for celebrities). Words are ranked by cosine similarity to the specific target so the most relevant domain words surface first — Google gets `söktjänst` and `webbtjänst`; Avicii gets `artist` and `musik`. A candidate is included if it ranks in the top `IMPOSTOR_POOL_GUARANTEED` (4) positions _or_ its similarity exceeds `IMPOSTOR_POOL_MIN_SIM` (0.35), whichever keeps more candidates.
- **General targets:** uses the original nearest-neighbour search (similarity range `[0.50, 0.80]`) so abstract nouns still receive semantically adjacent peer words.

**Cone quality filter** — targets are dropped if their similarity distribution is too concentrated (`sim@10 − sim@500 < 0.06`, meaning all words feel equally close) or too diffuse (`sim@10 − sim@500 > 0.72`, meaning almost nothing is near the target). Tunable at the top of the script.

- **Reads:** `intermediate/stage5_encoded/embeddings.npy`, `vocab.json`, `sources.json`, `lemma_map.json`; `server/wordfiles/targets.json`
- **Output:** `server/wordfiles/targets.json` — same word list, filtered and enriched with `sim_at_rank`, `antihive_threshold`, `impostor_candidates`

---

## Go Backend Integration

The Go server (`server/words/`) auto-detects the binary format on startup:

1. If `vocab.bin` + `vocab.json` + `meta.json` exist → load binary (fast path)
2. Otherwise → fall back to legacy `*_vectors.csv` files

The binary loader lives in `server/words/readbinary.go`. After loading, `LoadTargets()` applies a final normalisation pass so the highest `notability_score` in the loaded list maps to `1.0`, regardless of what the pipeline produced.

**Target selection at game start** uses `words.WeightedPickTarget`, which applies power-law weighting on `notability_score`:

```text
weight_i = (notability_score_i + 0.1) ^ 2
```

The `+0.1` epsilon ensures general vocabulary words (score = 0) are never completely excluded, while the exponent concentrates picks toward highly notable entities. A score-1.0 entity is ~75× more likely to be picked than a score-0 general word.

All game modes (Anti-Hivemind, Impostor) first filter to **entity targets only** (`type != "general"`) via `words.EntityTargets`. General Korp vocabulary is present in the `Dictionary.WordMap` so that player guesses are registered and scored, but it is never selected as the secret/target word. The general pool is used as a fallback only if no entity targets are available.

Because Wikipedia2Vec is a symmetric space, player guesses are looked up directly by key (via `LemmaMap` resolution). There is no query/passage asymmetry to handle — the same vector is used whether a word is a target or a guess.
