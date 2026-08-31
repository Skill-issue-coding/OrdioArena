> **Status:** Accepted, not implemented · **Tracking:** roadmap board, milestones S0–S10 · **Updated:** 2026-08-24
>
> This doc = _why_ behind rewrite. Stage order + progress live in
> [`../roadmap.md`](../roadmap.md) and GitHub issues, not here.

---

# Rewrite architecture: multi-instance OrdioArena

Current server + client work. Two properties never designed in, cannot retrofit cheap:

1. **Reconnect.** Refresh mint new identity, drop player from lobby. Mid-game = eliminated. Bolt-on
   touch every mode, every lobby mutation, whole client state model, same surface rewrite touch anyway.
2. **Horizontal scale.** `GameHub.Lobbies` = in-memory map inside one process. Two instances behind
   load balancer = two players, same room code, two unrelated lobbies. Today: hard single-instance constraint.

Rewrite treat both as load-bearing from commit one. Rest, game modes, word vectors, phase model —
port of code that already work.

## Scope

| Part             | Rewrite? | Why                                                            |
| ---------------- | -------- | -------------------------------------------------------------- |
| `server/`        | Yes      | Identity, routing, lobby ownership all change shape            |
| `frontend/`      | Yes      | Reconnect change state model; protocol types become generated  |
| `preprocessing/` | **No**   | Logic unaffected. One output path move at cutover, three lines |

Wordfile _contract_ survive untouched, same six files, same binary layout, same semantics. So Python
pipeline need no coordination with this work in flight.

Wordfile _path_ not. Rewrite build in `backend-v2/`, S8 rename to `backend/`, so `server/wordfiles/`
become `backend/wordfiles/` and three Python constants that hardcode it (`shared.py`,
`model_reduction.py`, `stage_5.py`) move with it. That = whole preprocessing footprint of rewrite.
Deferred to S8 so pipeline keep working until old directory disappear.

## Locked decisions

Decided up front. Reopen one = roadmap change, not implementation detail.

| #   | Decision        | Choice                                                     |
| --- | --------------- | ---------------------------------------------------------- |
| 1   | Scaling model   | Lobby-affinity routing, no shared state                    |
| 2   | Hosting         | Self-hosted; routing kept behind interface                 |
| 3   | Backend stack   | Go + `net/http` + `chi` + `coder/websocket`                |
| 4   | Frontend stack  | Unchanged: React 19, Vite, TS, TanStack Router, Tailwind 4 |
| 5   | Durability      | Lobbies die with instance. Accepted                        |
| 6   | Reconnect scope | Refresh + network drop, same device                        |
| 7   | Repo layout     | Build in new dirs, delete old ones at cutover              |
| 8   | v1 game content | `anti_match` only, vertical slice                          |

## 1. Scaling: lobby-affinity routing

**Lobby live in exactly one goroutine, on exactly one instance. Clients routed to that instance.**
Nothing about lobby or game state shared, replicated, locked.

Keep property that make current code safe without mutexes, single-goroutine state ownership, and
buy horizontal scale by moving problem up one level, into routing.

```text
                    POST /api/lobby            GET /api/lobby/ABCD/route
                          │                              │
                    ┌─────▼──────────────────────────────▼─────┐
                    │        load balancer (round robin)        │
                    └─────┬───────────────┬───────────────┬────┘
                          │               │               │
                      inst-1          inst-2          inst-3
                    owns EFGH       owns ABCD       owns MNPQ
                                        ▲
              wss://inst-2.host/ws/game/ABCD  ◀── every ABCD player connects here
```

### Ownership is computed, not stored

`owner(code) = rendezvous_hash(code, peers)`, highest-random-weight hashing over configured peer
list. No registry, no Redis, no lookup table. Every instance compute same answer from same inputs.

Rendezvous over consistent-hash ring: no virtual nodes to tune, and when peer list change only codes
belonging to changed peer move.

### Three consequences worth stating

**Code collisions need no coordination.** Two identical codes always hash to same instance, so "is
this code taken" answered from local memory by only instance that could know. Uniqueness free.

**Code generation use rejection sampling.** Instance creating room draw random codes until one hash
to itself. With `N` peers = `N` draws average, trivial for any realistic `N`. Alternative, embed
shard hint in code, rejected: make code format a migration surface for every future topology change.

**Misdirected connections stay graceful, and that load-bearing.** Instance receiving WebSocket for
code it not own respond `421 Misdirected Request` and close. Not create lobby, not proxy, not guess.
**No code path anywhere create lobby from client-supplied code**, only creator = `POST /api/lobby`,
which mint own code. That single rule make routing bug show up as error screen, not split-brain room.

### Client flow

Room create + join go through REST first, so browser open WebSocket at right host first try. Browsers
not follow redirects on WebSocket handshake, rule out obvious "connect anywhere, get 307'd" design.

```text
create:  POST /api/lobby                → { code, wsUrl }
join:    GET  /api/lobby/{code}/route   → { wsUrl }  |  404 "Hittade inget rum med den koden."
then:    open wsUrl, handshake over the socket
```

### Routing is one swappable component

Hosting not finalised, so peer discovery sit behind interface:

```go
type Cluster interface {
    Self()  PeerID
    Owns(code string) bool
    RouteTo(code string) (wsURL string, ok bool)
}
```

