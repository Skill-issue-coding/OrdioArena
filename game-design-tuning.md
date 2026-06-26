# Game Design & Scoring Tuning — Options, Trade-offs, and Effects

Scope: design/balance tuning for the word modes (primarily **Anti-Match**, with
notes on Impostor), grounded in the actual Go scoring code and the Wikipedia2Vec
preprocessing pipeline. For each lever: **what it is**, **pros**, **cons**,
**performance impact**, and **game-feel impact**.

This is a thinking document, not a spec. Nothing here is implemented unless
stated. Numbers are starting points to playtest, not final values.

---

## 0. Where the relevant knobs live today

| Concern                  | Location                                            | Current behaviour                                                   |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------------------------- |
| Anti-Match score formula | `server/game/antimatch.go` ~L255                    | `score = max(0, 100 - dist*100)`, linear in cosine distance         |
| "Too random" rejection   | `server/game/antimatch.go:252` (`matchThreshold()`) | **Defined but never called** — only dictionary existence is checked |
| Duplicate penalty        | `antimatch.go` ~L241                                | Exact string match → all duplicates get 0                           |
| Per-target threshold     | `words/types.go` `AntiHiveThreshold`                | cosine distance at rank 500, loaded, **unused in scoring**          |
| Per-target calibration   | `words/types.go` `SimAtRank`                        | rank 10/50/100/500/1000 sims, loaded, **unused**                    |
| Target selection         | `words/util.go` `WeightedPickTarget`                | `weight = (notability + 0.1)^2`, power-law                          |
| Notability gate          | preprocessing `stage_7.py`                          | score computed but **never used as a filter** (threshold = 0)       |
| Vocabulary coverage      | preprocessing `stage_4.py`                          | `in_kelly AND korp_freq ≥ 1000`                                     |
| Default timers/rounds    | `game/defaultSettings.go`                           | Anti-Match: 20s input, 3 rounds                                     |

Two of these — the unused `matchThreshold()` and the unused notability gate —
are the highest-leverage fixes because the machinery already exists; it just
isn't wired in.

---

## 1. The Anti-Match scoring curve

### 1a. Current: linear `100 * (1 - distance)`

Cosine distance ∈ [0, 2]; for related words it sits roughly in [0.3, 0.8], so
scores cluster in **20–70** and rarely exceed ~50 (observed: best word of a whole
game was `bank`→`Citibank` = 48). The space above 50 is almost never reached,
so the visible range is compressed into the lower half.

**Pros:** trivial, predictable, monotonic, zero tuning data needed.
**Cons:** feels punishing and flat — players see 0/11/32/48 and can't tell a
"good" answer from a "lucky" one; the headroom (50–100) is wasted.
**Performance:** one multiply; negligible.
**Game feel:** the core complaint. Scores look harsh and samey.

### 1b. Rescale into the usable band (cheap win)

Map the _realistic_ distance band to the full 0–100 range instead of the
theoretical one. E.g. treat `dist = 0.30` as ~100 and `dist = matchThreshold`
as ~0, linearly between:

```go
norm = (threshold - dist) / (threshold - bestDist)   // bestDist ≈ 0.30
score = clamp(0, 100, round(norm * 100))
```

**Pros:** uses the whole bar; "good" answers finally feel good; no new data —
`AntiHiveThreshold` already exists per target.
**Cons:** needs a sensible `bestDist` floor (per-target via `SimAtRank` is better
than a global constant); slightly less "honest" about raw similarity.
**Performance:** still O(1).
**Game feel:** large positive. This alone probably resolves "scores feel
punishing" without touching anything else.

### 1c. Non-linear curve (reward the top end)

Apply a curve so the gap between "great" and "good" widens:

- **Exponential / power:** `score = 100 * norm^0.6` (lifts mid scores), or
  `^1.5` (punishes all but the best). Pick by desired generosity.
- **Sigmoid around the threshold:** flat-bad below, flat-great above, steep in
  the contested middle — makes the "did my word make the cone?" moment dramatic.

**Pros:** tunable drama; can make near-misses feel close and wins feel earned.
**Cons:** one more magic constant; easy to over-tune into "everyone gets 90" or
"everyone gets 10"; must be playtested with real players.
**Performance:** one `pow`/`exp` per submission per round — trivial at party
scale (≤12 players).
**Game feel:** high ceiling, high risk. Do **after** 1b, not instead of it.

### 1d. Rank-based scoring instead of distance-based

Score by the word's **rank** in the target's neighbour list (which `SimAtRank`
already characterises) rather than raw cosine. "Top-50 neighbour = 100, rank
500 = 0."

