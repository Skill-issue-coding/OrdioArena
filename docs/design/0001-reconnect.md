> **Status:** Accepted, not implemented · **Tracking:** [#17](https://github.com/Skill-issue-coding/OrdioArena/issues/17) · **Updated:** 2026-08-20
>
> Implementation order and progress live in issue #17 and its tasks, not here.

---

# Reconnect / Session Resume, Plan v2

A player who refreshes the browser, loses network for a few seconds, or has their mobile tab
backgrounded returns to the exact lobby and game they were in, with the same identity, name,
avatar colour, score, secret word and role. No accounts, no login, no email. Opening the site and
playing must stay a zero-friction path.

Non-goals: resuming a game after the server restarts, resuming across devices, persistent
player history.

## What v1 got right (keep)

- Client stores a token; server maps token → stable `UserId`.
- Disconnect starts a grace period instead of an immediate `PlayerLeft`.
- `UserProfile.IsConnected` broadcast so the roster can dim/spinner an absent player.
- Timeout after grace does the real removal + `PlayerLeft`.
- Manual verification of the three headline scenarios.

## Critical gaps in v1

### 1. The reconnect never happens on the game URL

Reconnect only works if the client re-sends `join_lobby`. That auto-join lives in
`LobbyView` (`frontend/src/pages/LobbyPage.tsx:57-65`), the `/lobby/$lobbyCode/` route only.

A player mid-game is on `/lobby/$lobbyCode/game`. After a refresh, `GamePage` mounts,
`phase` is `null` (no lobby state yet), and `GamePage.tsx:17-19` immediately does
`navigate({ to: "/" })`. The user is kicked to the home screen before the socket has even
finished its handshake. Same for `/lobby/$lobbyCode/game/result`.

So with v1 as written, the backend work would be invisible: refresh during a game still boots you.

### 2. Unregister/Register ordering race, the reconnecting player gets eliminated

On disconnect, `hub.Run` forwards to the lobby **asynchronously**:

```go
// session/gamehub.go:58-65
case client := <-hub.Unregister:
    if client.Lobby != nil {
        room := client.Lobby
        client.Lobby = nil
        go func() { room.Unregister <- client }()   // ← unordered
    }
```

A fast refresh can produce: new socket connects → `lobby.Register` (marks `IsConnected = true`,
cancels the grace timer) → _then_ the old client's `Unregister` lands → marks `IsConnected = false`
and starts a fresh grace timer → 30s later the player who is sitting there playing is eliminated.

v1 has nothing for this. Fix requires a seat/epoch guard (see design below).

### 3. Reconnect uses a new `*UserProfile` pointer, renames silently stop working

`lobby.Users[id]` stores the pointer from the _original_ `Client`
(`session/lobby.go:75`), and `ReadPump` mutates `c.Profile` directly on `update_user`
(`session/client.go:186-191`). After a reconnect there are two structs:

- `lobby.Users[id]` → old profile (what `BuildLobbyState` serialises)
- `newClient.Profile` → new profile (what `update_user` writes to)

Result: the returning player renames themselves, nobody else sees it; the `IsConnected` flag is
written on one struct and read from the other. v1 says "update their profile `IsConnected = true`"
without saying which one.

### 4. Capacity and phase checks run before the reconnect check

`lobby.Run`'s Register case tests `len(lobby.Users) >= MAXIMUM_LOBBY_SIZE` **first**
(`session/lobby.go:62`). A disconnected-but-in-grace player is still in `Users`, so in a full
12-player lobby the reconnecting player is told "Lobbyn är full". v1 only mentions bypassing the
`GameStarted` check.

### 5. Grace goroutine breaks the single-writer invariant

v1: "Spawn a goroutine that sleeps for a grace period … definitively remove them from
`lobby.Users` and call `PlayerLeft`."

That goroutine would mutate `lobby.Users` and touch `CurrentGame` from outside `lobby.Run`,
which is the one thing the architecture explicitly forbids:

```go
// session/lobby.go:54-56
// Run is the lobby's main event loop … is the only place where lobby state is
// mutated, making all field access implicitly single-threaded and safe without
// additional locking.
```

Timers must _signal_ into `Run`, never act. And `timer.Stop()` returning `false` (already fired)
means an expiry can already be queued when the player returns, the handler must re-validate at
consume time, not trust cancellation.

### 6. Empty lobby is destroyed during the grace window

`Unregister` shuts the whole lobby down when `len(lobby.Clients) == 0`
(`session/lobby.go:123-132`): stops the game, deletes the room from the hub, returns from `Run`.

Two players on flaky wifi, or a 3-player game where everyone refreshes at once, drops
`Clients` to 0 → room gone → the grace period they were promised is meaningless and the room
code is dead. The lobby must survive while any seat is still within its grace window.

### 7. No game-state snapshot, reconnect lands you on a blank screen

Games only emit incremental phase events. A player rejoining an Impostor game receives nothing
until the next phase transition, which in the discussion phase can be **150 seconds** away. Worse,
their secret word and role are only ever sent once, in `impostor_game_started`
(`server/game/impostor.go:718-738`), so for the rest of the round they literally cannot play.

On the client, `game.timers.start_time` stays `0`, and `GamePage.tsx:22` renders `null`. Blank page.

`../notes/architecture-review.md` §1 already identified this ("Rejoin needs a full game-state snapshot"); v1
dropped it. Reconnect is not shippable without it.

### 8. Multi-tab / duplicate identity is undefined

The token lives in `localStorage`, which is shared across tabs. Two tabs = two live sockets with
the same `UserId`:

- both `*Client`s sit in `lobby.Clients`, so targeted sends
  (`session/lobby.go:229-236`, which `break`s after the first match) deliver the impostor's secret
  word to whichever tab the map iteration happens to hit;
- closing one tab flips `IsConnected = false` and arms a grace timer while the player is still
  actively playing in the other.

Needs an explicit policy.

### 9. JWT is the wrong shape for this problem

v1 puts `UserId`, `Username` and `Background` in the token claims and re-reads them on connect.
But username/background are already persisted client-side under the `profile` key
(`frontend/src/hooks/user/Hook.tsx:65-80`) and are re-sent as `update_user` on every connect
(`Hook.tsx:136-139`). The claims are therefore both redundant and immediately stale, the token is
only minted at connect time, not on rename.

The one claim that actually needs server signing is `UserId`, because without a signature any
client can assert someone else's id and steal their seat, their host rights, or their role reveal.

So: sign, but sign only an opaque id + expiry. A `crypto/hmac` token is ~30 lines and no new
dependency; `golang-jwt/jwt/v5` is fine too, just don't put mutable profile data in it.

Related, from the same area:

- **No `exp`.** v1's token never expires, a permanent bearer identity in `localStorage`.
- **Token in the query string** (`?token=…`) lands in proxy/CDN/nginx access logs and in
  `Referer` headers. Send it as the first WebSocket message instead.
- **`CheckOrigin: return true`** (`server/handlers/websocket.go:19-22`) means any website can open
  a socket to the server. That was low-stakes while identity was per-socket; with a persistent
  bearer token it is worth an origin allowlist in the same change.
- **Secret handling:** read from env; if absent, generate a random per-process secret and log a
  warning (tokens die on restart) rather than shipping a hardcoded default.

### 10. `PlayerLeft` is too coarse for a turn-based phase

v1 keeps one hard action: after the grace timer, eliminate. But consider the Impostor input phase
where the disconnected player is the _current_ player. Everyone else stares at a frozen turn for
the full grace period.

Two distinct events are needed: a soft "this player is offline, don't block on them" and a hard
"this player is gone, eliminate them".

### 11. Starting a game with ghost players

`StartGameRequests` counts and enrols from `lobby.Users` (`session/lobby.go:179-187`). With
disconnected players still in `Users`, the host can start a game that includes players who are
mid-grace and may never return, and the `MIN_NUM_PLAYERS_TO_START_GAME` check passes on ghosts.

### 12. Host handling during grace is unspecified

Host promotion currently lives in the `Unregister` case (`session/lobby.go:135-141`). With a grace
period it must move to the expiry handler, and the rules need deciding: the lobby is
host-frozen (no start, no settings) while the host is away, and a returning ex-host does **not**
reclaim the role if promotion already happened.

### 13. Anti-Match ignores `PlayerLeft` entirely

`server/game/antimatch.go:197-198` has the `playerLeft` case commented out. Grace-timer expiry
will call `PlayerLeft`, the base implementation drops the id into a channel nobody reads, and the
round waits out its full timer because `len(entries) == len(g.players)` can never be satisfied.
Not fatal, but it must be implemented as part of this work, not discovered later.

### 14. Client-side state-reset ordering will wipe the snapshot

`GameContextProvider`'s effect resets game state to `DefaultEmptyGame(mode)` whenever `mode`
changes (`frontend/src/hooks/game/Hook.tsx:64-65`, deps at line 234). `mode` arrives via
`sync_gamestate`. If the game snapshot is delivered before the lobby sync, the snapshot is
immediately erased.

The same effect's `navigate({ to: `/lobby/${code}/game` })` closes over `code`, which is missing
from the dep array (already noted as `../notes/architecture-review.md` §5) and is `null` at that moment, a
reconnect would navigate to `/lobby/null/game`.

Server-side send ordering therefore has to be part of the spec, and the dep array has to be fixed.

---

## Revised design

### A. Identity token

An opaque, signed, expiring session token. No profile data in it.

```go
// server/session/token.go   (new)

// Token format: base64url(userID) + "." + base64url(exp) + "." + base64url(hmacSHA256(secret, payload))
const SESSION_TOKEN_TTL = 12 * time.Hour

func MintSessionToken(secret []byte, id uuid.UUID, now time.Time) string
func ParseSessionToken(secret []byte, tok string, now time.Time) (uuid.UUID, error)
```

- Secret from `OA_SESSION_SECRET`; random per-process fallback with a startup warning.
- Invalid, expired or missing token → mint a brand-new identity. Never an error to the user.
- A fresh token is issued on every successful connect (sliding expiry).

Client storage key: `oa_session_v1` (not `"jwt"`), so a format change is a rename, not a migration.

### B. Resume handshake (first message, not query param)

`HandleWebSocket` upgrades and then waits for one message with a short deadline (2s):

```
C → S   { "type": "resume", "payload": { "token": "<token or empty>" } }
S → C   { "type": "connected_to_hub", "payload": {
            "user": { ... },
            "token": "<fresh token>",
            "resumed": true|false,
            "lobby_code": "abcd-1234" | null    // set when the server still holds a live seat
        } }
```

If no message arrives before the deadline, treat it as a fresh identity and continue, an old
client build must not hang.

`lobby_code` is the piece that makes reconnect work from _any_ entry point (game URL, result URL,
or a re-opened tab with no URL context at all). The client trusts the server's answer over its own
URL.

Add an origin allowlist to `upgrader.CheckOrigin` in the same change.

### C. Hub-level session registry

```go
// GameHub
Sessions      map[uuid.UUID]*SessionEntry   // guarded by SessionsMutex
SessionsMutex sync.RWMutex

type SessionEntry struct {
    UserId     uuid.UUID
    Profile    UserProfile   // value copy, survives the Client that created it
    LobbyCode  string        // "" when not in a lobby
    LastSeen   time.Time
}
```

The registry answers "does this token still correspond to a live seat, and where?" before the
client has joined anything. Swept on a ticker: entries with no lobby and `LastSeen` older than the
token TTL are dropped.

The `Profile` value copy also removes the shared-pointer aliasing that gap #3 is a symptom of, and
lines up with `../notes/architecture-review.md` §2.

### D. Lobby seat model + epoch guard

Replace `Users map[uuid.UUID]*UserProfile` with an explicit seat:

```go
type Seat struct {
    Profile     UserProfile
    Client      *Client       // nil while disconnected, the authoritative "who owns this seat now"
    IsConnected bool
    Epoch       uint64        // incremented on every (re)connect
    graceTimer  *time.Timer
}

// GameLobby
Seats        map[uuid.UUID]*Seat
GraceExpired chan GraceExpiry   // { UserId uuid.UUID; Epoch uint64 }
```

`LobbyState.Users` keeps its current JSON shape (`map[uuid.UUID]*UserProfile` → serialise from
`Seats`) plus the new `is_connected` field, so the client contract barely moves.

**Register (reconnect-aware), in this order:**

1. `seat, exists := lobby.Seats[client.UserId]`
2. If `exists`: this is a reconnect, **skip the capacity and `GameStarted` checks entirely**.
   - If `seat.Client != nil && seat.Client != client`: another socket holds the seat. Send
     `session_replaced` to the old client and close it (single-connection policy, gap #8).
   - `seat.Client = client; seat.IsConnected = true; seat.Epoch++`
   - `seat.graceTimer.Stop()` (best-effort; the epoch is what actually guarantees correctness)
   - `client.Profile = &seat.Profile`, one profile struct per seat, always.
   - Add to `lobby.Clients`, set `client.Lobby`.
   - Emit the resume sequence (section F).
3. If `!exists`: existing new-join path (capacity check, `GameStarted` rejection, etc.).

**Unregister (guarded):**

```go
case client := <-lobby.Unregister:
    seat, ok := lobby.Seats[client.UserId]
    if !ok || seat.Client != client {
        // Stale unregister from a socket that has already been superseded.
        // Drop the client from the connection set and do nothing else.
        delete(lobby.Clients, client)
        continue
    }
    ...
```

That single `seat.Client != client` check is what closes gap #2.

Otherwise: `seat.Client = nil`, `seat.IsConnected = false`, remove from `lobby.Clients`,
notify the game with the **soft** signal (`PlayerDisconnected`), arm the grace timer, broadcast state.

```go
epoch := seat.Epoch
seat.graceTimer = time.AfterFunc(RECONNECT_GRACE, func() {
    select {
    case lobby.GraceExpired <- GraceExpiry{UserId: id, Epoch: epoch}:
    default:
    }
})
```

**Grace expiry (inside `Run`, re-validated):**

```go
case exp := <-lobby.GraceExpired:
    seat, ok := lobby.Seats[exp.UserId]
    if !ok || seat.Epoch != exp.Epoch || seat.IsConnected {
        continue    // player already came back, a Stop() that lost the race
    }
    delete(lobby.Seats, exp.UserId)
    if lobby.Phase == GameStarted && lobby.CurrentGame != nil {
        lobby.CurrentGame.PlayerLeft(exp.UserId)   // hard removal
    }
    lobby.promoteHostIfNeeded()
    lobby.maybeShutdown()
    lobby.SyncStateToAllClients()
```

`leave_lobby` stays immediate and unconditional, an explicit leave is not a disconnect and
should not linger for 45 seconds.

### E. Lobby lifetime

Replace the `len(lobby.Clients) == 0` teardown with a lobby-level timer:

- On any disconnect, if `len(lobby.Clients) == 0` **and** at least one seat is still within grace:
  keep the lobby alive, arm `EmptyLobbyTimer` (`EMPTY_LOBBY_TTL`).
- On the next Register, cancel it.
- On expiry with still-zero clients: stop the game, `DeleteRoom`, return from `Run`.
- Seats whose grace expires while the lobby is empty are removed as usual; when the last seat goes,
  tear down immediately.

Note the game goroutine keeps ticking while all players are away. That is acceptable (rounds burn),
and `GameBase.Broadcast` already falls back to `<-b.stop` so nothing deadlocks, but call it out in
testing so it is a decision, not a surprise.

### F. Game state snapshot, re-emit existing events, don't invent a new one

Add one method to the `Game` interface:

```go
// Resync asks the game to re-send the current state to a single player as if
// they had just been brought up to date. It must be non-blocking: the
// implementation forwards the id to an internal channel handled inside Run,
// so game state is never read from the lobby's goroutine.
Resync(uuid.UUID)
```

`GameBase` gets `resync chan uuid.UUID` and a default no-op forward, matching the existing
`PlayerLeft` pattern.

**Impostor** handles it in the `Run` select by re-emitting the events the client already knows how
to consume, targeted at the one player:

1. `impostor_game_started`, their word, their role, current phase, current timers, active players.
   (The client's handler for this also navigates to the game route, which is exactly the desired
   behaviour on reconnect.)
2. `impostor_round_update`, the full `cycles` history.
3. The event for the current phase: `impostor_input_phase` / `impostor_discussion_phase` /
   `impostor_vote_phase` / `impostor_intermediate`, with live timer values.

Zero new client reducers, zero new payload types. The client already handles all three.

**Anti-Match** does the same with `antimatch_input_phase` or `antimatch_round_result` depending on
phase. Its per-round history has no existing "full history" event, so a reconnecting player loses
earlier rounds on the final score screen, add `antimatch_round_update` (mirroring
`impostor_round_update`) or accept the gap explicitly. Do this alongside implementing
`handlePlayerLeft` for Anti-Match (gap #13).

Also add the two-tier notification (gap #10):

```go
PlayerDisconnected(uuid.UUID)   // soft: skip their turn, stop blocking on their submission
PlayerLeft(uuid.UUID)           // hard: eliminate (existing)
```

For Impostor, `PlayerDisconnected` during `input` when it is that player's turn should record an
empty submission and call `advanceInputPlayer()` immediately. For Anti-Match, it should exclude
them from the "everyone submitted" count so the round can end early.

### G. Send ordering on resume (matters, see gap #14)

The lobby must emit, to the reconnecting client only, in this exact order:

1. `sync_gamestate`, sets `code`, `mode`, `phase`, roster. Client contexts need `mode` before any
   game event or they will reset it away.
2. `joined_lobby`, client navigates to `/lobby/{code}`.
3. `game_started` (only if `lobby.Phase == GameStarted`), clears stale result state.
4. The `Resync` sequence from section F.

Because `Resync` runs in the game goroutine and routes back through `GameOutputs`, its events are
naturally ordered after steps 1–3, which are sent directly. Verify this in testing rather than
assuming it.

### H. Start-game guard (gap #11)

Enrol only connected seats, and require the minimum among connected players:

```go
players := make([]uuid.UUID, 0, len(lobby.Seats))
for id, seat := range lobby.Seats {
    if seat.IsConnected {
        players = append(players, id)
    }
}
if len(players) < MIN_NUM_PLAYERS_TO_START_GAME {
    client.SendError("Inte tillräckligt med anslutna spelare för att starta spelet.")
    continue
}
```

### I. Constants

```go
RECONNECT_GRACE   = 45 * time.Second   // not 10-15s: covers a mobile reload on 4G,
                                       // a backgrounded iOS tab, and a tunnel
EMPTY_LOBBY_TTL   = 60 * time.Second
SESSION_TOKEN_TTL = 12 * time.Hour
RESUME_DEADLINE   = 2 * time.Second    // wait for the first message after upgrade
```

45s is safe because the _soft_ disconnect signal already unblocks the game immediately, nobody
waits on an absent player. The grace period only governs whether the seat is eventually destroyed.

---

## Frontend changes

### `hooks/websocket/Hook.tsx`

- Do **not** append the token to the URL. On `onopen`, send
  `{ type: "resume", payload: { token: localStorage.getItem("oa_session_v1") ?? "" } }` before
  anything else.
- Expose `"connecting" | "connected" | "reconnecting" | "disconnected" | "error"` so the UI can
  distinguish a first connect from a recovery.
- Suppress the reconnect error toast on the first attempt, a 1-second blip should be silent.

### `hooks/user/Hook.tsx`

- Persist `payload.token` under `oa_session_v1` on every `connected_to_hub`.
- On `payload.resumed === true`, skip the "Välkommen till OrdioArena!" toast; show
  "Återansluten" instead.

### `hooks/lobby/Hook.tsx`

- Handle `lobby_code` from `connected_to_hub`: if present and the current route is not already that
  lobby, navigate there. This is what makes reconnect work from a closed/reopened tab.
- Add a `session_replaced` subscription: show "Du öppnade spelet i en annan flik" and stop
  reconnecting in this tab.

### `pages/GamePage.tsx`, the fix that makes any of this visible

Replace the unconditional bounce:

```tsx
useEffect(() => {
  if (phase !== "game_started") router({ to: "/" });
}, [phase, router]);
```

with: while `phase === null` (state not yet received), render a "Återansluter…" screen. Only
navigate home once a real lobby state has arrived and it is not `game_started`. Same treatment for
`ResultPage`.

### `hooks/game/Hook.tsx`

- Add `code` to the effect's dep array (`../notes/architecture-review.md` §5), otherwise reconnect navigation
  targets `/lobby/null/game`.
- Guard `navigate` calls on `code` being non-null.

### `components/lobby/PlayerList.tsx`

- Dim the avatar and show a small spinner/offline badge when `is_connected === false`.
- Optionally show the remaining grace countdown for the host.

---

## Test plan

### Automated (currently zero tests exist, `../notes/architecture-review.md` §7)

- `go test -race ./...` for everything below. This change introduces cross-goroutine timers into a
  package whose safety rests entirely on single-goroutine ownership; the race detector is not
  optional here.
- Table tests for the seat state machine: connect → disconnect → reconnect within grace →
  reconnect after grace → duplicate connect → stale unregister after reconnect (the gap #2 race,
  driven deterministically by injecting the epoch).
- `Resync` per mode: assert the exact event sequence and that a rejoining impostor receives their
  original word and role.

### Manual

| #   | Scenario                                                   | Expected                                                                         |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | Refresh during Impostor input phase, as the current player | Back in the game; word and role intact; turn either preserved or cleanly skipped |
| 2   | Refresh during discussion (the 150s worst case)            | Full submission history renders immediately, not after the phase ends            |
| 3   | Refresh on `/lobby/x/game` directly                        | No bounce to `/`                                                                 |
| 4   | Refresh on the result page                                 | Result still shown                                                               |
| 5   | Close the tab, reopen the site at `/` with no URL context  | Server-supplied `lobby_code` returns the player to the room                      |
| 6   | Open a second tab                                          | Old tab is replaced with a clear message; only one live seat                     |
| 7   | Host refreshes                                             | Lobby is host-frozen briefly, host is not re-assigned, controls return           |
| 8   | Host closes the tab and never returns                      | After grace: host promoted, lobby usable                                         |
| 9   | All players in a 3-player game refresh simultaneously      | Lobby survives; all three return                                                 |
| 10  | Close a tab and wait out the grace period                  | Eliminated, roster updated, game continues correctly                             |
| 11  | Refresh in a full 12-player lobby                          | Rejoins, no "Lobbyn är full"                                                     |
| 12  | Restart the server, then refresh                           | Clean new identity, no crash, no stuck screen                                    |
| 13  | Rename yourself, refresh, rename again                     | Both renames propagate to every other client (gap #3)                            |
| 14  | Anti-Match: player disconnects mid-round                   | Round ends early rather than waiting out the timer                               |
| 15  | Throttle to offline for 20s, then restore                  | Reconnects silently, no error toast spam                                         |

---