v1 impl: static peer list from env (`INSTANCE_ID`, `CLUSTER_PEERS`; the list includes this instance,
so `cfg.Self()` derives its own URL and `PUBLIC_WS_URL` does not exist). Swap in DNS-SRV
discovery, Fly.io `fly-replay` variant, or Kubernetes headless service later = one impl of this
interface, zero changes elsewhere.

### What this deliberately does not solve

Change peer list = remap codes, so lobbies on removed instance become unreachable. Consistent with
decision 5, need no extra machinery. But mean **peer list changes are deploy event, not runtime one**.
Rolling deploys drain, not reshuffle.

## 2. Identity and reconnect

No accounts, no login. Zero-friction path unchanged: open site, get name, play.

### Token

Opaque, server-signed blob. HMAC-SHA256 over `{player_id, lobby_code, issued_at, expires_at}`, plus
key id so signing key rotate without invalidating live sessions.

**Token carry no instance identity.** No peer id, no shard hint, no host. Token minted by `inst-1`
verify on `inst-3` because every instance hold same `SESSION_KEYS`. That keep future topology
changes from becoming token-format migrations. Per-instance secrets would silently hand reconnecting
players brand-new identities.

Token never in URL or query string. Exchanged in first message over socket, stay out of proxy logs
and browser history.

```text
client → server   hello  { token?, lobbyCode }
server → client   identity { token, playerId, profile }        (new or resumed)
server → client   resync   { lobby, game?, private? }          (if resuming)
```

### Seats, not connections

Lobby own **seats**, not sockets:

```go
type Seat struct {
    PlayerID uuid.UUID
    Profile  Profile
    State    SeatState  // online | offline
    Epoch    uint64     // bumped on every new connection for this seat
    conn     *Conn      // may be nil while offline
}
```

Seat outlive its connection. Disconnect flip seat to `offline` and start grace timer, not remove
player. Reconnect re-attach new connection to same seat.

**Epoch fencing** solve stale-connection problem: every new connection for seat increment `Epoch`,
any inbound event with older epoch dropped. Open game in second tab, first tab fenced out, not racing.
Also remove current data races on `client.Lobby` / `client.Profile` by construction, `Client` type
no longer own shared state, carry an id and two channels.

### Grace timers respect goroutine ownership

Grace timer never touch lobby state. Fire, send message on lobby channel; lobby goroutine handle it
inside own `select`, like any other event. Same rule as every other timer in system.

Expiry behaviour per-phase, not global: in lobby, expiry remove seat; mid-game it mode's decision
(`anti_match` score round without them, `impostor` must not silently change impostor count).

### Resync is a first-class part of the Game interface

`Snapshot(playerID) any` = required method on `Game`, not optional add-on. Mode cannot merge without
it. Return everything player need to render current state from scratch: phase, deadlines, public
state, own private state (secret word, role, submissions). This single reason reconnect designed in,
not added later, retrofit `Snapshot` onto finished modes = where current codebase got stuck.

## 3. Protocol: one source of truth

Event protocol currently duplicated by hand in Go and TypeScript, tables in `server/README.md` a
third copy. Mismatch fail silent at runtime.

Rewrite generate TypeScript from Go types. Go stay authoritative; generator emit discriminated union
plus type guards into client, CI regenerate and fail on any diff. Add event = edit one Go file, run
one command.

Envelope stay as-is, `{ "type": "...", "payload": { ... } }`, already work, client pub/sub transport
built on it.

## 4. Modes are data, not switch arms

Add mode today = edit `SetMode`, `ModeSettings`, `ApplySetting`, game construction, lobby settings
field. Four modes in, cost paid three times, two modes still unimplemented.

Registry pay it once:

```go
type ModeDef struct {
    ID       ModeID
    Settings SettingsSchema           // min/max/default as data
    New      func(GameDeps) Game
}

var registry = map[ModeID]ModeDef{ ... }
```

Settings as schema over switch = second payoff: schema serialisable, so client settings UI generated
from it, not hard-coding every mode's controls.

## 5. Testability decided up front

Two choices made in stage 0, expensive later:

- **`Clock` interface** (`Now`, `NewTimer`, `After`), real + fake impl. Every phase deadline go
  through it. Without: every phase test = `time.Sleep`, suite slow and flaky.
- **Dependency-injected game construction**, dictionary pointer, outputs channel, clock, `onDone`.
  Current code already do this well; rewrite keep.

`go test -race` mandatory in CI from stage 0, not added once something to test.

## Rejected alternatives

**Externalise lobby state to Redis.** Textbook answer. Dissolve single-goroutine ownership that make
this code safe without locks. Every mutation need lock or Lua script, races become default failure
mode instead of impossible one.

**Registry + owner forwarding** (any instance accept, forward events to owner). Work behind dumb load
balancer, but add network hop per event to latency-sensitive game, plus shared registry = new single
point of failure. Lobby-affinity get same outcome with neither.

**Sticky sessions at load balancer.** Standard affinity pin a _user_ to instance. Lobby shared by
3–12 users, each pinned independently, scatter across instances. Lobby = sharding unit, not user.

**Persist lobbies across restarts.** Out of scope (decision 5). Force every piece of lobby and game
state to become serialisable, constrain every type in system for benefit only visible during
deploys. Revisit when deploy frequency actually hurt.
