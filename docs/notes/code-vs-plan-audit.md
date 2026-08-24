> **Status:** Point-in-time audit · **Written:** 2026-08-20, re-verified 2026-08-20 · **Updated:** 2026-08-20
>
> Verification pass. Checked preprocessing plans against **live code**, not each other. file:line evidence.
> Kept for evidence. Own Track A/B ordering superseded by issues.
>
> **Re-verification delta (2026-08-20).** Several gaps now closed: `DOMAIN_VOCAB_EXPANSIONS` imported +
> injected (`stage_4.py:15-16, 153-177`); celebrity `birthDate >= 1990` filter gone
> (`swedish_celebrities.sparql:16-17`). B2 finding stands: `swedish_companies.sparql` still runs
> alongside `swedish_consumer_companies` + `swedish_omx_companies` (`shared.py:54-58`), re-injects
> B2B entities.

---

# Word-Mode Tuning, Unified Execution Plan

Synthesis of `../design/0002-word-selection.md` (§ _Word Selection Improvement Plan_) +
`../decisions/anti-match-tuning.md`, reconciled against **actual current code** (not docs'
assumptions). Both source docs partly stale, big chunks shipped. This file = authoritative TODO.

---

## 1. Reality check, docs vs. actual code

Verified by reading live files. Much of `plan.md` Problem A + lemmatization phase **already done**.
Remaining work narrower than docs imply.

| Doc claim                                                  | Actual state                                                                                                                                                                                       | Verdict               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| plan.md A‑Fix1 Swedish pageviews gate                      | **DONE**, `stage_3.py:160` fetches `sv_pageviews_monthly_avg`; `stage_7.py:168` (`MIN_SV_PAGEVIEWS=300`) gates on it                                                                               | skip                  |
| plan.md A‑Fix2 notability threshold in stage_7             | **DONE**, `stage_7.py:154` `MIN_NOTABILITY_BY_CAT`, applied `stage_7.py:286‑335`                                                                                                                   | skip                  |
| game-tuning §4a "notability_score never used, threshold=0" | **STALE**, gate live                                                                                                                                                                               | skip                  |
| plan.md A‑Fix3 company SPARQL split (consumer vs B2B)      | **PARTIAL**, `swedish_consumer_companies.sparql` + `swedish_omx_companies.sparql` exist, but old `swedish_companies.sparql` still runs (`shared.py:57‑59` maps all three) and re-injects B2B types | cleanup → **B2**      |
| plan.md A‑Fix4 remove celeb sitelinks upper cap            | **DONE, but** `swedish_celebrities.sparql` now filters `birthDate >= 1990-01-01` → excludes Zlatan (1981), Robyn (1979)                                                                            | verify → **B3**       |
| plan.md B‑Fix1 `DOMAIN_VOCAB_EXPANSIONS`                   | **AUTHORED but DEAD**, lists in `shared.py:72`, `DOMAIN_VOCAB_KORP_MIN=50` at `shared.py:98`, but `stage_4.py:9‑15` never imports or injects them                                                  | **the real gap → B1** |
| plan.md B‑Fix4 rejected-word logging                       | **DONE**, `antimatch.go:391` logs `word rejected (not in dictionary)`                                                                                                                              | mine it → **B6**      |
| plan.md Phase 3 lemmatization (`Resolve`/`LemmaMap`)       | **DONE**, wired in `dictionary.go:24` + `antimatch.go:383`                                                                                                                                         | skip                  |
| game-tuning §1 Anti-Match scoring curve                    | **NOT done**, still linear `100-dist*100` at `antimatch.go:300`                                                                                                                                    | **A1/A3**             |
| game-tuning §2 `matchThreshold` cone                       | **DEAD CODE**, defined `antimatch.go:129`, only referenced by TODO at `antimatch.go:252`                                                                                                           | **A1**                |
| game-tuning §1d rank data (`SimAtRank`)                    | **POPULATED**, `targets.json` enriched, loaded `types.go:25`, but unused in scoring                                                                                                                | unblocked → **A3**    |
| game-tuning §3 duplicate penalty                           | exact-string → 0 at `antimatch.go:270`                                                                                                                                                             | optional → **A4**     |
| game-tuning §6c phase-end precision                        | still 1s ticker `antimatch.go:187,201`                                                                                                                                                             | polish → **A4**       |

**Key correction on Problem B:** stage*4 \_valid-guess* vocab already lenient, `korp_freq >= 300`,
**no hard Kelly requirement** (`stage_4.py:73`, `DEFAULT_KORP_FREQ=300`). game-tuning §5a's
"`in_kelly AND korp≥1000`" describes **stage_7 target-list** filter, not guess vocab. So Problem B
narrower than written: only domain words _below_ 300 Korp missing, and fix (inject
`DOMAIN_VOCAB_EXPANSIONS` down to 50 Korp) already authored, not wired into stage_4.

---

## 2. Verdicts on the open choices

