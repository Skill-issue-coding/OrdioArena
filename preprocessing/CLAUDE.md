# Preprocessing

Offline NLP pipeline. Emits the binary word vectors the Go server loads at boot. Not affected by
the `server/` + `frontend/` rewrite, except that the S8 cutover moves `server/wordfiles/` to
`backend/wordfiles/` and changes three hardcoded paths here.

Read `preprocessing/README.md` for the stage-by-stage detail and `shared.py` exports. The root
`CLAUDE.md` carries the repo-wide invariants.

## Pipeline

Nine ordered stages producing the Go server's wordfiles. Wikipedia2Vec (`svwiki-w2v-300d`, 300
dims) trained on Swedish Wikipedia places words and named entities in one vector space, so entity
vectors come straight from the model and the nearest words per entity seed the vocabulary. General
vocabulary comes from Korp frequency data + the Kelly list + spaCy POS filtering
(`NOUN, PROPN, VERB, ADJ`). Stage-to-stage state passes through `intermediate/` (git-ignored).

Stages must run in order:

```bash
python stage_1.py … stage_7.py     # stage_8 optional, stage_9 enriches targets
```

Data sources: Kelly XML word list, Korp frequency CSVs with stopword filtering, Wikidata SPARQL
entity seeds, Swedish Wikipedia summaries, and Maktbarometern influencer lists (scraped by the Go
crawler at `preprocessing/seeding/maktbarometern/colly-crawler/`).

`MAIL` (in `preprocessing/.env.local`) is the User-Agent for SPARQL / Wikimedia requests.

## Output contract

Written to `server/wordfiles/`, consumed by the Go backend, which **fails to start** without them
(`words.InitializeDictionary()` loads them at boot). Never hand-edit them.

`vocab.bin` is raw little-endian float32 vectors, deliberately not CSV, so the server does no
parsing at startup. It is tracked in Git LFS. `vocab.json` is the word list, index-aligned with
`vocab.bin`. The remaining files are listed in `preprocessing/README.md`.

`preprocessing/model/` holds the ~3–4 GB Wikipedia2Vec model and is git-ignored.
