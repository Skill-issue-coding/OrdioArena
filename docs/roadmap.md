> **Status:** Active · **Tracking:** milestones S0–S10 on roadmap board · **Updated:** 2026-08-24
>
> This doc = stage plan. Stage _done_ or not answered by its GitHub milestone, never this file.
> _Why_ behind architecture in
> [`design/0003-rewrite-architecture.md`](design/0003-rewrite-architecture.md).

---

# Rewrite roadmap

Full rewrite of `server/` + `frontend/`. Reconnect and multi-instance scale designed in from start,
not retrofitted. `preprocessing/` untouched. `wordfiles/` contract unchanged.

Eleven stages. **Each sequential**, stage exit criteria = next stage assumptions. One exception at
S9. Every stage ends in something demonstrable, not "code written".

| Stage   | Goal                                | Ends when                                                       |
| ------- | ----------------------------------- | --------------------------------------------------------------- |
| **S0**  | Skeleton, tooling, CI, containers   | 3 instances run locally behind proxy, CI green                  |
| **S1**  | Protocol contract with codegen      | TS event types generated from Go, CI fails on drift             |
| **S2**  | Cluster routing and lobby ownership | Create on any instance, all players land on owner               |
| **S3**  | Session tokens                      | Token minted on one instance verifies on another                |
| **S4**  | WebSocket, seats, reconnect         | Refresh and 30 s network drop both resume same seat             |
| **S5**  | Lobby domain                        | Full room lifecycle: roster, host transfer, chat, settings, TTL |
| **S6**  | Game engine and mode registry       | Test mode runs phase chain on fake clock, race-clean            |
| **S7**  | `anti_match`, end to end            | Three players finish game, one reconnects mid-round             |
| **S8**  | Cutover                             | Old `server/` + `frontend/` deleted, docs match reality         |
| **S9**  | `impostor`                          | Second mode ships without touching engine code                  |
| **S10** | `contexto_battle` + `synonym_duel`  | All four modes playable                                         |

First playable build = **S7**. S0–S6 = infrastructure. Front-loading is whole point of rewrite —
buys reconnect and scale free in every later stage.

---

## S0 · Skeleton, tooling, CI

**Goal:** two apps that build, test, lint, containerise. Nothing game-specific yet.

- Go module in `backend-v2/`: `net/http` + `chi`, `log/slog` structured logging, env config,
  graceful shutdown on `SIGTERM`, `GET /api/status`.
- `Clock` interface (`Now`, `NewTimer`, `After`), real + fake impls. Decided now because every S6
  phase deadline depends on it, retrofit = rewrite every test.
- Vite scaffold in `web/`: React 19, TS, TanStack Router, Tailwind v4, Prettier config carried over
  (no semicolons, `printWidth: 250`).
- GitHub Actions: `go vet`, `golangci-lint`, `go test -race`, `tsc --noEmit`, `eslint`, prettier
  check, both prod builds. Repo has no CI today.
- Multi-stage Dockerfile per app, `docker-compose.yml` runs three server instances behind reverse
  proxy.

**Exit:** `docker compose up` gives three healthy instances behind one proxy, CI green on PR.

---

## S1 · Protocol contract

**Goal:** kill hand-duplicated event protocol. Go = single source of truth.

- Envelope, `EventType` constants, payload structs in Go, each with doc comment.
- Generator emits TypeScript discriminated union + type guards into `web/src/protocol/`.
- CI step: regenerate, `git diff --exit-code`. Drift fails build instead of failing silent at
  runtime.
- Server README event tables generated from same source, cannot go stale either.

**Exit:** adding event = one Go file + one command. CI catches any client not regenerated.

---

## S2 · Cluster routing and lobby ownership

**Goal:** N instances, deterministic lobby ownership, zero shared state.

- Rendezvous (HRW) hashing over static peer list from env: `INSTANCE_ID`, `PUBLIC_WS_URL`,
  `CLUSTER_PEERS`.
- `Cluster` interface (`Self`, `Owns`, `RouteTo`), peer discovery swappable later, nothing else
  touched.
- `POST /api/lobby`, generates code by rejection sampling until it hashes to creating instance,
  returns `{ code, wsUrl }`.
- `GET /api/lobby/{code}/route`, returns `{ wsUrl }`, or 404 with
  `"Hittade inget rum med den koden."`
- `GET /ws/game/{code}`, ownership guard. Non-owner responds `421 Misdirected Request` and closes.
  **No path anywhere creates lobby from client-supplied code.**
- Tests: ownership stable across instances for same peer list; misdirected connects never create
  room.

**Exit:** three instances up, room created on any collects all its players on owner. Deliberate
misroute gives error screen, never second empty room.

---

## S3 · Session tokens

**Goal:** opaque, instance-agnostic, signed identity.

- HMAC-SHA256 over `{player_id, lobby_code, issued_at, expires_at}`, key id included so signing key
  rotates without invalidating live sessions.
- Shared `SESSION_SECRET` across every instance. Per-instance secrets would hand reconnecting
  players new identities.
- Constant-time verification, expiry check, clock-skew tolerance.
- Tests: tampered payload, expired token, wrong secret, token minted on one instance verifying on
  another.

