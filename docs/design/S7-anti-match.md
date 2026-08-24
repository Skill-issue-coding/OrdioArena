> **Status:** Not started · **Tracking:** milestone S7, issues [#87–#93](https://github.com/Skill-issue-coding/OrdioArena/milestone/12) · **Updated:** 2026-08-24
>
> Stage spec. Scoring trade-offs in [../decisions/anti-match-tuning.md](../decisions/anti-match-tuning.md).

---

# S7 · Anti-matchning, end to end

**Goal:** one mode, fully playable, reconnect-safe. Vertical slice proving S0–S6.

**Exit:** three players finish full game. One refreshes mid-round, resumes same round. One drops past grace, round still resolves. Scores correct both cases. Scenarios covered by tests.

## The mode

Every player submits word related to target. Say related thing **nobody else says**. New target each round.

```text
show target ──▶ input ──▶ reveal + score ──▶ next round │ result
                  ▲                              │
                  └──────────────────────────────┘
```

Settings: rounds 1–5 (default 3), input 10–60 s (default 20).

## Round loop

Round ends early once every **active** seat submitted.

"Active" = online **or within grace**. Current impl gets this wrong: `playerLeft` channel case commented out, so mid-game disconnect leaves slot blocking early-advance check. Round runs full timer for nothing.

With seats + grace timers, real decision instead of oversight:

- Seat going offline stays active while in grace. Round waits for it, reconnect inside ten seconds must not be skipped.
- Grace expiry removes it from active set, **immediately re-evaluates** early advance. If everyone else submitted, round ends then, not at deadline.
- Player who leaves keeps accumulated score in results. They played those rounds.
- Below minimum player count ends game with result, no hang.

One submission per player per round. Last write wins before deadline.

## Validation and scoring

Submissions resolve through lemma map before lookup: "bilar" and "bil" same word. Word must exist in dictionary, must not be target itself.

```text
duplicate (after lemma resolution)  →  0 for everyone involved
unique                              →  max(0, 100 - cosine_distance * 100)
no submission                       →  0, and blocks nobody
```

Scoring once per round, on game goroutine, from submissions map. Round scores and running totals both broadcast.

## The AntiHive threshold

`antihive_threshold` loaded from `targets.json`, then **never used**. Per-target "too random" cutoff does nothing: word with no relation to target scores same as thoughtful distant one. Whole stage-9 enrichment that produced thresholds wasted.

Fix belongs to vertical slice, not later polish. Fallback `0.5` for never-enriched target.

### Where to apply it, decision needed

|                                      | Reject at submission         | Accept and score 0                 |
| ------------------------------------ | ---------------------------- | ---------------------------------- |
| Player learns why                    | Yes, immediately             | No, looks identical to a duplicate |
| Retry possible                       | Yes, within the round        | No                                 |
| Reveals information about the target | Slightly, "that was too far" | None                               |
| Implementation                       | Validation path              | Scoring path                       |

**Recommendation: reject at submission.** Teaches player. Cannot be confused with duplicate collision. Silent zero reads as bug. Info leak negligible, player already sees target.

Either way, rejected words logged with target and distance. That log = raw material for finding vocabulary gaps later.

## Snapshot

Reconnect payoff, in the one mode that must prove it.

```text
public   round number, target, phase, deadlines, roster with running totals,
         previous rounds' results
private  whether you have submitted this round, and what you submitted
```

**Never leak another player's pending submission, that is whole game.** Public and private in separate fields, so broadcast cannot carry private half. After round scored, submissions become public and move fields.

## Client

Target display, submission input with validation feedback, countdown rendered from server timestamps plus estimated clock offset.

Submitted state driven by resync payload, not local component state. That is what makes refresh restore your own word, not empty box.

Reveal shows everyone's word, who collided, per-round scores. Results show final standings with rank and round's best word. Offline players stay visible throughout. All strings in Swedish.

## Scenario tests

Stage exit criteria as tests. Current codebase cannot survive these:

- Three players, full game, deterministic fixtures and fake clock
- Player refreshes mid-round → resumes into same round, submission intact
- Player drops past grace → round resolves, earlier scores survive
- Everyone submits → early advance fires
- Nobody submits → deadline resolves round with zeros
- Two players submit lemma-equal words → both score 0
- Host leaves mid-game → role transfers, game continues

Final scores asserted exactly, not "non-zero". No sleeps in suite.

## Decisions taken in this stage

| Decision                                | Rationale                                           |
| --------------------------------------- | --------------------------------------------------- |
| Offline-but-in-grace counts as active   | Ten-second reconnect must not skip your turn        |
| Grace expiry re-evaluates early advance | Else departure stalls round to deadline             |
| Departed players keep earlier scores    | They played those rounds                            |
| Threshold rejected at submission time   | Teachable, retryable, not confusable with duplicate |
| Rejected words logged with distance     | Raw material for vocabulary-gap analysis            |
| Submitted state driven by resync        | Local state cannot survive refresh                  |

## Issues

| Issue                                                             | Title                                             |
| ----------------------------------------------------------------- | ------------------------------------------------- |
| [#87](https://github.com/Skill-issue-coding/OrdioArena/issues/87) | Anti-Match round loop, submissions, early advance |
| [#88](https://github.com/Skill-issue-coding/OrdioArena/issues/88) | Duplicate detection and cosine scoring            |
| [#89](https://github.com/Skill-issue-coding/OrdioArena/issues/89) | Apply the per-target AntiHiveThreshold            |
| [#90](https://github.com/Skill-issue-coding/OrdioArena/issues/90) | Player leave handling and early-advance unblock   |
| [#91](https://github.com/Skill-issue-coding/OrdioArena/issues/91) | Mid-round resync with private submissions         |
| [#92](https://github.com/Skill-issue-coding/OrdioArena/issues/92) | Anti-Match game and results views                 |
| [#93](https://github.com/Skill-issue-coding/OrdioArena/issues/93) | Three-player scenario tests including reconnect   |

## Open questions

- **Score band.** `100 - distance*100` compresses most real answers into narrow range, cosine distance between two related Swedish words rarely spans full `[0, 2]`. Rescaling discussed in [anti-match-tuning.md](../decisions/anti-match-tuning.md). Feel question, needs playtesting, not analysis.
- **Hard reject or soft warning?** Warning that still allows submission = third option, probably friendliest.
- **Target repetition.** Nothing prevents same target twice in one game.