| Lever               | Decision                                                                                                          | Why                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §1 scoring curve    | **§1b rescale first → §1d rank-interpolation as end-state. Drop standalone §1c.**                                 | 1b = biggest feel-win per effort, data ready; 1d per-target fair and `SimAtRank` populated. Fold non-linear generosity into 1d, not separate magic constant. |
| §2 cone enforcement | **§2a zero-beyond-threshold, paired with 1b (threshold = the 0-point). Zero-at-scoring, NOT reject-at-submit.**   | Rejection UX already sore point. Hard-reject only `dist ≫ threshold` egregious cases.                                                                        |
| §3 duplicate        | **Keep 3a exact→0. Add 3c graduated (`score/n`) only if playtest shows it's too punishing. Skip 3b semantic.**    | 3b's "why did we both lose points" explain-cost too high for default. Advanced-mode only.                                                                    |
| §4 target selection | **§4a floor: DONE. §4b exponent + §4c category-rotation: live dials after core. §4d difficulty toggle: later.**   | Floor already removes worst targets. Rest = tuning, not fixes. §4d needs lobby UI.                                                                           |
| §5 vocab            | **Wire domain inject (B1). Defer §5b did-you-mean and §5d lemma_overrides (reactive). §5c mining: ongoing (B6).** | B1 = actual coverage fix. Rest nice-to-have or reactive.                                                                                                     |
| §6 round/timers     | **§6a default 15s for Anti-Match (already host-configurable). §6c timer precision: polish.**                      | Short rounds fit anti-hivemind mechanic (less convergence time).                                                                                             |
| §7 presentation     | **Do alongside A1.** Best-word reveal needs one new server field (`ClosestUnique`).                               | Highest feel-improvement/effort ratio. Multiplies A1 gains.                                                                                                  |
| plan.md "skip" list | **Agree fully**, no automated multi-persona reviewers, no stability auto-stage, no preemptive TMDB.               | Noisy, expensive, non-deterministic as recurring pipeline steps.                                                                                             |

---

## 3. Execution, two tracks

Two **independent** tracks. **Track A** = Go runtime/feel (no pipeline, data in place, fixes
"punishing/flat scores" complaint). **Track B** = preprocessing (needs re-run, fixes "common word
rejected" complaint).

> stage_5 reuses existing trained w2v `.bin`, **no model retrain**. stage_4→9 re-run cheap
> (minutes-to-hours, not ~1-day training).

### Phase 0, verify (<1h)

- [ ] Confirm `swedish_celebrities.sparql` `birthDate >= 1990` intentional. If not, silently
      excludes Zlatan/Robyn class, likely real bug (→ B3).
- [ ] Confirm whether `server/wordfiles/targets.json` needs regen, or current enriched file
      sufficient for Track A (already has `sim_at_rank` + `antihive_threshold`).

### Track A, scoring & feel (START HERE)

Top complaint, cheapest, data ready. No pipeline dependency.

- [ ] **A1, §1b rescale + §2a cone** (one edit at `antimatch.go:298‑301`)
  - `norm = (matchThreshold - dist) / (matchThreshold - bestDist)`, clamp 0–100.
  - `bestDist` from per-target `SimAtRank` rank-10 checkpoint (better than global constant).
  - `dist > matchThreshold()` → score 0 (wires dead `matchThreshold()`).
  - Keep `math.IsNaN` guard. ~1 day.
- [ ] **A2, §7 presentation**
  - Add `ClosestUnique` (best non-duplicate word + its score) to `AntiMatchRoundResultPayload`.
  - Surface rank/percentile from `SimAtRank` ("top 3% closest").
  - Client: animate score bar, reveal duplicates first, show best word at reveal. ~1 day.
- [ ] **A3, §1d rank-based scoring** via `SimAtRank` 5-point interpolation
  - Interpolate word's rank from rank-10/50/100/500/1000 checkpoints, O(1), no full-vocab scan.
  - Replaces A1's linear math once validated against playtest. ~1 day.
- [ ] **A4, polish / live dials**
  - §6c: replace 1s ticker (`antimatch.go:187,201`) with `time.Timer` to exact `endTime`.
  - §3c graduated duplicate (`score/n`), A/B against exact→0.
  - §4b power-law exponent + §6a 15s default exposed as tuning dials.

### Track B, preprocessing (parallel)

Fixes rejected-word complaint. Re-run required.

- [ ] **B1, wire `DOMAIN_VOCAB_EXPANSIONS` into stage_4** _(real Problem B fix)_
  - Import `DOMAIN_VOCAB_EXPANSIONS` + `DOMAIN_VOCAB_KORP_MIN` from `shared.py`.
  - After main Korp/POS filter, append domain words whose `korp_freq >= 50`.
  - Words below 50 Korp have noisy vectors, skip them. ~half day.
- [ ] **B2, company query cleanup**
  - Convert old `swedish_companies.sparql` to B2B-only with high notability threshold, OR drop its
    consumer-type overlap so it stops re-injecting B2B.
  - Update `stage_9.py:107` reference (`swedish_companies.csv`) accordingly.
  - Low priority, stage_7 gate already catches obscure entities.
- [ ] **B3, celeb query decision** (from Phase 0): remove/relax `birthDate >= 1990` restriction if
      excluding major older celebrities. Rely on pageviews gate for obscurity instead.
- [ ] **B4, optional**: vocab gap report in stage_5 (warn when domain word has no vector in w2v
      model → flags Phase 2 supplementary-corpus needs).
- [ ] **B5, re-run** `stage_4 → 5 → 6 → 7 → 9`, redeploy `server/wordfiles/`. No model retrain.
- [ ] **B6, rejected-word mining loop** (ongoing, free): periodic pass over `game.log` rejections →
      add frequent legit ones to `DOMAIN_VOCAB_EXPANSIONS` → re-run B1/B5. Logging already in place.

### Cross-track order

```text
A1  →  (B1 + B5 in parallel)  →  A2  →  A3 / B2 / B3  →  A4 polish
```

A1 first: single self-contained edit, immediately playtestable, hits #1 complaint. B1+B5 next: fixes
trust-breaking rejections. A2 multiplies A1. A3 = principled end-state once 1–2 validated.

---

## 4. Explicitly out of scope

From `plan.md` "What to Skip", confirmed:

- Automated multi-persona consensus reviewers (run once for calibration only).
- Stability testing as pipeline stage (manual QA, not ranking).
- Preemptive TMDB integration (only if Swedish productions score too low).
- Phase 2 supplementary corpus, only if B4's gap report shows real holes.
