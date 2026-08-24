# Word Selection Improvement Plan

> **Status:** Largely implemented · **Tracking:** preprocessing backlog, not on rewrite roadmap · **Updated:** 2026-08-24
>
> Split from old `preprocessing/plan.md`; done Wikipedia2Vec migration half now
> [`../notes/preprocessing-w2v-migration.md`](../notes/preprocessing-w2v-migration.md).
>
> **Most of doc describe work already done.** Verified vs live code
> 2026-08-20: Problem A Fix 1 (Swedish pageviews gate) + Fix 2 (notability threshold) applied
> in `stage_7.py:326-345`; Fix 4 (celebrity birth-date cap) removed; Problem B Fix 1
> (`DOMAIN_VOCAB_EXPANSIONS`) injected in `stage_4.py:153-177`; Fix 4 (rejected-word logging)
> at `server/game/antimatch.go:391`.
>
> Still open: Problem A Fix 3, consumer/B2B company SPARQL split, `swedish_companies.sparql`
> still run beside two newer queries (`shared.py:54-58`). Read audit in
> [`../notes/code-vs-plan-audit.md`](../notes/code-vs-plan-audit.md) before act here.

---

## Word Selection Improvement Plan

## Background: Two Distinct Problems

Playtest expose two independent failures. Need different fixes.

**Problem A , Unknown entity as target:** celebrity, company, or show appear as
game word but players never heard of it. Cause: weak notability gating in
stage_7 (notability_score computed but never used as filter).

**Problem B , Missing associate vocabulary:** player know target, type
obvious related word ("aktier" for BlackRock, "atlet" for athlete), but
backend reject as unknown. Cause: general vocabulary stage (stage_4)
too conservative: Kelly + Korp ≥ 1000 filter out domain-specific but common Swedish
words absent from Kelly core ~8,000-word list.

Problem B worse UX than Problem A. Obscure target = annoying;
correct guess rejected = break trust in game.

---

## Critique of the Multi-Signal Scoring Plan

ChatGPT plan architecturally correct for media (TV shows, films).
Apply multi-signal principle to all categories but note gaps.

**What works:**

- Swedish Wikipedia as primary filter = right proxy: if Swedish editors
  wrote article, Swedish readers likely recognize it.
- Swedish TV presence (SVT, TV4, TV3…) strong real-world exposure signal for
  media only.
- Adversarial LLM review cheap way to surface systematic bias (recency, age-group,
  international) that weighted scoring miss.
- Multi-signal composite avoid brittleness: one noisy metric cannot dominate.

**What it miss:**

- Problem B entirely. Plan treat vocabulary coverage as solved. Not solved.
- Sitelinks poor proxy for company recognizability. BlackRock ~80 sitelinks
  (international notable) but unknown to Swedish consumers. Plan
  not distinguish international notability from Swedish consumer awareness.
- Stages 6–8 (adversarial loop, multi-persona consensus, stability testing)
  expensive, non-deterministic, hard to version. Good for initial calibration
  run; bad as recurring pipeline step. Run once, encode results as explicit
  threshold overrides, no automate loop.
- No minimum threshold defined. Plan give ranked list but never say "below
  this score, exclude from game." No cutoff = unknown entities still slip
  through.
- Swedish pageviews cited as top signal but no implementation path.

---

## Problem A: Fixing Entity Selection

### Root cause

`stage_7.py` → `collect_entity_targets()` include any entity with wiki context
and in `vocab.json`. `notability_score` attached to output JSON but
**never used as filter**. Effective threshold = 0.

### Fix 1: Swedish Wikipedia pageviews gate (new enrichment step)

Swedish pageviews = strongest signal Swedish readers care about
entity. Wikimedia give free:

```text
GET https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/sv.wikipedia/
    all-access/all-agents/{ARTICLE_TITLE}/monthly/{YYYYMM}/{YYYYMM}
```

Add to `stage_3.py` or new `stage_3b.py`:

- Every entity with Swedish Wikipedia article (already fetched in stage_2):
  call pageviews API for trailing 12 months.
- Compute `sv_pageviews_monthly_avg`, store in enriched CSV.
- Rate-limit 100 req/min (Wikimedia documented limit).
- Cache responses to disk , no re-fetch on rerun.

Suggested minimum: `sv_pageviews_monthly_avg >= 300`. Reject genuine stubs,
keep well-known entities. Tune after one playtest cycle.

### Fix 2: Notability threshold in stage_7

In `collect_entity_targets()`, apply score as gate, not label:

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

Entities with `score == 0` (no sitelinks, not in Maktbarometern) also
skipped unless pass pageviews gate from Fix 1.

### Fix 3: Company SPARQL , separate consumer from B2B

