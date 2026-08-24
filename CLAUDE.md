# OrdioArena

Real-time multiplayer word party game in Swedish. Players create a room, share a code, pick a
mode and play. **No accounts, no login**: identity is assigned by the server on WebSocket
connect. Keep that zero-friction path intact when changing anything about identity or joining.

Three independent parts in one repo:

| Directory        | Stack                                   | Role                                                                     |
| ---------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| `preprocessing/` | Python 3.13, Wikipedia2Vec, spaCy       | Offline NLP pipeline; emits binary word vectors into `server/wordfiles/` |
| `server/`        | Go 1.25, Gin, gorilla/websocket         | Game server: hub, lobbies, game modes, WebSocket protocol                |
| `frontend/`      | Vite 8, React 19, TS 6, TanStack Router | Browser client                                                           |

They are coupled only by two contracts: the files in `server/wordfiles/` (preprocessing → server)
and the WebSocket event protocol (server ↔ frontend). Change either side of a contract and you
must change the other.

## Where the real documentation is

This file is the map. The details live in per-directory docs. **Read the relevant one before
working in that area**, do not re-derive from source:

- `server/README.md`: goroutine topology, the complete WebSocket event tables (both directions,
  per mode), phase state machines, settings reference, known gaps. The single most useful doc in
  the repo.
- `frontend/CLAUDE.md`: React/TS/Tailwind/TanStack rules and the WS type architecture.
- `frontend/README.md`: route tree, file-based routing conventions, Next.js → Vite port mapping.
- `preprocessing/README.md`: stage-by-stage pipeline, `shared.py` exports, data sources.

