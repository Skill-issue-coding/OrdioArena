> **Status:** Not started · **Tracking:** milestone S10, issues [#103–#104](https://github.com/Skill-issue-coding/OrdioArena/milestone/15) · **Updated:** 2026-08-24
>
> Stage spec. Architecture rationale: [0003-rewrite-architecture.md](0003-rewrite-architecture.md) §4.

---

# S10 · Kontext Strid and Synonym Duell

**Goal:** two modes that only ever existed as settings.

**Exit:** all four modes playable. Neither mode needed engine change; if one did, recorded against S6, not quietly patched.

Both = new game logic on proven engine. By now registry, phase chain, snapshots, reconnect all exercised by two shipped modes. These two mostly mode-local work.

## Kontext Strid (`contexto_battle`)

Competitive Contexto. Players guess continuously to approach hidden target. Closest last guess when timer expires wins round.

Settings: word type (Vanliga/Kreativa), round 60–600 s, rounds 1–5.

### What is different about this mode

**Only mode with continuous input.** All else collect one submission per player per phase. Three consequences:

- **Rate limiting matters here.** Client can flood guesses. Limit per seat. Reject over-limit guesses without disconnecting player, dropped connection mid-round much worse punishment than rejected guess.
- **Feedback is rank, not raw distance.** Contexto feel come from "you are word 412", not "cosine 0.68". Needs precomputed or on-demand rank of vocabulary against target, different query than other modes need from dictionary.
- **`Phase` may need `OnTick`.** Continuous feedback during phase = open question flagged in S6. If phase chain cannot express it, that is the finding.

`Snapshot` restores own guess history + current standings. Target stays hidden until round ends, including in snapshot, reconnecting player must not learn it early.

## Synonym Duell (`synonym_duel`)

Each round everyone submits synonym for target. Submission semantically **furthest** from it eliminated. Last player standing wins.

Settings: word type (Vanliga/Kreativa), round 10–60 s, rounds 1–5.

### Rules that must be decided, not discovered

- **Ties for furthest.** Eliminate both or neither? Both shortens game unpredictably; neither can stall it.
- **Multiple non-submissions.** Non-submitting player eliminated first, but when several fail to submit, ordering between them needs rule.
- **Down to two players.** Furthest of two eliminated, other wins, final round decided by one comparison. Confirm that feels right.

Eliminated players spectate. `Snapshot` restores alive/eliminated state + own submission.

## Decisions taken in this stage

| Decision                                      | Rationale                                              |
| --------------------------------------------- | ------------------------------------------------------ |
| Rank feedback, not raw distance               | Makes Contexto feel like Contexto                      |
| Guess flooding rejected, not disconnected     | Losing connection worse punishment than rejected guess |
| Target hidden in the snapshot too             | Reconnect must not reveal answer                       |
| Elimination rules written before implementing | Ties + non-submissions = whole rule surface here       |
| Engine changes recorded against S6            | Registry value measured, not assumed                   |

## Issues

| Issue                                                               | Title                            |
| ------------------------------------------------------------------- | -------------------------------- |
| [#103](https://github.com/Skill-issue-coding/OrdioArena/issues/103) | Kontext Strid: server and client |
| [#104](https://github.com/Skill-issue-coding/OrdioArena/issues/104) | Synonym Duell: server and client |

## Open questions

- **What are "Vanliga" and "Kreativa" word types?** Both modes have setting, neither has definition. Likely `notability_score` threshold. Needs deciding before either mode can honour setting.
- **Rank computation cost.** Ranking whole vocabulary against target = O(n) scan per target. Fine once per round, wasteful per guess. Rank once at round start, cache it.
- **Does Synonym Duell need different distance measure?** "Furthest synonym" over same cosine space may not match what player intends by synonym. Playtest before tuning.