Current `swedish_companies.sparql` include enterprise/B2B entity types
(Q6881511, Q891723) beside consumer brands. Split into two queries:

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

OMX-listed Swedish companies (Volvo, Ericsson, H&M, Handelsbanken) household
names in Sweden. Use as guaranteed inclusions, bypass score thresholds.

**`swedish_b2b_companies.sparql`** , high notability threshold required:

- Keep private equity, asset management, consultancy types here.
- Include only if `notability_score > 0.20` AND `sv_pageviews > 1000`.
- BlackRock: US HQ, asset management, ~50 Swedish pageviews/month → excluded.

### Fix 4: Celebrity SPARQL , age range and career stage

Current `swedish_celebrities.sparql` filter `sitelinks > 3 && < 60`.
Upper cap 60 meant to exclude international megastars but also
exclude major Swedish celebrities (Robyn, Zlatan, Avicii all exceed 60 sitelinks).

Remove upper cap. Gate by Swedish pageviews instead (Fix 1). Athlete born
after 1990 with 8 sitelinks and 100 monthly Swedish pageviews = bad target;
Zlatan with 300+ sitelinks and 50,000 monthly pageviews = good.

---

## Problem B: Fixing Associate Vocabulary

### Root cause (Problem B)

Stage_4 general vocabulary require `in_kelly=True AND Korp freq ≥ 1000`. Kelly =
~8,000-word pedagogical core vocabulary, breadth over domain depth.
Domain-specific but common Swedish words , finance, sports, industry jargon , often
absent from Kelly even though every adult Swede know them.

Backend reject "aktier", "kapital", "atlet", "idrottsman" → player read as bug.
Not scoring problem; vocabulary coverage problem.

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

In `stage_4.py`, after standard Korp/Kelly filter, append domain expansion words:

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

Words failing Korp minimum (< 50) too rare in Swedish text for
reliable vector , skip, no add noise.

### Fix 3: Vocabulary gap report in stage_5

After build vocabulary in stage_5, print gap report:

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

Word with no vector cannot be added, any threshold. Need
Phase 2 (supplementary corpus) to fix.

### Fix 4: Rejected-word feedback loop in Go

In Go backend, when player submit word not in vocab, log it:

```go
// In the guess handler, after IsValid() returns false:
log.Printf("REJECTED_GUESS: %s", word)
```

Pipe to file. After playtest, feed `rejected_words.log` through stage_4
with `DOMAIN_VOCAB_KORP_MIN` to see which genuinely common. Add frequent
rejectees to `DOMAIN_VOCAB_EXPANSIONS`. Player-driven vocabulary
improvement loop, cost nothing.

---

## Applying the Multi-Signal Scoring Plan to All Categories

Adapt weighted score formula per entity category. Run in stage_7 to
produce `notability_score` (already field name in `targets.json`).

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

Minimum score to qualify as target: **0.08** all categories, starting
point. Tune after first post-fix playtest.

---

## Implementation Priority

| Fix                                       | Where                                        | Complexity | Impact                                                |
| ----------------------------------------- | -------------------------------------------- | ---------- | ----------------------------------------------------- |
| Domain vocab expansions                   | `shared.py` + `stage_4.py`                   | Low        | **High** , fix aktier/atlet directly                  |
| Notability threshold in `stage_7`         | `stage_7.py`                                 | Low        | **High** , stop unknown targets now                   |
| Company SPARQL split (consumer vs B2B)    | `seeding/queries/`                           | Low        | **High** , kill BlackRock-class mistakes at source    |
| Remove sitelinks upper cap on celebrities | `seeding/queries/swedish_celebrities.sparql` | Low        | High , stop excluding Zlatan/Robyn                    |
| Swedish pageviews gate                    | `stage_3.py` or `stage_3b.py`                | Medium     | High , strongest long-term signal                     |
| OMX-listed query                          | `seeding/queries/`                           | Low        | Medium , guaranteed quality floor for companies       |
| Rejected-word log in Go                   | `main.go` or handler                         | Low        | Medium , free feedback loop                           |
| Vocabulary gap report                     | `stage_5.py`                                 | Low        | Medium , surface Phase 2 needs                        |

Do domain vocab expansions + notability threshold first , one-day changes,
fix both complaints, no re-run embedding model.

---

## What to Skip from the ChatGPT Plan

- **Consensus multi-persona reviewers (stages 7–8):** good for initial one-off
  calibration. No automate. Signal noisy and expensive; encode conclusions
  as explicit threshold overrides instead.
- **Stability testing (stage 9):** QA, not ranking. Run manually after
  major pipeline changes, not as pipeline stage.
- **TMDB integration:** worth adding only if Swedish productions score
  too low vs international. No add data sources preemptively.