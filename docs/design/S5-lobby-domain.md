> **Status:** Not started · **Tracking:** milestone S5, issues [#75–#80](https://github.com/Skill-issue-coding/OrdioArena/milestone/10) · **Updated:** 2026-08-24
>
> Stage spec. Architecture rationale: [0003-rewrite-architecture.md](0003-rewrite-architecture.md) §4.

---

# S5 · Lobby domain

**Goal:** full room lifecycle, across cluster.

**Exit:** 3–12 players join and leave, host can leave without breaking room, empty lobby self-deletes.

## Roster and host

Roster derived from seats, not stored separately. One source of truth, broadcast on change, carries online/offline state so S4 grace period visible to everyone.

### Host transfer

First seat to claim it = host. Host seat **removed** → role transfers by deterministic rule: longest-seated remaining player. Every client computes same successor, no vote, no round trip.

**Host going offline does not transfer role until grace expires.** Else refresh cost you own room, exact failure this rewrite kill.

### Names

Random Swedish display name + colour assigned on join. Rename allowed in lobby, server-side validation on length and content. Names unique-ish per lobby: duplicate get suffix, not rejection. Hard error on name collision = friction, no benefit.

## Settings as a schema

Half of what make S6 mode registry pay off. Settings become data:

```go
type Field struct {
    Key     string
    Type    FieldType     // FieldInt | FieldEnum | FieldBool
    Label   string        // Swedish, shown in the UI
    Min     int           // FieldInt
    Max     int
    Default int
    Options []EnumOption  // FieldEnum
}

type SettingsSchema struct {
    Mode   ModeID
    Fields []Field
}
```

One generic apply path validates against schema. No per-mode branches:

```go
func (l *Lobby) applySetting(key string, raw json.RawMessage) error
```

Today adding mode edits `SetMode`, `ModeSettings`, `ApplySetting`, game construction, lobby settings field, four-plus switch sites, paid again per mode. Schema kill settings share of that permanently.

Schema serialisable, sent to client on join and on mode change → settings UI **generated**, not hard-coded per mode. New mode then cost zero frontend work for settings.

Rules: only host change settings, only outside running game. Out-of-range values rejected explicit with Swedish message, never silently clamped, silently changed setting = bug report nobody reproduce.

## Empty-lobby TTL

Lobbies in-memory, nothing removes abandoned one. On long-lived instance that = unbounded map.

Lobby with zero seats starts TTL. Expiry shuts down its goroutine, removes it from registry. Rejoin before expiry cancels it. Shutdown closes remaining connections with reason, stops running game cleanly.

TTL timer goes through `Clock` and lobby channel, like every other timer in system.

## Offline players in the UI

Player in grace still in room, roster must say so. Else reconnect look identical to bug from every other seat.

Offline seats dimmed with short Swedish label. Countdown appears when grace near expiry so table know whether to wait. Removal animated as **distinct** event from going offline. Same treatment in lobby and in game.

## Chat

Broadcast to lobby, attributed to sending seat. Length limit, per-seat rate limit, server-side sanitisation. Bounded recent-message buffer replayed on resync so reconnecting player not confused by empty chat.

System messages, join, leave, host transfer, Swedish, same stream.

## Decisions taken in this stage

| Decision                                   | Rationale                                            |
| ------------------------------------------ | ---------------------------------------------------- |
| Roster derived from seats                  | One source of truth; cannot drift from seat map      |
| Deterministic host successor               | Every client agrees, no vote, no round trip          |
| Offline host keeps role until grace expiry | Refresh must not cost you own room                   |
| Settings as schema data                    | Kills settings share of per-mode switch cost         |
| Settings UI generated from schema          | New mode costs zero frontend settings work           |
| Out-of-range rejected, not clamped         | Silently changed setting unreproducible              |
| Empty-lobby TTL                            | Lobby map otherwise unbounded on long-lived instance |

## Issues

| Issue                                                             | Title                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| [#75](https://github.com/Skill-issue-coding/OrdioArena/issues/75) | Roster, host role, host transfer, Swedish display names |
| [#76](https://github.com/Skill-issue-coding/OrdioArena/issues/76) | Lobby settings as a validated schema                    |
| [#77](https://github.com/Skill-issue-coding/OrdioArena/issues/77) | Settings UI generated from the schema                   |
| [#78](https://github.com/Skill-issue-coding/OrdioArena/issues/78) | Render offline players instead of removing them         |
| [#79](https://github.com/Skill-issue-coding/OrdioArena/issues/79) | Empty-lobby TTL and collection                          |
| [#80](https://github.com/Skill-issue-coding/OrdioArena/issues/80) | Lobby chat                                              |

## Open questions

- **TTL length.** Long enough that mass reload not kill room; short enough that abandoned rooms not pile up. Start proposal: five minutes.
- **Chat history size.** Enough that resync feel continuous, bounded enough not to grow. Fifty messages.
- **Can non-host start game?** Currently no. Confirm host going offline mid-lobby not block everyone until grace expires.