**Pros:** automatically calibrated per target — dense neighbourhoods (Fotboll)
and sparse ones (Avicii) feel consistent, which is exactly why `SimAtRank`
exists. Removes the "some targets just score low" unfairness.
**Cons:** needs the full ranking at runtime, or a precomputed interpolation from
`SimAtRank`. Computing true rank per guess = one dot product against the whole
vocab (~93k × 300) **per submission** — heavier (see Performance).
**Performance:** full-vocab rank is ~28M multiply-adds per guess. At ≤12
players/round that's fine (<10 ms), but it's 1000× the current cost. The cheaper
path: interpolate rank from the 5 `SimAtRank` checkpoints already loaded — O(1).
**Game feel:** the most "fair" option; the per-target consistency is the whole
point of stage 9. Recommended target state, via the interpolation shortcut.

---

## 2. Enforce the "anti-hive" cone (`matchThreshold` is dead code)

Right now any dictionary word scores; `matchThreshold()` is never called. The
intended mechanic — "words too far from the target are rejected/zeroed as too
random" — does not exist.

### 2a. Zero-score beyond threshold

If `dist > AntiHiveThreshold`, award 0 (but still record the word).

**Pros:** restores the designed mechanic; stops "spam any valid word, get
points"; pairs naturally with 1b's rescale (threshold = the 0 point).
**Cons:** harsher; a near-miss gets nothing. Per-target threshold quality
depends on stage 9 enrichment being present (fallback 0.5 is crude).
**Performance:** one comparison; free.
**Game feel:** adds stakes ("stay in the cone"), but can frustrate if the
threshold is too tight. Tune the rank-500 cutoff up/down per playtest.

### 2b. Reject at submit time vs. zero at scoring time

- **Reject at submit** (like the dictionary check): immediate "too unrelated"
  toast, player retries. Tighter feedback loop.
- **Zero at scoring:** player commits, learns at reveal.

**Pros (reject):** teaches the cone fast; fewer wasted rounds.
**Cons (reject):** can feel like the game "argues" with you (see the dictionary
rejection UX problem in §5); risk of rejecting reasonable words if threshold is
mis-tuned. **Cons (zero):** silent failure until reveal.
**Performance:** identical, O(1).
**Game feel:** reject = strict/instructive, zero = forgiving/suspenseful. Given the
existing frustration with dictionary rejections, **zero-at-scoring is the safer
default**; only reject at submit for _egregiously_ far words (dist ≫ threshold).

---

## 3. Duplicate / collision penalty

### 3a. Current: exact-string duplicates → 0

Two players type the identical lemma → both get 0.

**Pros:** simple, matches the "be unique" pitch, easy to explain.
**Cons:** purely lexical. `bil` vs `bilen` resolve to the same lemma (good), but
`fotboll` vs `boll` — clearly related — are treated as fully distinct and
both score. The penalty is all-or-nothing and ignores semantics.
**Performance:** a frequency map; O(players).
**Game feel:** the "jinx" moment is fun, but near-synonyms slipping through
undercuts the anti-hivemind fantasy.

### 3b. Semantic-cluster penalty

Penalise words that are _too close to each other_, not just identical: if two
submissions are within ε cosine of one another, split or reduce their points.

