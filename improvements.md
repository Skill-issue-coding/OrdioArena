# Architectural Improvements

Findings from an architecture review (2026-07-02), priority order. Core architecture is solid: hub/lobby/game each own their state in a single goroutine via channels, typed WS protocol on both ends, `GameBase` embedding cuts boilerplate. The items below are the gaps.

## 1. No reconnect / session resume — biggest gap

Identity is a per-socket UUID assigned at connect. A page refresh mid-game triggers `Unregister` → `PlayerLeft` → the player is eliminated. For a real-time party game this is the #1 architectural hole.

Fix path:

- Client stores a session token (localStorage), sends it on connect. Server maps token → UserId.
- Disconnect starts a grace timer (~30s) instead of immediate `PlayerLeft`.
- Rejoin needs a full game-state snapshot. Games only emit incremental phase events today (`sync_request` covers lobby state only). Add `GameState(playerId) any` to the `Game` interface so the lobby can hydrate a rejoining client. This also fixes desync from any missed event, not only reconnect.

## 2. Data races on `Client` fields

Field ownership is spread across 3 goroutines:

- `client.Lobby` is written by lobby.Run (`session/lobby.go:81`), nil'd by hub.Run (`session/gamehub.go:61`), and read by ReadPump (`session/client.go:171` etc.) — no synchronization.
- `client.Profile` is mutated by ReadPump on `update_user` (`session/client.go:187`) while lobby.Run reads it in `BuildLobbyState`. The `Users` map shares the pointer and serializes it during sync — torn read possible.

Run `go run -race` to confirm. Fix: make ReadPump the sole owner of `Lobby` (hub/lobby signal via channel), and route profile updates through a lobby channel carrying the payload instead of mutating directly.

## 3. Mode registry — pay-once refactor before contexto/synonym

Adding a mode today touches 4+ switch sites: `SetMode`, `ModeSettings`, `ApplySetting` (`session/lobby.go:305-378`), game construction (`session/lobby.go:196-201`), plus 4 settings fields on `GameLobby`. Contexto + synonym are still unimplemented — they will double this.

Fix: registry map keyed by `GameMode`:

```go
type ModeDefinition struct {
    Defaults     func() any
    ApplySetting func(settings any, key GameSetting, value float64)
    NewGame      func(settings any, players []uuid.UUID, dict *words.Dictionary, out chan game.GameOutput, onDone func()) game.Game
}
```

Lobby holds `Settings any` + the current mode. A new mode becomes one registration + one game file. Client mirror: per-mode handler modules (see #5).

## 4. Duplicated output routing in lobby

`session/lobby.go:224-236` (GameOutputs case) and `session/lobby.go:246-260` (GameDone drain) contain an identical routing loop. Extract a `deliverOutput(out GameOutput)` helper.

## 5. Client `GameContextProvider` monolith

`client/src/hooks/game/Hook.tsx` — one useEffect holds all mode subscriptions and grows linearly per mode. Split into per-mode subscription modules (e.g. `impostor/subscriptions.ts` returns an unsub list, provider composes by mode).

Also a bug: the dep array `[subscribe, mode, navigate]` is missing `code` — the navigate closures capture a stale lobby code if it changes.

## 6. Dead code + stale docs

- `server/test.go` — 229 lines, all commented out. Delete.
- `server/main.go:16-29, 88-138` — commented blocks. Delete.
- `GameHub.Broadcast` channel — no writers anywhere. Delete the case + field.
- `project-context.md` says the client is Next.js with `client/components/home/HomeView.tsx` paths — actual is Vite + TanStack Router. `client/CLAUDE.md` says "No routes defined yet" but `routeTree.gen.ts` exists. Both mislead future AI/dev sessions; update them.

## 7. Zero tests

No `_test.go` files. Game logic is ideal for table tests — vote resolution (`getPlayerWithMostVotes`), antimatch scoring, phase chains. Dependencies are already injectable (dict pointer, outputs channel, onDone). Cheap win before implementing 2 more modes.

## Minor

- Hub mixes concurrency styles: channel-owned `Clients` map + mutex-guarded `Lobbies` map. Works, but pick one (mutex everywhere is simpler since lobby creation is request-driven).
- `Phase[T]` linked list with loop-by-relink is clever but implicit; a `nextPhase()` function per mode would be more debuggable. Low priority.

## Recommended order

1. #2 (races — correctness)
2. #4 / #6 (trivial cleanups)
3. #3 (mode registry)
4. Implement contexto/synonym on the clean base
5. #1 (reconnect — biggest UX payoff)
