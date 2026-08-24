> **Status:** Not started · **Tracking:** milestone S2, issues [#59–#63](https://github.com/Skill-issue-coding/OrdioArena/milestone/7) · **Updated:** 2026-08-24
>
> Stage spec. Architecture rationale: [0003-rewrite-architecture.md](0003-rewrite-architecture.md) §1.

---

# S2 · Cluster routing

**Goal:** N instances, deterministic lobby ownership, zero shared state.

**Exit:** three instances up, room created on any collects all players on owner. Misrouted client gets error screen, never second empty room.

## The shape

Lobby live in one goroutine, one instance. Clients routed there. Keeps single-goroutine ownership = safe without mutexes. Buys horizontal scale by moving problem up into routing.

Ownership **computed, not stored**. No registry, no Redis, no lookup table.

## Rendezvous hashing

```go
func owner(code string, peers []Peer) Peer {
    best, bestScore := Peer{}, uint64(0)
    for _, p := range peers {
        s := hash64(p.ID + "\x00" + code)   // separator prevents  "a"+"bc" == "ab"+"c"
        if s > bestScore || (s == bestScore && p.ID < best.ID) {
            best, bestScore = p, s
        }
    }
    return best
}
```

Three load-bearing things, easy to get wrong:

- **Hash function pinned.** Every instance must compute same score. Use explicit stable function (FNV-1a or xxhash), never `maphash`, seed per-process by design.
- **Separator byte required.** Without it, peer `"a"` + code `"bc"` collides with peer `"ab"` + code `"c"`.
- **Ties break deterministically** on peer id. 64-bit tie near-impossible, silently non-deterministic if unhandled.

Rendezvous over consistent-hash ring: no virtual nodes to tune, peer-list change moves only codes of changed peer.

## The Cluster interface

```go
type Cluster interface {
    Self() PeerID
    Owns(code string) bool
    RouteTo(code string) (wsURL string, ok bool)
}
```

v1 reads static peer list from env. Peer list immutable for process lifetime, change it = deploy event, not runtime one.

Single-peer config (one instance, itself) must work unchanged. Local dev needs no cluster setup.

Later swap to DNS-SRV discovery, Fly.io `fly-replay` variant, or Kubernetes headless service = one impl of this interface, zero changes elsewhere.

## How instances are addressed

Each instance needs distinct publicly reachable WebSocket address, because _client_ told where to connect. Proxy does not compute ownership, Go does.

Path prefixes simpler than per-instance DNS for self-hosted:

```text
PUBLIC_WS_URL = wss://ordio.example/i/inst-2
proxy strips /i/inst-2  →  inst-2:8080
```

One hostname, one cert, no DNS record per instance. Per-instance subdomains work too, cost wildcard cert plus DNS entry each.

## Endpoints

```text
POST /api/lobby                → { code, wsUrl }
GET  /api/lobby/{code}/route   → { wsUrl }  |  404 "Hittade inget rum med den koden."
GET  /ws/game/{code}           → upgrade, or 421 if not owned
```

### Creation and rejection sampling

Creating instance draws random codes until one hashes to itself:

```go
for attempt := 0; attempt < maxAttempts; attempt++ {
    code := randomCode()
    if !cluster.Owns(code) { continue }
    if _, taken := lobbies[code]; taken { continue }
    // ...
}
// exhausted: 503, never an unbounded loop
```

`N` peers = `N` draws average. Trivial for realistic `N`.

**Collision check free.** Identical codes always hash to same instance, so "code taken?" answered from local memory by only instance that could know. No cross-instance coordination, ever.

Alternative, shard hint embedded in code, rejected. Makes code format migration surface for every future topology change.

### Code alphabet

Exclude look-alike chars, codes read aloud and typed by hand: no `0`/`O`, no `1`/`I`/`L`. 4-char code over remaining ~23 letters and 8 digits ≈ million combos. Far more than concurrent lobbies need.

Normalisation (case folding, whitespace, look-alike substitution) happens in exactly one function, used by route lookup and upgrade guard. Two normalisers = bug waiting.

### The ownership guard

Instance receiving socket for code it does not own responds `421 Misdirected Request` and closes, before upgrade.

**Load-bearing rule of whole design.** As long as no code path creates lobby from client-supplied code, routing bug shows as error screen instead of split-brain room where two halves of party never see each other. Current codebase has this property; must survive verbatim.

Test asserts absence of create-by-code path, so future refactor cannot reintroduce one quietly.

### Why REST before the socket

Browsers do not follow redirects on WebSocket handshake. `307` from non-owner not actionable by client. Rules out connect-anywhere design, why joining resolves owner over REST first.

`GET /api/lobby/{code}/route` rate limited, room-code oracle otherwise.

## Decisions taken in this stage

| Decision                             | Rationale                                                  |
| ------------------------------------ | ---------------------------------------------------------- |
| Rendezvous over consistent-hash ring | No vnode tuning; minimal reshuffle on peer change          |
| Static peer list from env            | No discovery dependency; membership change is deploy event |
| Codes carry no shard hint            | Keeps code format out of future topology migrations        |
| REST route lookup before the socket  | Browsers cannot follow WS handshake redirects              |
| `421` and close, never create        | Routing bug becomes error screen, not split-brain room     |
| Path-prefix addressing per instance  | One hostname, one cert for self-hosted deploy              |

## Issues

| Issue                                                             | Title                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------- |
| [#59](https://github.com/Skill-issue-coding/OrdioArena/issues/59) | Rendezvous hashing and the Cluster interface         |
| [#60](https://github.com/Skill-issue-coding/OrdioArena/issues/60) | POST /api/lobby with rejection-sampled room codes    |
| [#61](https://github.com/Skill-issue-coding/OrdioArena/issues/61) | GET /api/lobby/{code}/route                          |
| [#62](https://github.com/Skill-issue-coding/OrdioArena/issues/62) | WebSocket ownership guard, 421 on misdirect          |
| [#63](https://github.com/Skill-issue-coding/OrdioArena/issues/63) | Client create and join flow through the route lookup |

## Open questions

- **Code length.** Four chars current convention, reads well aloud. Five buys headroom nobody needs yet.
- **Pending-lobby reap window.** Created-but-never-joined lobby must expire, else probing client accumulates empty rooms. Sixty seconds is guess.
- **Peer-change behaviour.** Remapped codes strand lobbies on old owner. Consistent with accepted "lobbies die with their instance", but S8 deploy procedure must say _drain, then change membership_, not reshuffle live.