**Pros:** rewards genuinely original thinking; deepens the core mechanic.
**Cons:** O(players²) distance checks (trivial at ≤12), but mainly **harder to
explain** and can feel arbitrary ("why did we both lose points, those aren't the
same word?"). Needs a visible explanation in the result UI.
**Performance:** ≤12² = 144 dot products/round; nothing.
**Game feel:** higher skill ceiling, but raises "the game is judging me"
risk. Optional/advanced-mode candidate, not a default.

### 3c. Graduated duplicate penalty

Instead of 0, split the points among duplicators (e.g. each gets `score / n`).

**Pros:** softer; collisions sting but don't fully waste a round; still
incentivises uniqueness.
**Cons:** weakens the clean "duplicates = 0" rule players quickly learn.
**Performance:** free.
**Game feel:** friendlier for casual groups; less punchy. A/B against 3a.

---

## 4. Target selection & notability (the "obscure target" complaint)

Observed bad targets: `Citibank`, `Glenn Ljungström`, `ThyssenKrupp`. The
machinery to prevent this exists but is half-used.

### 4a. Actually apply a notability floor (preprocessing `stage_7`)

`notability_score` is computed and stored but never gates inclusion (threshold
= 0). Add a per-category minimum (the plan suggests 0.05–0.10).

**Pros:** removes ThyssenKrupp-class targets _at the source_; one-line filter;
no model retrain.
**Cons:** shrinks the target pool — if the floor is too high you get repetitive
targets; sitelinks are a poor proxy for _Swedish_ recognisability (BlackRock has
many sitelinks, near-zero Swedish awareness). Best paired with the Swedish
pageviews signal from `plan.md` Fix 1.
**Performance:** build-time only; runtime unaffected (smaller `targets.json`).
**Game feel:** big win — fewer "who?" moments. The single highest-impact design
change, and it's a preprocessing edit, not a code change.

### 4b. Tune the runtime power-law weighting

`weight = (notability + 0.1)^2`. The `^2` makes a 1.0 entity ~75× likelier than
a 0.0 word; the `+0.1` floor keeps obscure ones in play.

- **Raise exponent (→3):** concentrate harder on famous targets.
- **Lower epsilon (→0.03):** make obscure targets much rarer without excluding
  them.

**Pros:** instant difficulty knob, no pipeline rerun (constants in
`words/util.go`); reversible.
**Cons:** doesn't _remove_ bad targets, only down-weights them — a 0.0 entity
can still surface occasionally. Interacts with 4a (do the floor first).
**Performance:** none.
**Game feel:** smooth difficulty dial; cheap to experiment with live.

### 4c. Category-aware selection

Weight or rotate by category (companies, celebrities, food, geography…) so a
session doesn't serve three obscure companies in a row.

**Pros:** variety; avoids clustering on a weak category; lets you weight
crowd-pleasers (food, geography) over B2B firms.
**Cons:** more selection state; needs category labels surfaced to the picker
(they exist in `sources.json`). Risk of feeling "on rails."
**Performance:** negligible.
**Game feel:** better pacing and variety across a multi-round game.

### 4d. Difficulty setting (host-controlled)

Expose an easy/normal/hard toggle that maps to a notability floor + exponent.

**Pros:** lets groups self-select; "hard" can keep the obscure targets some
players enjoy; future-proofs the tuning.
**Cons:** new setting to surface in lobby UI + plumb through
`AntiMatchSettings`; more QA surface.
**Performance:** none.
**Game feel:** strong for replayability and group fit; medium build cost.

---

## 5. Vocabulary coverage (the "common word rejected" complaint)

Observed rejections of ordinary Swedish: `skådespelare`, `atlet`, `man`. This is
`plan.md`'s "Problem B" and is _worse_ than obscure targets — a rejected correct
guess reads as a bug and breaks trust.

### 5a. Lower the Korp/Kelly gate (preprocessing `stage_4`)

Current: `in_kelly AND korp_freq ≥ 1000`. Kelly is a ~8k pedagogical core that
omits common domain words.

- Drop the hard Kelly requirement, or
- Lower Korp threshold (1000 → 300/500) for non-Kelly words, or
- Add curated `DOMAIN_VOCAB_EXPANSIONS` (already drafted in `plan.md`).

**Pros:** directly fixes rejections of words every adult Swede knows; expands
what counts as a valid guess; cheap (build-time list edit).
**Cons:** lowering thresholds admits rarer words with **noisier vectors** —
a word with a bad vector scores semi-randomly, which is its own feel problem.
Bigger vocab = marginally larger `vocab.bin` and load.
**Performance:** build-time; runtime memory grows ~linearly with vocab (currently
~93k × 300 × 4B ≈ 110 MB; +10k words ≈ +12 MB). Lookups stay O(1).
**Game feel:** removes the trust-breaking rejections. High priority, low risk if
you keep a Korp floor (≥50) so only attested words enter.

### 5b. "Did you mean / close match" on rejection

When a word is rejected, suggest the nearest in-vocab lemma (edit-distance or the
`LemmaMap`).

**Pros:** turns a dead-end into a recovery; softens the strictness.
**Cons:** edit-distance over 93k keys per rejection needs care (prefix index or
bounded Levenshtein); risk of weird suggestions.
**Performance:** naive scan is 93k string ops per rejection — acceptable but
worth a trie/prefix bucket if it's hot.
**Game feel:** much friendlier failure mode; pairs well with 5a.

### 5c. Rejected-word telemetry → vocabulary loop

We **now log every rejection** (`game.log`: `word rejected (not in dictionary)`).
Mine it: frequent legit rejectees → add to domain expansions. This is exactly
`plan.md` Fix 4, and the logging you just built is the data source.

**Pros:** player-driven, free, self-correcting; no guessing which words to add.
**Cons:** requires a periodic manual pass over logs; only as good as playtest
volume.
**Performance:** offline analysis; zero runtime cost.
**Game feel:** compounding improvement over time. Low effort, do it.

### 5d. Lemmatisation correctness

`man` rejected suggests a lemma/inflection gap. `plan.md` Phase 3 mentions a
`lemma_overrides.json` for spaCy mistakes.

**Pros:** fixes systematic wrong-lemma rejections; small override file.
**Cons:** manual curation; spaCy Swedish is rule-based and occasionally wrong on
uncommon forms.
**Performance:** build-time; none at runtime.
**Game feel:** removes a class of baffling rejections.

---

## 6. Round structure & timers

### 6a. Input duration (default 20s)

**Shorter (10–15s):** urgency, faster games, more gut-instinct answers (which
_helps_ anti-match — less time to converge on the obvious word).
**Longer (30–45s):** thoughtful, but more hivemind convergence and dead air.

**Pros (short):** pace, energy, better mechanic fit.
**Cons (short):** slower typers/non-natives disadvantaged; more empty
submissions. **Cons (long):** drags, especially with the `SYNC_DELAY` overhead.
**Performance:** none.
**Game feel:** large. Lean **short** for anti-match; expose as host setting
(already is, 10–60s).

### 6b. Round count (default 3)

**Pros (more rounds):** scores stabilise, less luck; **fewer:** snappier.
**Cons:** more rounds = longer session, more chances to hit a weak target.
**Performance:** none.
**Game feel:** 3–5 is the sweet spot; tie to player count if desired.

### 6c. Phase-end precision

The loop polls a 1s ticker (`antimatch.go` Run), so a round can overrun ~1s, and
the 2s `SYNC_DELAY` adds fixed overhead. Replacing the poll with a
`time.Timer` set to exact `endTime` tightens pacing.

**Pros:** crisper transitions; less perceived lag.
**Cons:** minor refactor of the run loop.
**Performance:** strictly better (no per-second wakeups).
**Game feel:** subtle but real polish, especially on short rounds.

---

## 7. Score presentation (feel without changing math)

Even with the current formula, **presentation** changes perceived fairness:

- Show **rank/percentile** ("top 3% closest!") alongside or instead of raw
  points — leverages `SimAtRank`.
- Animate the bar filling to the score; reveal duplicates first for drama.
- Show the **best possible word** at reveal ("closest unique was X") so players
  learn and feel the target was fair.

**Pros:** cheap, pure client; turns flat numbers into feedback; teaches.
**Cons:** client work; the "best word" reveal needs a server field.
**Performance:** negligible.
**Game feel:** high ratio of feel-improvement to effort. Do alongside §1.

---

## 8. Impostor-mode notes (secondary)

- **`impostor_candidates`** (stage 9) drives the impostor's hint word.
  Tightening `IMPOSTOR_POOL_MIN_SIM` (0.35) makes the impostor's word _closer_ to
  the real one — harder to spot, more tension; loosening makes the impostor more
  obvious. A balance knob worth a playtest pass.
- Impostor inherits the same **notability** and **vocab** concerns: an unknown
  secret word ruins the round for everyone, so §4/§5 benefit both modes.

---

## Recommended sequencing

Ordered by impact ÷ effort:

1. **Rescale the score band (§1b)** + **wire `matchThreshold` as the 0-point /
   zero-beyond-cone (§2a)** — small code change, fixes "punishing/flat" directly.
2. **Apply the notability floor + Swedish pageviews (§4a)** — preprocessing edit,
   kills "who is ThyssenKrupp" at the source.
3. **Lower the vocab gate / domain expansions (§5a)** + **mine rejection logs
   (§5c)** — fixes trust-breaking rejections; the logging is already in place.
4. **Score presentation: rank + best-word reveal (§7)** — client polish that
   multiplies the §1 gains.
5. **Rank-based scoring via `SimAtRank` interpolation (§1d)** — the "fair"
   end-state once 1–4 are validated.
6. Tuning dials (§4b exponent, §6a timers, §3c duplicate softening) — live A/B
   once the structure is right.

Items 1–3 are roughly a day each and need no model retrain. Item 5 is the
larger, more principled change to do last.

## Cross-cutting performance note

The vocab is ~93k × 300 float32 (~110 MB) held in memory, L2-normalised so
cosine = dot product. Every option above is either build-time (preprocessing) or
O(1)–O(players) at runtime, **except** true per-guess full-vocab ranking (§1d
naive path), which is ~28M FLOPs/guess. At party scale (≤12 players, a handful
of rounds) even that is sub-10ms, but the `SimAtRank` interpolation avoids it
entirely. None of these tuning levers threaten server performance; the only real
cost center is preprocessing wall-time when the model or vocabulary changes.
