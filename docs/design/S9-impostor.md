> **Status:** Not started · **Tracking:** milestone S9, issues [#98–#102](https://github.com/Skill-issue-coding/OrdioArena/milestone/14) · **Updated:** 2026-08-24
>
> Stage spec. Architecture rationale: [0003-rewrite-architecture.md](0003-rewrite-architecture.md) §4.

---

# S9 · Hitta Impostern

**Goal:** second mode, ships without touching engine code. Test whether S6 registry paid for itself.

**Exit:** mode playable end to end, **no file outside own package modified**. If impossible, that is finding against S6, not excuse.

Depends on S7, not S8. Can run parallel with cutover if cutover scheduled around deploy window.

## The mode

Normal players get secret word. Impostors get semantically similar but different word, drawn from that target's `impostor_candidates`.

```text
show_word (8 s) ──▶ input (turn-based) ──▶ discussion ──▶ vote ──▶ intermediate (5 s)
                          ▲                                              │
                          └──────────────── loop ────────────────────────┘
                                                                         │
                                                                    result
```

Players vote someone out each cycle. **Impostors win when `impostors >= normals`. Normals win when all impostors gone.**

Settings: impostor count 1–4, input 10–60 s (default 30), discussion 30–150 s (default 45), vote 10–60 s (default 30).

## Roles and words

Impostor count validated against player count. Impostors never start at or above parity, game already over at deal time is not game.

Role assignment runs on game goroutine, seeded source so tests can fix it.

Impostor word drawn from target's `impostor_candidates`. Target with no candidates needs defined, tested fallback, not nil deref at worst moment.

**Role and word are private state, never enter broadcast.** Test asserts no broadcast payload contains role or private word.

## Turn-based input

Exactly one player submits at time. Current turn broadcast, with per-turn deadline.

Two things look like edge cases, are not:

- **Player who misses deadline forfeits turn**, phase does not stall. Otherwise one backgrounded mobile tab freezes game for everyone.
- **Turn order stable across rounds, unaffected by disconnects.** Reconnecting player resumes place in order. Recomputing order from currently-online players reshuffles game every time someone's train enters tunnel.

Eliminated players are spectators: see game, cannot submit or vote. Enforced server-side, not only UI.

## Voting

One vote per active player per round, changeable until deadline. Counts hidden until deadline, else last voter decides with full information.

Two rules must be written down, not emerge from implementation:

- **Ties.** Nobody eliminated, safest rule, cannot hand game to impostors on coin flip.
- **Abstention from offline player** is explicit, not silent zero, and must not stall tally waiting for someone not there.

Win conditions evaluated after each elimination, both directions. Result reveals every role and word.

## Snapshot

Hardest snapshot in game, clearest proof why `Snapshot` is mandatory not optional. **This exact case is what old codebase could not do.**

```text
public   phase, deadlines, alive/eliminated roster, whose turn it is,
         submitted words so far, vote state as far as it is public
private  your role, your word, your vote
```

Reconnecting player must not learn anything present player would not know at that moment. Stronger requirement than "restore UI", and the one worth testing hardest.

Eliminated player reconnects as spectator, into spectator view.

## Decisions taken in this stage

| Decision                                    | Rationale                                                        |
| ------------------------------------------- | ---------------------------------------------------------------- |
| Impostor count validated against parity     | Game over at deal time is not game                               |
| Turn timeout forfeits, never stalls         | One backgrounded tab must not freeze table                       |
| Turn order stable across disconnects        | Recomputing from online players reshuffles on every network blip |
| Ties eliminate nobody                       | Cannot hand game to impostors on coin flip                       |
| Spectator restrictions enforced server-side | UI-only restrictions are not restrictions                        |
| Zero engine changes                         | Registry either paid for itself or did not                       |

## Issues

| Issue                                                               | Title                                         |
| ------------------------------------------------------------------- | --------------------------------------------- |
| [#98](https://github.com/Skill-issue-coding/OrdioArena/issues/98)   | Impostor role assignment and secret word draw |
| [#99](https://github.com/Skill-issue-coding/OrdioArena/issues/99)   | Impostor phase chain and loop                 |
| [#100](https://github.com/Skill-issue-coding/OrdioArena/issues/100) | Vote tally, elimination and win conditions    |
| [#101](https://github.com/Skill-issue-coding/OrdioArena/issues/101) | Impostor resync of private role and word      |
| [#102](https://github.com/Skill-issue-coding/OrdioArena/issues/102) | Impostor client views                         |

## Open questions

- **Impostor grace expires mid-game?** Removing them changes impostor count, can end game instantly. `anti_match` can score around missing player; this mode cannot. Needs rule before implementation, not during.
- **Can eliminated players see roles?** Revealing makes spectating more fun, leaks answer if anyone in same room.
- **Discussion phase with no input.** Currently pure timer. Skip-vote would help small groups done talking.
