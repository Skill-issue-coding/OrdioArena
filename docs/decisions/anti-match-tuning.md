> **Status:** Options menu, decisions pending · **Tracking:** feeds S7, [#89](https://github.com/Skill-issue-coding/OrdioArena/issues/89) · **Updated:** 2026-08-24
>
> Decision doc: each section list options + trade-offs. Most **undecided**. Pick option in tracking issue before implement, then record choice here as `**Decision:**` line under section.
>
> **Stale sections.** §4a claim notability floor never applied. §5a claim domain vocab expansions unused. Both true when written, **no longer true**, see [`../notes/code-vs-plan-audit.md`](../notes/code-vs-plan-audit.md). Scoring sections (§1, §2, §3, §7) still accurate, still open.

---

# Game Design & Scoring Tuning, Options, Trade-offs, and Effects

Scope: design/balance tuning for word modes (mainly **Anti-Match**, some Impostor notes), grounded in real Go scoring code + Wikipedia2Vec preprocessing pipeline. Per lever: **what it is**, **pros**, **cons**, **performance impact**, **game-feel impact**.

Thinking doc, not spec. Nothing implemented unless stated. Numbers = playtest starting points, not final.

---

## 0. Where the relevant knobs live today

| Concern                  | Location                                            | Current behaviour                                                  |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------------------------ |
| Anti-Match score formula | `server/game/antimatch.go` ~L255                    | `score = max(0, 100 - dist*100)`, linear in cosine distance        |
| "Too random" rejection   | `server/game/antimatch.go:252` (`matchThreshold()`) | **Defined but never called**, only dictionary existence is checked |
| Duplicate penalty        | `antimatch.go` ~L241                                | Exact string match → all duplicates get 0                          |
| Per-target threshold     | `words/types.go` `AntiHiveThreshold`                | cosine distance at rank 500, loaded, **unused in scoring**         |
| Per-target calibration   | `words/types.go` `SimAtRank`                        | rank 10/50/100/500/1000 sims, loaded, **unused**                   |
| Target selection         | `words/util.go` `WeightedPickTarget`                | `weight = (notability + 0.1)^2`, power-law                         |
| Notability gate          | preprocessing `stage_7.py`                          | score computed but **never used as a filter** (threshold = 0)      |
| Vocabulary coverage      | preprocessing `stage_4.py`                          | `in_kelly AND korp_freq ≥ 1000`                                    |
| Default timers/rounds    | `game/defaultSettings.go`                           | Anti-Match: 20s input, 3 rounds                                    |

Two highest-leverage fixes: unused `matchThreshold()` + unused notability gate. Machinery exist already, just not wired.

---

## 1. The Anti-Match scoring curve

### 1a. Current: linear `100 * (1 - distance)`

Cosine distance ∈ [0, 2]. Related words sit ~[0.3, 0.8], so scores cluster **20–70**, rarely above ~50 (observed: best word whole game = `bank`→`Citibank` = 48). Space above 50 near-unreachable, visible range squashed into lower half.

**Pros:** trivial, predictable, monotonic, zero tuning data.
**Cons:** feel punishing + flat. Players see 0/11/32/48, can't tell "good" from "lucky". Headroom 50–100 wasted.
**Performance:** one multiply, negligible.
**Game feel:** core complaint. Scores look harsh + samey.

### 1b. Rescale into the usable band (cheap win)

Map _realistic_ distance band to full 0–100 instead of theoretical. E.g. `dist = 0.30` → ~100, `dist = matchThreshold` → ~0, linear between:

```go
norm = (threshold - dist) / (threshold - bestDist)   // bestDist ≈ 0.30
score = clamp(0, 100, round(norm * 100))
```

**Pros:** use whole bar. Good answers feel good. No new data, `AntiHiveThreshold` exist per target.
**Cons:** need sane `bestDist` floor (per-target via `SimAtRank` beat global constant). Less "honest" about raw similarity.
**Performance:** still O(1).
**Game feel:** big positive. Alone likely fix "scores feel punishing" with no other change.

### 1c. Non-linear curve (reward the top end)

Curve so gap between "great" and "good" widen:

- **Exponential / power:** `score = 100 * norm^0.6` (lift mid), or `^1.5` (punish all but best). Pick by wanted generosity.
- **Sigmoid around threshold:** flat-bad below, flat-great above, steep in contested middle. Make "did my word make cone?" moment dramatic.

**Pros:** tunable drama. Near-miss feel close, win feel earned.
**Cons:** one more magic constant. Easy to over-tune into "everyone gets 90" or "everyone gets 10". Need playtest with real players.
**Performance:** one `pow`/`exp` per submission per round. Trivial at party scale (≤12 players).
**Game feel:** high ceiling, high risk. Do **after** 1b, not instead.

### 1d. Rank-based scoring instead of distance-based

Score by word **rank** in target neighbour list (which `SimAtRank` already characterise), not raw cosine. "Top-50 neighbour = 100, rank 500 = 0."

**Pros:** auto-calibrated per target. Dense neighbourhoods (Fotboll) + sparse (Avicii) feel consistent, exactly why `SimAtRank` exist. Kill "some targets just score low" unfairness.
**Cons:** need full ranking at runtime, or precomputed interpolation from `SimAtRank`. True rank per guess = one dot product against whole vocab (~93k × 300) **per submission**, heavier (see Performance).
**Performance:** full-vocab rank ~28M multiply-adds per guess. At ≤12 players/round fine (<10 ms), but 1000× current cost. Cheaper path: interpolate rank from 5 `SimAtRank` checkpoints already loaded, O(1).
**Game feel:** most "fair" option. Per-target consistency = whole point of stage 9. Recommended target state, via interpolation shortcut.

---

## 2. Enforce the "anti-hive" cone (`matchThreshold` is dead code)

Now any dictionary word score. `matchThreshold()` never called. Intended mechanic, "words too far from target rejected/zeroed as too random", not exist.

### 2a. Zero-score beyond threshold

If `dist > AntiHiveThreshold`, award 0 (still record word).

**Pros:** restore designed mechanic. Stop "spam any valid word, get points". Pair naturally with 1b rescale (threshold = 0 point).
**Cons:** harsher, near-miss get nothing. Per-target threshold quality depend on stage 9 enrichment present (fallback 0.5 crude).
**Performance:** one comparison, free.
**Game feel:** add stakes ("stay in cone"), but frustrate if threshold too tight. Tune rank-500 cutoff per playtest.

### 2b. Reject at submit time vs. zero at scoring time

- **Reject at submit** (like dictionary check): instant "too unrelated" toast, player retry. Tighter feedback loop.
- **Zero at scoring:** player commit, learn at reveal.

**Pros (reject):** teach cone fast, fewer wasted rounds.
**Cons (reject):** game feel like it "argues" with you (see dictionary rejection UX problem in §5). Risk reject reasonable words if threshold mis-tuned. **Cons (zero):** silent failure until reveal.
**Performance:** identical, O(1).
**Game feel:** reject = strict/instructive, zero = forgiving/suspenseful. Given existing frustration with dictionary rejections, **zero-at-scoring safer default**. Reject at submit only for _egregiously_ far words (dist ≫ threshold).

---

## 3. Duplicate / collision penalty

### 3a. Current: exact-string duplicates → 0

Two players type identical lemma → both get 0.

**Pros:** simple, match "be unique" pitch, easy to explain.
**Cons:** purely lexical. `bil` vs `bilen` → same lemma (good), but `fotboll` vs `boll`, clearly related, treated fully distinct, both score. Penalty all-or-nothing, ignore semantics.
**Performance:** frequency map, O(players).
**Game feel:** "jinx" moment fun, but near-synonyms slipping through undercut anti-hivemind fantasy.

### 3b. Semantic-cluster penalty

Penalise words _too close to each other_, not just identical: if two submissions within ε cosine, split or cut their points.

**Pros:** reward original thinking, deepen core mechanic.
**Cons:** O(players²) distance checks (trivial at ≤12), but mainly **harder to explain**, can feel arbitrary ("why did we both lose points, those aren't the same word?"). Need visible explanation in result UI.
**Performance:** ≤12² = 144 dot products/round, nothing.
**Game feel:** higher skill ceiling, but raise "game is judging me" risk. Optional/advanced-mode candidate, not default.

### 3c. Graduated duplicate penalty

Instead of 0, split points among duplicators (e.g. each get `score / n`).

**Pros:** softer. Collisions sting but don't waste whole round. Still push uniqueness.
**Cons:** weaken clean "duplicates = 0" rule players learn fast.
**Performance:** free.
**Game feel:** friendlier for casual groups, less punchy. A/B against 3a.

---

## 4. Target selection & notability (the "obscure target" complaint)

Observed bad targets: `Citibank`, `Glenn Ljungström`, `ThyssenKrupp`. Machinery to prevent exist but half-used.

### 4a. Actually apply a notability floor (preprocessing `stage_7`)

`notability_score` computed + stored but never gate inclusion (threshold = 0). Add per-category minimum (plan suggest 0.05–0.10).

**Pros:** kill ThyssenKrupp-class targets _at source_. One-line filter. No model retrain.
**Cons:** shrink target pool, floor too high = repetitive targets. Sitelinks are poor proxy for _Swedish_ recognisability (BlackRock: many sitelinks, near-zero Swedish awareness). Best paired with Swedish pageviews signal from `../design/0002-word-selection.md` Problem A Fix 1.
**Performance:** build-time only. Runtime unaffected (smaller `targets.json`).
**Game feel:** big win, fewer "who?" moments. Single highest-impact design change, and it's preprocessing edit not code change.

### 4b. Tune the runtime power-law weighting

`weight = (notability + 0.1)^2`. `^2` make 1.0 entity ~75× likelier than 0.0 word. `+0.1` floor keep obscure ones in play.

- **Raise exponent (→3):** concentrate harder on famous targets.
- **Lower epsilon (→0.03):** make obscure targets much rarer without excluding.

**Pros:** instant difficulty knob. No pipeline rerun (constants in `words/util.go`). Reversible.
**Cons:** don't _remove_ bad targets, only down-weight. 0.0 entity can still surface. Interact with 4a (do floor first).
**Performance:** none.
**Game feel:** smooth difficulty dial, cheap to test live.

### 4c. Category-aware selection

Weight or rotate by category (companies, celebrities, food, geography…) so session don't serve three obscure companies in row.

**Pros:** variety. Avoid clustering on weak category. Let you weight crowd-pleasers (food, geography) over B2B firms.
**Cons:** more selection state. Need category labels surfaced to picker (exist in `sources.json`). Risk feel "on rails".
**Performance:** negligible.
**Game feel:** better pacing + variety across multi-round game.

### 4d. Difficulty setting (host-controlled)

Expose easy/normal/hard toggle mapping to notability floor + exponent.

**Pros:** groups self-select. "Hard" keep obscure targets some players enjoy. Future-proof tuning.
**Cons:** new setting in lobby UI + plumb through `AntiMatchSettings`. More QA surface.
**Performance:** none.
**Game feel:** strong for replayability + group fit. Medium build cost.

---

## 5. Vocabulary coverage (the "common word rejected" complaint)

Observed rejections of ordinary Swedish: `skådespelare`, `atlet`, `man`. This is `../design/0002-word-selection.md` Problem B, and _worse_ than obscure targets, rejected correct guess read as bug, break trust.

### 5a. Lower the Korp/Kelly gate (preprocessing `stage_4`)

Current: `in_kelly AND korp_freq ≥ 1000`. Kelly = ~8k pedagogical core, omit common domain words.

- Drop hard Kelly requirement, or
- Lower Korp threshold (1000 → 300/500) for non-Kelly words, or
- Add curated `DOMAIN_VOCAB_EXPANSIONS` (already drafted in `../design/0002-word-selection.md`).

**Pros:** direct fix for rejections of words every adult Swede know. Expand valid guesses. Cheap (build-time list edit).
**Cons:** lower thresholds admit rarer words with **noisier vectors**, bad vector = semi-random score, own feel problem. Bigger vocab = slightly larger `vocab.bin` + load.
**Performance:** build-time. Runtime memory grow ~linear with vocab (now ~93k × 300 × 4B ≈ 110 MB; +10k words ≈ +12 MB). Lookups stay O(1).
**Game feel:** remove trust-breaking rejections. High priority, low risk if keep Korp floor (≥50) so only attested words enter.

### 5b. "Did you mean / close match" on rejection

On rejection, suggest nearest in-vocab lemma (edit-distance or `LemmaMap`).

**Pros:** turn dead-end into recovery. Soften strictness.
**Cons:** edit-distance over 93k keys per rejection need care (prefix index or bounded Levenshtein). Risk weird suggestions.
**Performance:** naive scan = 93k string ops per rejection, acceptable but worth trie/prefix bucket if hot.
**Game feel:** much friendlier failure mode. Pair well with 5a.

### 5c. Rejected-word telemetry → vocabulary loop

We **now log every rejection** (`game.log`: `word rejected (not in dictionary)`). Mine it: frequent legit rejectees → add to domain expansions. Exactly `../design/0002-word-selection.md` Problem B Fix 4, and logging you just built = data source.

**Pros:** player-driven, free, self-correcting. No guessing which words to add.
**Cons:** need periodic manual pass over logs. Only as good as playtest volume.
**Performance:** offline analysis, zero runtime cost.
**Game feel:** compounding improvement over time. Low effort, do it.

### 5d. Lemmatisation correctness

`man` rejected → lemma/inflection gap. `../notes/preprocessing-w2v-migration.md` Phase 3 mention `lemma_overrides.json` for spaCy mistakes.

**Pros:** fix systematic wrong-lemma rejections. Small override file.
**Cons:** manual curation. spaCy Swedish rule-based, sometimes wrong on uncommon forms.
**Performance:** build-time, none at runtime.
**Game feel:** remove class of baffling rejections.

---

## 6. Round structure & timers

### 6a. Input duration (default 20s)

**Shorter (10–15s):** urgency, faster games, more gut-instinct answers (which _help_ anti-match, less time to converge on obvious word).
**Longer (30–45s):** thoughtful, but more hivemind convergence + dead air.

**Pros (short):** pace, energy, better mechanic fit.
**Cons (short):** slow typers/non-natives disadvantaged, more empty submissions. **Cons (long):** drag, especially with `SYNC_DELAY` overhead.
**Performance:** none.
**Game feel:** large. Lean **short** for anti-match. Expose as host setting (already is, 10–60s).

### 6b. Round count (default 3)

**Pros (more rounds):** scores stabilise, less luck. **Fewer:** snappier.
**Cons:** more rounds = longer session, more chances to hit weak target.
**Performance:** none.
**Game feel:** 3–5 = sweet spot. Tie to player count if wanted.

### 6c. Phase-end precision

Loop poll 1s ticker (`antimatch.go` Run), so round can overrun ~1s. 2s `SYNC_DELAY` add fixed overhead. Replace poll with `time.Timer` set to exact `endTime` → tighter pacing.

**Pros:** crisper transitions, less perceived lag.
**Cons:** minor refactor of run loop.
**Performance:** strictly better (no per-second wakeups).
**Game feel:** subtle but real polish, especially on short rounds.

---

## 7. Score presentation (feel without changing math)

Even with current formula, **presentation** change perceived fairness:

- Show **rank/percentile** ("top 3% closest!") alongside or instead of raw points, leverage `SimAtRank`.
- Animate bar filling to score. Reveal duplicates first for drama.
- Show **best possible word** at reveal ("closest unique was X") so players learn + feel target was fair.

**Pros:** cheap, pure client. Turn flat numbers into feedback. Teaches.
**Cons:** client work. "Best word" reveal need server field.
**Performance:** negligible.
**Game feel:** high feel-per-effort ratio. Do alongside §1.

---

## 8. Impostor-mode notes (secondary)

- **`impostor_candidates`** (stage 9) drive impostor hint word. Tighten `IMPOSTOR_POOL_MIN_SIM` (0.35) → impostor word _closer_ to real one, harder to spot, more tension. Loosen → impostor more obvious. Balance knob worth playtest pass.
- Impostor inherit same **notability** + **vocab** concerns: unknown secret word ruin round for everyone, so §4/§5 help both modes.

---

## Recommended sequencing

By impact ÷ effort:

1. **Rescale score band (§1b)** + **wire `matchThreshold` as 0-point / zero-beyond-cone (§2a)**, small code change, fix "punishing/flat" directly.
2. **Apply notability floor + Swedish pageviews (§4a)**, preprocessing edit, kill "who is ThyssenKrupp" at source.
3. **Lower vocab gate / domain expansions (§5a)** + **mine rejection logs (§5c)**, fix trust-breaking rejections. Logging already in place.
4. **Score presentation: rank + best-word reveal (§7)**, client polish, multiply §1 gains.
5. **Rank-based scoring via `SimAtRank` interpolation (§1d)**, "fair" end-state once 1–4 validated.
6. Tuning dials (§4b exponent, §6a timers, §3c duplicate softening), live A/B once structure right.

Items 1–3 ≈ one day each, no model retrain. Item 5 = larger, more principled change, do last.

## Cross-cutting performance note

Vocab = ~93k × 300 float32 (~110 MB) in memory, L2-normalised so cosine = dot product. Every option above is build-time (preprocessing) or O(1)–O(players) at runtime, **except** true per-guess full-vocab ranking (§1d naive path) at ~28M FLOPs/guess. At party scale (≤12 players, few rounds) even that sub-10ms, but `SimAtRank` interpolation avoid it entirely. No tuning lever here threaten server performance. Only real cost center: preprocessing wall-time when model or vocabulary change.