**Exit:** token from `inst-1` verifies on `inst-3`, carries no instance identity of any kind.

---

## S4 · WebSocket transport, seats, reconnect

**Goal:** identity survives refresh and network drop. Stage whole rewrite exists for.

- `coder/websocket` read/write pumps, ping/pong deadlines, inbound rate limiting.
- `CheckOrigin` restricted to origin allowlist. Current server accepts every origin, standing
  security hole, not new requirement.
- Hub → lobby goroutine topology. Every cross-goroutine send non-blocking (`select` with `default`
  or `<-stop` fallback) so one slow client never stalls lobby.
- Seat model: `Seat{PlayerID, Profile, State, Epoch}`. Seats outlive connections.
- Epoch fencing, new connection for seat bumps `Epoch`, stale inbound events dropped. Second tab
  fences first instead of racing it.
- Grace timers send on lobby channel, never mutate lobby state from timer goroutine.
- `resync` snapshot event.
- Client: token in `localStorage`, exponential-backoff reconnect, route lookup before reconnecting.

**Exit:** refresh mid-lobby keeps same seat, name, colour. Kill network 30 s and resume. Second tab
cleanly fences first. `go test -race` green.

---

## S5 · Lobby domain

**Goal:** complete room lifecycle, across cluster.

- Roster, host role, host transfer when host leaves, chat.
- Offline players rendered offline, not removed.
- Settings as validated schema. min/max/default as data, serialised to client so settings UI is
  generated, not hard-coded per mode.
- Empty-lobby TTL collects abandoned rooms.
- All user-facing strings Swedish.

**Exit:** 3–12 players join and leave, host can leave without breaking room, empty lobby disappears
on its own.

---

## S6 · Game engine and mode registry

**Goal:** adding mode touches one file, zero switch statements.

- `Game` interface with `Snapshot(playerID)` **mandatory**. Mode cannot merge without resync
  support, that requirement is why this rewrite exists.
- `GameBase` provides input handling, broadcast, send, phase start.
- `Phase[T]` chain. Modes loop by relinking `Next`.
- `Registry`: `ModeID → ModeDef{Settings schema, New}`. Replaces four-plus switch sites that adding
  a mode costs today.
- Server-authoritative timestamps (`start_time`, `ready_time` = start + 2 s, `end_time`) as Unix
  ms, all from `Clock`. Clients render countdowns; never decide when phase ends.
- Dictionary loading from existing `wordfiles/`, same six files, same binary layout.

**Exit:** throwaway test mode runs full phase chain on fake clock, deterministic, no sleeps,
race-clean.

---

## S7 · `anti_match`, end to end

**Goal:** one mode fully playable, reconnect-safe. Vertical slice proving S0–S6.

- Rounds, submissions, exact-duplicate detection, early advance once everyone submitted.
- Scoring with per-target `AntiHiveThreshold` **actually applied**. Today loaded from
  `targets.json` then ignored, so "too random" cutoff does nothing.
- Player-leave handling, including case that currently blocks early-advance check.
- Mid-round resync carries player's own submissions + round deadline.
- Results screen with rank and round's best word.

**Exit:** three players complete full game. One refreshes mid-round, resumes into same round. One
drops past grace period, round still resolves. Scores correct both cases, scenarios covered by
tests.

---

## S8 · Cutover

**Goal:** new code is only code.

- Delete `server/` and `frontend/`; rename `backend-v2/` → `backend/` and `web/` → `frontend/`.
- Move `server/wordfiles/` → `backend/wordfiles/`, update three preprocessing constants that
  hardcode old path. `server/` disappearing = one place rewrite touches Python.
- Rewrite root `CLAUDE.md`, backend README (with generated event tables), frontend docs, describe
  what exists, not what used to.
- Deploy multi-instance on self-hosted box.

**Exit:** one backend, one client, docs match code, preprocessing run writes to new path unaided.

---

## S9 · `impostor`

**Goal:** second mode ships without touching engine code. Test of whether S6 registry paid for
itself.

Roles + per-player secret words, turn-based input, discussion, voting, elimination, win conditions
both directions. Mid-game resync must restore player's private role and word, exactly what old
codebase could not do.

Can start parallel with S8 if cutover scheduled around deploy window. Depends on S7, not S8.

---

## S10 · `contexto_battle` + `synonym_duel`

**Goal:** two modes that only ever existed as settings.

- **Kontext Strid**, continuous guessing toward hidden target. Closest last guess when timer
  expires wins round.
- **Synonym Duell**, everyone submits synonym. Submission semantically furthest from target
  eliminated. Last player standing wins.

Both = new game logic on proven engine. If either needs engine change, that is finding worth
recording against S6.

---

## What is deliberately not on this roadmap

- **Lobbies surviving restart.** Deploys and crashes kill in-flight games, by decision. Making
  state serialisable constrains every type in system for benefit only visible during deploys.
- **Cross-device session transfer.** Reconnect covers same device: refresh, tab reopen, network
  drop. Moving session between devices adds real UX and real security surface, whoever holds token
  owns seat.
- **Accounts, logins, persistent player history.** Zero-friction path is product.
- **Preprocessing work.** Tracked separately. Wordfiles contract does not move during rewrite.
