> **Status:** Not started · **Tracking:** milestone S4, issues [#67–#74](https://github.com/Skill-issue-coding/OrdioArena/milestone/9) · **Updated:** 2026-08-24
>
> Stage spec. Architecture rationale: [0003-rewrite-architecture.md](0003-rewrite-architecture.md) §2.

---

# S4 · WebSocket transport, seats, reconnect

**Goal:** identity survive refresh and network drop. Whole rewrite exist for this stage.

**Exit:** refresh mid-lobby, keep same seat, name, colour. Kill network 30 s, resume. Second tab open, first cleanly fenced. `go test -race` green.

## Goroutine topology

```text
readPump ─┐                                            ┌─▶ Game.Run
          ├─▶ Conn ──▶ Hub.Run ──▶ Lobby.Run ──────────┤   (owns all game state)
writePump ┘            (owns      (owns ALL lobby state)
                        conns)
```

Each layer own state in exactly one goroutine, reached only via channels. `Lobby.Run` = only writer of lobby state. Never mutate lobby state from timer callback, HTTP handler, or spawned helper, send on channel, handle inside owning `select`.

One permitted mutex guards lobby registry map: HTTP upgrade handlers touch it from outside hub goroutine. Exception documented at declaration so it not propagate by example.

**Every cross-goroutine send is non-blocking:**

```go
select {
case ch <- msg:
default:
    dropped.Add(1)     // one slow client must never stall a lobby
}
```

Silent drops invisible → count and expose them. Climbing drop counter = first symptom of client stopped reading.

## Seats, not connections

Lobby own seats. Seat outlive its connection, that whole mechanism behind reconnect.

```go
type Seat struct {
    PlayerID uuid.UUID
    Profile  Profile      // name, colour
    State    SeatState    // online | offline
    Epoch    uint64       // bumped on every new connection for this seat
    conn     *Conn        // nil while offline
}
```

### Epoch fencing

Every new connection for seat increment `Epoch`. Every inbound event carry epoch it sent under. Lobby drop any event with stale epoch.

```go
if ev.Epoch != seat.Epoch {
    dropped.Add(1)
    return          // a fenced connection cannot mutate anything
}
```

Second tab → first tab fenced out, not racing. Loser closed with distinct close code so client explain what happened instead of looking broken.

Also remove current data races on `client.Lobby` and `client.Profile` by construction, not by mutexes. Connection type stop owning shared state, carry id plus two channels.

## Grace timers

Disconnect flip seat to `offline`, start grace timer. Does **not** remove player.

**Grace timer never touch lobby state.** It fire, send on lobby channel. Lobby goroutine handle inside own `select`, same as any event:

```go
case <-graceTimer.C():
    lobby.msgs <- graceExpired{PlayerID: id, Epoch: epoch}   // never mutate here
```

Epoch travel with message: player who reconnected while message in flight must not be evicted by superseded timer.

Expiry behaviour per-phase, not global. In lobby: expiry remove seat. Mid-game: mode decide, `anti_match` score round without them, `impostor` must not silently change impostor count. Message carry enough context for game to choose.

## Handshake

Identity established over socket, not in URL.

```text
client → server   hello    { token?, lobbyCode }
server → client   identity { token, playerId, profile }
server → client   resync   { lobby, game?, private? }
```

- **No token:** assign identity, mint token, reply `identity`. Zero-friction path, stay first-class.
- **With token:** verify, check match this lobby, attach to existing seat, bump epoch, reply `identity` then `resync`.
- **Token for another lobby:** treat as no token.
- Connection that never send `hello` closed on handshake timeout.

## Resync

`resync` carry everything client need to render from scratch: lobby state, current game phase with deadlines, player own private state.

Public and private state live in **separate fields** → broadcast can never carry private half by accident. Test assert private state reach exactly one player.

Client apply `resync` as **full state replacement**, never merge. Merging = where stale-state bugs live.

## Transport details

`coder/websocket` over gorilla: context-aware reads and writes, so connection die with its context, no manual deadline bookkeeping.

- Read pump: decode envelope, enforce message size limit, rate limit inbound events.
- Write pump: single writer per connection, periodic ping, pong deadline.
- Both pumps share per-connection context, cancelled when either fail → one dying pump always take other with it.
- Close codes carry app reason: misdirected, room gone, fenced by newer connection.

### Origin allowlist

`CheckOrigin` restricted to exact-match allowlist from config. Current server accept every origin, any page on internet can open socket against backend. Standing hole carried forward, not new requirement.

Development default permit localhost only. Production refuse to boot with empty allowlist.

## Client behaviour

- Token in `localStorage`, keyed per lobby code, cleared on explicit leave.
- Exponential backoff with jitter and cap. Give up with clear Swedish message, not reconnect forever.
- Re-run route lookup before reconnect, socket URL never reused blindly, so changed topology surface as clean error.
- `visibilitychange` trigger immediate retry: mobile tab backgrounding is common case, not exotic one.
- Visible connection state (connected / reconnecting / lost), not frozen UI.

## Decisions taken in this stage

| Decision                            | Rationale                                                   |
| ----------------------------------- | ----------------------------------------------------------- |
| Seats outlive connections           | Only way refresh return to same identity                    |
| Epoch fencing                       | Kill stale-connection races and current `Client` data races |
| Grace timers send, never mutate     | Preserve single-goroutine state ownership                   |
| Epoch carried on the expiry message | Reconnect in flight must not be evicted by superseded timer |
| Resync replaces, never merges       | Merging = where stale-state bugs live                       |
| Public and private state separated  | Broadcast cannot leak private state by accident             |
| Token over the socket, not the URL  | Query strings reach logs, history, `Referer`                |
| `coder/websocket` over gorilla      | Context-aware I/O; less manual deadline bookkeeping         |

## Issues

| Issue                                                             | Title                                                    |
| ----------------------------------------------------------------- | -------------------------------------------------------- |
| [#67](https://github.com/Skill-issue-coding/OrdioArena/issues/67) | WebSocket transport on coder/websocket                   |
| [#68](https://github.com/Skill-issue-coding/OrdioArena/issues/68) | Restrict CheckOrigin to an origin allowlist              |
| [#69](https://github.com/Skill-issue-coding/OrdioArena/issues/69) | Hub and lobby goroutines with non-blocking sends         |
| [#70](https://github.com/Skill-issue-coding/OrdioArena/issues/70) | Seat model with epoch fencing                            |
| [#71](https://github.com/Skill-issue-coding/OrdioArena/issues/71) | Disconnect grace timers routed through the lobby channel |
| [#72](https://github.com/Skill-issue-coding/OrdioArena/issues/72) | Socket handshake and resync snapshot                     |
| [#73](https://github.com/Skill-issue-coding/OrdioArena/issues/73) | Client token storage, backoff reconnect, resume          |
| [#74](https://github.com/Skill-issue-coding/OrdioArena/issues/74) | Race tests for seats, epochs and grace expiry            |

## Open questions

- **Grace durations.** Lobby and mid-game want different numbers. Mid-game longer, dropped from game you winning worse than dropped from waiting room. Starting proposal: 60 s and 120 s.
- **Reconnect at exact expiry instant.** Must resolve deterministically one way or other, never both. Epoch check = mechanism, test = proof.
- **Ping interval and pong deadline.** Current server use 20 s / 40 s. Sleeping mobile radios may want more tolerance.