Planning / analysis documents live in `docs/`, indexed by `docs/README.md`. They are specs and
decisions, **not** status: what is done, in progress or dropped is tracked in
[GitHub issues](https://github.com/Skill-issue-coding/OrdioArena/issues) and the
[roadmap board](https://github.com/orgs/Skill-issue-coding/projects/1), grouped into milestones
M1 Reconnect / M2 Game feel / M3 Foundations / M4 New modes.

- `docs/design/0001-reconnect.md`: reconnect / session-resume design (issue #17).
- `docs/design/0002-word-selection.md`: target and vocabulary selection, largely implemented.
- `docs/decisions/anti-match-tuning.md`: scoring and balance levers with trade-offs, options still
  open (issue #25).
- `docs/notes/architecture-review.md`: architecture review findings, 2026-07-02 (issue #30).
- `docs/notes/code-vs-plan-audit.md`: which planned preprocessing work is actually in the code,
  with file:line evidence. Check this before trusting a plan document's claim about a gap.
- `docs/notes/preprocessing-w2v-migration.md`: Wikipedia2Vec training and the completed migration.
- `archive/`: superseded documents, kept for context. Never implement from here.

**Every document in `docs/` opens with a status header.** Read it first: several bodies describe
gaps that have since been closed, and the header says so.

## Running things

```bash
# Server (needs server/wordfiles/ populated, see below)
cd server && go run .              # http://localhost:8080
LOG_TO_FILE=true go run .          # per-domain files in server/logs/ at debug level

# Frontend
cd frontend && npm install && npm run dev
npm run typecheck                  # tsc --noEmit
npm run lint                       # eslint
npm run format                     # prettier --write

# Preprocessing (from preprocessing/, stages must run in order, see its README)
python stage_1.py … stage_7.py     # stage_8 optional, stage_9 enriches targets
```

There is no test suite yet (`docs/notes/architecture-review.md` §7, issue #32). If you add Go code
with non-trivial logic, add a `_test.go`: game logic is already dependency-injectable (dict
pointer, outputs channel, `onDone`). Anything touching goroutines or timers must be checked with
`go test -race`.

### Environment variables

| Var                        | Where         | Purpose                                                                  |
| -------------------------- | ------------- | ------------------------------------------------------------------------ |
| `LOG_TO_FILE`              | server        | `true` → `server/logs/{hub,lobby,game,client}.log` at debug level        |
| `VITE_WS_PATH`             | frontend      | WS host; unset → `ws://localhost:8080/ws/game`                           |
| `VITE_PUBLIC_BACKEND_PATH` | frontend      | REST base (already includes `/api`); unset → `http://localhost:8080/api` |
| `VITE_LOG_LEVEL`           | frontend      | Console threshold; defaults to debug in dev, info in prod                |
| `VITE_LOG_TO_SERVER`       | frontend      | `true` → batch browser logs to `POST /api/log` → `logs/client.log`       |
| `MAIL`                     | preprocessing | User-Agent for SPARQL / Wikimedia requests (`preprocessing/.env.local`)  |

### Generated and large files, do not hand-edit

- `server/wordfiles/*`: output of the preprocessing pipeline. `vocab.bin` is Git LFS. The server
  **fails to start** without these; `words.InitializeDictionary()` loads them at boot.
- `frontend/src/routeTree.gen.ts`: regenerated by the TanStack Router Vite plugin on dev/build.
- `preprocessing/intermediate/`, `preprocessing/model/`: git-ignored scratch and the ~3–4 GB
  Wikipedia2Vec model.

## Architecture invariants

These are load-bearing. Breaking one produces races that only show under real multiplayer load.

**1. Single-goroutine state ownership.** Each layer owns its state in exactly one goroutine and is
reached only through channels:

```text
ReadPump/WritePump (per client) → GameHub.Run (owns Clients) → GameLobby.Run (owns all lobby
state) → Game.Run (owns all game state)
```

`GameLobby.Run` is the only writer of lobby state. `Game.Run` is the only reader/writer of game
state. Never mutate lobby or game fields from a timer callback, an HTTP handler, or a spawned
helper goroutine: send on a channel and handle it inside the owning `select` instead. The one
exception is `GameHub.LobbiesMutex`, which guards the `Lobbies` map because HTTP upgrade handlers
touch it from outside the hub goroutine.

**2. Non-blocking sends.** Every cross-goroutine send uses `select` with a `default` (drop) or a
`<-stop` fallback, so one slow client can never stall a lobby or a game. Follow the existing
pattern in `Client.SendEvent`, `GameBase.HandleInput` and `GameBase.Broadcast` when adding new
channels.

**3. The event protocol is duplicated by hand in two languages.** Adding or changing an event means
editing all of:

- `server/events/events.go` or `events/game_events.go` (the `EventType` constant + doc comment)
- the payload struct in `server/session/payloads.go` or `server/game/payloads.go`
- the TS mirror under `frontend/src/hooks/websocket/` (or `hooks/lobby/types.ts` /
  `hooks/game/shared.ts`, see `frontend/CLAUDE.md` §9)
- the tables in `server/README.md`

There is no codegen. A mismatch fails silently at runtime, not at compile time.

**4. Adding a game mode touches 4+ switch sites.** `SetMode`, `ModeSettings`, `ApplySetting`, game
construction in the `StartGameRequests` case, plus a settings field on `GameLobby`. `contexto` and
`synonym` are still unimplemented; `docs/notes/architecture-review.md` §3 proposes a mode registry
to pay this cost once (issue #31). Do that refactor before implementing the third and fourth modes
(issues #38, #39).

**5. All timers are server-authoritative.** Phase events carry `start_time`, `ready_time`
(= start + 2 s `SYNC_DELAY`) and `end_time` as Unix millisecond timestamps. Clients render
countdowns from those; they never decide when a phase ends.

## Deployment constraints

**The server runs as a single instance. This is a hard constraint today, not a preference.**

It follows directly from invariant #1. `GameHub.Lobbies` is an in-memory map, each
`GameLobby.Run` is a goroutine in that process, and all lobby and game state lives inside those
goroutines. Nothing is shared, persisted, or reachable from another process.

Run two instances behind a load balancer and two players entering the same room code can land on
different instances, join two unrelated lobbies, and never see each other. This is true of the
code as it stands; reconnect does not introduce it, it only makes it visible.

The failure is at least graceful, and must stay that way: `GetRoom` returns `nil` for an unknown
code (`session/gamehub.go:133-136`), the only room creator is `CreateUniqueRoom` (there is no
create-by-code path), and `join_lobby` answers a miss with "Hittade inget rum med den koden."
(`session/client.go:161-166`). A second instance cannot fabricate a duplicate room. **Never add a
code path that creates a lobby from a client-supplied code**, that property is what keeps a
misrouted player on an error screen instead of in a split-brain room.

**Deploys kill in-flight games.** Restarting drops every lobby. Reconnect does not help here;
surviving a server restart is an explicit non-goal in `docs/design/0001-reconnect.md`.

### If this ever changes

- **Shard by lobby code, not by user.** Standard LB session affinity (sticky cookie, sticky IP)
  pins a _user_ to an instance, but a lobby is shared by 3-12 users who would each be pinned
  independently and scatter across instances. The lobby is the sharding unit, which suits the
  architecture: one lobby is already one goroutine with no cross-lobby state. Consistent hashing
  on the room code, which means the code must be visible to the router (`/ws/game/{code}` rather
  than `/ws/game`).
- **Keep the session token opaque and instance-agnostic** when it is built (issue #19). No node
  id, no shard hint. A stateless token stays valid across any topology; one that encodes placement
  turns every future scaling decision into a token-format migration.
- **The signing secret must be identical on every instance**, that is what lets any instance
  verify any other's token. Per-instance secrets would silently hand reconnecting players new
  identities.
- **Do not externalise lobby state to Redis to get there.** It is the textbook answer and it
  dissolves invariant #1, which is what makes the current code safe without locks.

## Code map

### Server (`server/`)

Entry point `main.go` (Gin router, port 8080). Routes:

| Method | Path                 | Purpose                                                     |
| ------ | -------------------- | ----------------------------------------------------------- |
| `GET`  | `/api/status`        | Health check                                                |
| `POST` | `/api/game/username` | Generate a random Swedish display name for a connected user |
| `POST` | `/api/log`           | Batched browser logs → `logs/client.log`                    |
| `GET`  | `/ws/game`           | WebSocket upgrade; creates a `Client`, registers it in hub  |

Key types:

- `session.GameHub`: owns all connected clients and the lobby registry.
- `session.GameLobby`: one room. Register/unregister/chat/settings/game channels; owns the active
  `Game` and the player roster (`Users map[uuid.UUID]*UserProfile`).
- `session.Client`: one WebSocket connection, with `ReadPump` (inbound events, rate limited to
  30 msg/s) and `WritePump` (outbound, ping every 20 s, pong deadline 40 s).
- `game.Game`: the interface every mode implements: `Run`, `HandleInput`, `Stop`, `PlayerLeft`,
  `IsPlayerActive`, `StartTime`, `EndTime`.
- `game.GameBase`: embed it to get `HandleInput`, `Stop`, `PlayerLeft`, `Broadcast`, `Send`,
  `StartPhase` for free, leaving only `Run` to write.
- `game.Phase[T]`: linked-list phase chain; modes loop by relinking `Next` (see `phase.go`).
- `words.Dictionary`: in-memory vectors loaded from the binary wordfiles (`words/readbinary.go`),
  plus `Targets` and `LemmaMap`. `Lookup` and `Resolve` are the entry points.
- `util.CosineDistance`: the similarity primitive, returns `[0, 2]` where 0 is identical.

### Frontend (`frontend/src/`)

Provider chain from `routes/__root.tsx` down: `WebSocketProvider` → `UserProvider` →
`LobbyContextProvider` → `GameContextProvider`. The WS provider is a pub/sub transport only:
child contexts call `subscribe(eventType, cb)` rather than reading socket state, which keeps
re-renders local. Each hook domain is `src/hooks/<domain>/Hook.tsx` plus `types.ts`.

### Preprocessing (`preprocessing/`)

Nine ordered stages producing the Go server's wordfiles. Wikipedia2Vec (`svwiki-w2v-300d`, 300
dims) trained on Swedish Wikipedia places words and named entities in one vector space, so entity
vectors come straight from the model and the nearest words per entity seed the vocabulary. General
vocabulary comes from Korp frequency data + the Kelly list + spaCy POS filtering
(`NOUN, PROPN, VERB, ADJ`). Stage-to-stage state passes through `intermediate/` (git-ignored).

Data sources: Kelly XML word list, Korp frequency CSVs with stopword filtering, Wikidata SPARQL
entity seeds, Swedish Wikipedia summaries, and Maktbarometern influencer lists (scraped by the Go
crawler at `preprocessing/seeding/maktbarometern/colly-crawler/`).

Output consumed by the Go backend:

| File                              | Contents                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `server/wordfiles/vocab.bin`      | Raw float32 vectors, little-endian (no CSV parsing at startup)                                      |
| `server/wordfiles/vocab.json`     | Word list, index-aligned with `vocab.bin`                                                           |
| `server/wordfiles/meta.json`      | `{n, dims}`                                                                                         |
| `server/wordfiles/targets.json`   | Curated targets with `notability_score`, `sim_at_rank`, `antihive_threshold`, `impostor_candidates` |
| `server/wordfiles/lemma_map.json` | Surface form → canonical lemma ("bilar" → "bil")                                                    |
| `server/wordfiles/sources.json`   | Provenance per word                                                                                 |

## Game modes

All four are Swedish word modes scored by cosine distance over the same vectors. Lobby limits are
3–12 players (`MIN_NUM_PLAYERS_TO_START_GAME`, `MAXIMUM_LOBBY_SIZE`). Full settings tables with
min/max ranges are in `server/README.md`.

**Hitta Impostern (`impostor`)** — implemented. Normal players get a secret word; impostors get a
semantically similar but different word drawn from that target's `impostor_candidates`. Phase
chain: show_word (8 s) → input (turn-based, one player at a time) → discussion → vote →
intermediate (5 s) → loop or result. Players vote someone out each cycle; impostors win when
`impostors >= normals`, normals win when all impostors are gone. Settings: impostor count 1–4,
input 10–60 s (default 30), discussion 30–150 s (default 45), vote 10–60 s (default 30).

**Anti-matchning (`anti_match`)** — implemented. Every player submits a word related to the target.
Exact duplicates all score 0. Unique words score `max(0, 100 − cosine_distance × 100)`. A new
target is picked each round; the round ends early once everyone has submitted. Settings: input
10–60 s (default 20), rounds 1–5 (default 3).

**Kontext Strid (`contexto_battle`)** — settings only, `Run` not implemented. Competitive Contexto:
players guess continuously to approach a hidden target; closest last guess when the timer expires
wins the round. Settings: word type (Vanliga/Kreativa), round 60–600 s, rounds 1–5.

**Synonym Duell (`synonym_duel`)** — settings only, `Run` not implemented. Each round everyone
submits a synonym for the target; the submission semantically _furthest_ from it is eliminated.
Last player standing wins. Settings: word type (Vanliga/Kreativa), round 10–60 s, rounds 1–5.

## NLP and language constraints

- Swedish-first throughout: game content, dictionary, and every user-facing string.
- Distance is cosine over Wikipedia2Vec 300-dim vectors (`util.CosineDistance`, range `[0, 2]`).
- Word submissions resolve through `LemmaMap` (surface form → lemma) before dictionary lookup, so
  "bilar" and "bil" hit the same entry.
- Anti-Match validation is meant to use the per-target `AntiHiveThreshold` from `targets.json`,
  falling back to `0.5` when a target was never enriched by stage 9. **It is currently loaded but
  never applied**, see the gaps below and `docs/decisions/anti-match-tuning.md`.
- Target selection is weighted by `notability_score` (`words.WeightedPickTarget`), so recognisable
  words come up more often.

## Conventions

**Go.** Package-level doc comments on every package; exported symbols get a comment explaining the
_why_, including which goroutine owns them and what happens on the failure path. Existing comments
are unusually thorough, match that density. All user-facing strings (errors, messages) are in
Swedish. Internal logs are in English via the domain loggers (`logging.Hub`, `.Lobby`, `.Game`).

**TypeScript/React.** See `frontend/CLAUDE.md` for the full rules. Highlights: TanStack Router
only (never `react-router-dom` or `next/navigation`), no `"use client"`, Tailwind v4 without a
config file, `cn()` for conditional classes, Prettier with **no semicolons** and `printWidth: 250`.

## How to deliver code changes

These two rules apply to **every** response where code or implementation is involved, including
answers to "how do I…" questions. They exist so the developer stays the one designing the code.

**1. Plan before code, with trade-offs.** State the approach first: what changes, which files, in
what order, plus the pros and cons of that approach against at least one alternative. For small,
local changes a two or three line plan is enough. For anything large (new game mode, new WS event,
touching the goroutine topology, refactors across directories) the plan is mandatory and must call
out which architecture invariants above it interacts with. Wait for agreement before implementing.

**2. Pseudocode, not full code.** Show structure, not a finished patch to accept blindly. Give
signatures, control flow, channel and phase wiring, struct fields, and the tricky lines verbatim
(a cosine comparison, a `select` with its `default`, an exact `EventType` string) — but leave the
routine body work as prose or `// ...` for the developer to write. Exceptions, only when asked
explicitly: the developer says "write it" / "apply it", or the change is mechanical (rename,
formatting, moving a block, a config value).

## Current repo state (read before touching git)

- Working branch is `vite+react-port`. Main branch is `main`.
- The old Next.js client at `client/` has been **deleted on disk but the deletions are unstaged**,
  and `frontend/` is **untracked**. Do not stage or commit these unless asked, and if asked,
  review what `git add` picks up first (the tree also has unstaged edits across `preprocessing/`).
- Known dead code: `server/test.go` (fully commented out), commented blocks in `server/main.go`.

## Known gaps worth knowing before you start

Full list in `docs/notes/architecture-review.md`; each is tracked as an issue. The ones most likely
to bite:

1. **No reconnect.** A browser refresh creates a new `UserId` and drops the player from their
   lobby; mid-game this eliminates them. Design in `docs/design/0001-reconnect.md` (issue #17).
2. **Data races on `Client` fields.** `client.Lobby` and `client.Profile` are written from up to
   three goroutines without synchronisation. Run with `-race` before trusting concurrency changes.
   Fixed as part of the seat model, not separately (issue #18).
3. **`AntiMatchGame` ignores `playerLeft`**: the channel case is commented out, so a mid-game
   disconnect leaves a slot that blocks the early-advance check (issue #22).
4. **`CheckOrigin` returns `true`** for all WebSocket origins (`server/handlers/websocket.go`).
   Must be restricted before production (issue #24).
5. **Anti-Match never applies `matchThreshold()`**: the per-target "too random" cutoff is loaded
   from `targets.json` but unused in scoring. See `docs/decisions/anti-match-tuning.md` §2
   (issue #26).
