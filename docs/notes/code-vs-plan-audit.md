> **Status:** Point-in-time audit · **Written:** 2026-08-20, re-verified 2026-08-20 · **Updated:** 2026-08-20
>
> A verification pass that checked the preprocessing plans against the **live code** rather than
> against each other, with file:line evidence. Kept for that evidence; its own Track A/B execution
> ordering is superseded by the issues.
>
> **Re-verification delta (2026-08-20).** Several items this audit listed as gaps have since been
> closed: `DOMAIN_VOCAB_EXPANSIONS` is now imported and injected (`stage_4.py:15-16, 153-177`), and
> the celebrity `birthDate >= 1990` filter is gone (`swedish_celebrities.sparql:16-17`). The B2
> finding stands: `swedish_companies.sparql` still runs alongside `swedish_consumer_companies` and
> `swedish_omx_companies` (`shared.py:54-58`), re-injecting B2B entities.

---

# Word-Mode Tuning, Unified Execution Plan

Synthesis of `../design/0002-word-selection.md` (§ _Word Selection Improvement Plan_) and
`../decisions/anti-match-tuning.md`, reconciled against the **actual current code** (not the
docs' assumptions). Both source docs are partially stale, large chunks already
shipped. This file is the authoritative TODO.

---

## 1. Reality check, docs vs. actual code

Verified by reading the live files. Much of `plan.md` Problem A and the
lemmatization phase is **already done**; the remaining work is narrower than the
docs imply.

| Doc claim                                                  | Actual state                                                                                                                                                                                       | Verdict               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| plan.md A‑Fix1 Swedish pageviews gate                      | **DONE**, `stage_3.py:160` fetches `sv_pageviews_monthly_avg`; `stage_7.py:168` (`MIN_SV_PAGEVIEWS=300`) gates on it                                                                               | skip                  |
| plan.md A‑Fix2 notability threshold in stage_7             | **DONE**, `stage_7.py:154` `MIN_NOTABILITY_BY_CAT`, applied `stage_7.py:286‑335`                                                                                                                   | skip                  |
| game-tuning §4a "notability_score never used, threshold=0" | **STALE**, gate is live                                                                                                                                                                            | skip                  |
| plan.md A‑Fix3 company SPARQL split (consumer vs B2B)      | **PARTIAL**, `swedish_consumer_companies.sparql` + `swedish_omx_companies.sparql` exist, but old `swedish_companies.sparql` still runs (`shared.py:57‑59` maps all three) and re-injects B2B types | cleanup → **B2**      |
| plan.md A‑Fix4 remove celeb sitelinks upper cap            | **DONE, but** `swedish_celebrities.sparql` now filters `birthDate >= 1990-01-01` → excludes Zlatan (1981), Robyn (1979)                                                                            | verify → **B3**       |
| plan.md B‑Fix1 `DOMAIN_VOCAB_EXPANSIONS`                   | **AUTHORED but DEAD**, lists in `shared.py:72`, `DOMAIN_VOCAB_KORP_MIN=50` at `shared.py:98`, but `stage_4.py:9‑15` never imports or injects them                                                  | **the real gap → B1** |
| plan.md B‑Fix4 rejected-word logging                       | **DONE**, `antimatch.go:391` logs `word rejected (not in dictionary)`                                                                                                                              | mine it → **B6**      |
| plan.md Phase 3 lemmatization (`Resolve`/`LemmaMap`)       | **DONE**, wired in `dictionary.go:24` + `antimatch.go:383`                                                                                                                                         | skip                  |
| game-tuning §1 Anti-Match scoring curve                    | **NOT done**, still linear `100-dist*100` at `antimatch.go:300`                                                                                                                                    | **A1/A3**             |
| game-tuning §2 `matchThreshold` cone                       | **DEAD CODE**, defined `antimatch.go:129`, only referenced by a TODO at `antimatch.go:252`                                                                                                         | **A1**                |
| game-tuning §1d rank data (`SimAtRank`)                    | **POPULATED**, `targets.json` enriched, loaded `types.go:25`, but unused in scoring                                                                                                                | unblocked → **A3**    |
| game-tuning §3 duplicate penalty                           | exact-string → 0 at `antimatch.go:270`                                                                                                                                                             | optional → **A4**     |
| game-tuning §6c phase-end precision                        | still 1s ticker `antimatch.go:187,201`                                                                                                                                                             | polish → **A4**       |

**Key correction on Problem B:** the stage*4 \_valid-guess* vocabulary is already
lenient, `korp_freq >= 300`, **no hard Kelly requirement** (`stage_4.py:73`,
`DEFAULT_KORP_FREQ=300`). game-tuning §5a's "`in_kelly AND korp≥1000`" actually
describes the **stage_7 target-list** filter, not the guess vocab. So Problem B
is narrower than written: only domain words _below_ 300 Korp are missing, and the
fix (inject `DOMAIN_VOCAB_EXPANSIONS` down to 50 Korp) is already authored, just
not wired into stage_4.

---

## 2. Verdicts on the open choices

| Lever               | Decision                                                                                                          | Why                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 scoring curve    | **§1b rescale first → §1d rank-interpolation as end-state. Drop standalone §1c.**                                 | 1b is the biggest feel-win per effort and data is ready; 1d is per-target fair and `SimAtRank` is already populated. Fold any non-linear generosity into 1d rather than adding a separate magic constant. |
| §2 cone enforcement | **§2a zero-beyond-threshold, paired with 1b (threshold = the 0-point). Zero-at-scoring, NOT reject-at-submit.**   | Rejection UX is already the sore point; only hard-reject `dist ≫ threshold` egregious cases.                                                                                                              |
| §3 duplicate        | **Keep 3a exact→0. Add 3c graduated (`score/n`) only if playtest shows it's too punishing. Skip 3b semantic.**    | 3b's "why did we both lose points" explain-cost is too high for default; advanced-mode only.                                                                                                              |
| §4 target selection | **§4a floor: DONE. §4b exponent + §4c category-rotation: live dials after core. §4d difficulty toggle: later.**   | Floor already removes the worst targets; the rest are tuning, not fixes. §4d needs lobby UI.                                                                                                              |
| §5 vocab            | **Wire domain inject (B1). Defer §5b did-you-mean and §5d lemma_overrides (reactive). §5c mining: ongoing (B6).** | B1 is the actual coverage fix; the rest are nice-to-have or reactive.                                                                                                                                     |
| §6 round/timers     | **§6a default 15s for Anti-Match (already host-configurable). §6c timer precision: polish.**                      | Short rounds fit the anti-hivemind mechanic (less convergence time).                                                                                                                                      |
| §7 presentation     | **Do alongside A1.** Best-word reveal needs one new server field (`ClosestUnique`).                               | Highest feel-improvement/effort ratio; multiplies the A1 gains.                                                                                                                                           |
| plan.md "skip" list | **Agree fully**, no automated multi-persona reviewers, no stability auto-stage, no preemptive TMDB.               | Noisy, expensive, non-deterministic as recurring pipeline steps.                                                                                                                                          |

---

## 3. Execution, two tracks

Two **independent** tracks. **Track A** = Go runtime/feel (no pipeline, data
already in place, fixes the "punishing/flat scores" complaint). **Track B** =
preprocessing (needs a re-run, fixes the "common word rejected" complaint).

> stage_5 reuses the existing trained w2v `.bin`, **no model retrain**. The
> stage_4→9 re-run is cheap (minutes-to-hours, not the ~1-day training).

### Phase 0, verify (<1h)

- [ ] Confirm `swedish_celebrities.sparql` `birthDate >= 1990` is intentional. If
      not, it silently excludes the Zlatan/Robyn class, likely a real bug (→ B3).
- [ ] Confirm whether `server/wordfiles/targets.json` needs regen, or the current
      enriched file is sufficient for Track A (it already has `sim_at_rank` +
      `antihive_threshold`).

### Track A, scoring & feel (START HERE)

Top complaint, cheapest, data ready. No pipeline dependency.

- [ ] **A1, §1b rescale + §2a cone** (one edit at `antimatch.go:298‑301`)
  - `norm = (matchThreshold - dist) / (matchThreshold - bestDist)`, clamp 0–100.
  - `bestDist` from the per-target `SimAtRank` rank-10 checkpoint (better than a
    global constant).
  - `dist > matchThreshold()` → score 0 (wires the dead `matchThreshold()`).
  - Keep the `math.IsNaN` guard. ~1 day.
- [ ] **A2, §7 presentation**
  - Add `ClosestUnique` (best non-duplicate word + its score) to
    `AntiMatchRoundResultPayload`.
  - Surface rank/percentile from `SimAtRank` ("top 3% closest").
  - Client: animate the score bar, reveal duplicates first, show best word at
    reveal. ~1 day.
- [ ] **A3, §1d rank-based scoring** via `SimAtRank` 5-point interpolation
  - Interpolate the word's rank from the rank-10/50/100/500/1000 checkpoints —
    O(1), no full-vocab scan.
  - Replaces A1's linear math once validated against playtest. ~1 day.
- [ ] **A4, polish / live dials**
  - §6c: replace the 1s ticker (`antimatch.go:187,201`) with a `time.Timer` to
    exact `endTime`.
  - §3c graduated duplicate (`score/n`), A/B against exact→0.
  - §4b power-law exponent + §6a 15s default exposed as tuning dials.

### Track B, preprocessing (parallel)

Fixes the rejected-word complaint. Re-run required.

- [ ] **B1, wire `DOMAIN_VOCAB_EXPANSIONS` into stage_4** _(the real Problem B fix)_
  - Import `DOMAIN_VOCAB_EXPANSIONS` + `DOMAIN_VOCAB_KORP_MIN` from `shared.py`.
  - After the main Korp/POS filter, append domain words whose `korp_freq >= 50`.
  - Words below 50 Korp have noisy vectors, skip them. ~half day.
- [ ] **B2, company query cleanup**
  - Convert old `swedish_companies.sparql` to B2B-only with a high notability
    threshold, OR drop its consumer-type overlap so it stops re-injecting B2B.
  - Update the `stage_9.py:107` reference (`swedish_companies.csv`) accordingly.
  - Low priority, the stage_7 gate already catches obscure entities.
- [ ] **B3, celeb query decision** (from Phase 0): remove/relax the
      `birthDate >= 1990` restriction if it's excluding major older celebrities;
      rely on the pageviews gate for obscurity instead.
- [ ] **B4, optional**: vocab gap report in stage_5 (warn when a domain word has
      no vector in the w2v model → flags Phase 2 supplementary-corpus needs).
- [ ] **B5, re-run** `stage_4 → 5 → 6 → 7 → 9`, redeploy `server/wordfiles/`.
      No model retrain.
- [ ] **B6, rejected-word mining loop** (ongoing, free): periodic pass over
      `game.log` rejections → add frequent legit ones to
      `DOMAIN_VOCAB_EXPANSIONS` → re-run B1/B5. The logging is already in place.

### Cross-track order

```text
A1  →  (B1 + B5 in parallel)  →  A2  →  A3 / B2 / B3  →  A4 polish
```

A1 first: it's a single self-contained edit, immediately playtestable, and hits
the #1 complaint. B1+B5 next: fixes trust-breaking rejections. A2 multiplies A1.
A3 is the principled end-state once 1–2 are validated.

---

## 4. Explicitly out of scope

From `plan.md` "What to Skip", confirmed:

- Automated multi-persona consensus reviewers (run once for calibration only).
- Stability testing as a pipeline stage (it's manual QA, not ranking).
- Preemptive TMDB integration (only if Swedish productions score too low).
- Phase 2 supplementary corpus, only if B4's gap report shows real holes.
