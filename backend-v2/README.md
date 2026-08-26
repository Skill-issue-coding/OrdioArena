# backend-v2

The OrdioArena game backend, rewritten. **Scaffold only**, package layout and doc comments, no
behaviour yet. The current stage is S0 ([issues #50–#54](https://github.com/Skill-issue-coding/OrdioArena/milestone/5)).

The old backend is still at `../server/` and still runs. It stays there, readable, until the S8
cutover deletes it.

## Read before writing code here

| Document                                                                                     | Why                                                 |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [`../docs/roadmap.md`](../docs/roadmap.md)                                                   | The eleven stages and what each one must prove      |
| [`../docs/design/0003-rewrite-architecture.md`](../docs/design/0003-rewrite-architecture.md) | Locked decisions and the rejected alternatives      |
| [`../docs/design/S0-skeleton-tooling-ci.md`](../docs/design/S0-skeleton-tooling-ci.md)       | This stage: layout, `Clock`, config, CI, containers |

Every package here already has a doc comment stating what it owns and which goroutine owns it.
Those comments are the contract each stage fills in, read the one for the package you are about to
touch before touching it.

## Layout

```text
cmd/server/          wiring only: config → deps → router → serve → drain
internal/
  config/            env load, validate, freeze              S0  #50
  clock/             Clock interface, real + fake            S0  #51
  logging/           root logger, attr keys, redaction       S0  #50
  httpx/             router, middleware, /api/status         S0  #50
  protocol/          envelope, events, payloads, codegen     S1  #55-#58
  cluster/           HRW ownership, peer list, routing       S2  #59-#63
  token/             session token mint/verify               S3  #64-#66
  session/           hub, lobby, seats, connections          S4  #67-#80
  game/              engine, phases, mode registry           S6  #81-#86
    antimatch/       Anti-matchning                          S7  #87-#93
    impostor/        Hitta Impostern                         S9  #98-#102
  words/             dictionary, vectors, targets            S6  #85
```

Everything is under `internal/`. Nothing here is a library for outside consumers, and `internal/`
makes that a compiler guarantee rather than a convention.

## The module path does not match the directory

`go.mod` declares `github.com/Skill-issue-coding/OrdioArena/backend`, but the directory is
`backend-v2/`. That is deliberate: S8 renames the directory to `backend/`
([#94](https://github.com/Skill-issue-coding/OrdioArena/issues/94)), and declaring the final module
path now means the rename touches zero import lines.

## The three invariants

Everything in the architecture rests on these. Breaking one produces races that only appear under
real multiplayer load, which is the worst possible time to find them.

**1. Single-goroutine state ownership.** Each layer owns its state in exactly one goroutine and is
reached only through channels. `Lobby.Run` is the only writer of lobby state; `Game.Run` is the only
reader or writer of game state. Never mutate from a timer callback, an HTTP handler or a spawned
helper, send on a channel and handle it in the owning `select`.

**2. Non-blocking sends.** Every cross-goroutine send uses `select` with a `default` that drops and
counts, so one slow client can never stall a lobby or a game. Silent drops are invisible, so they
are counted.

**3. No lobby is ever created from a client-supplied code.** The only creator is `POST /api/lobby`,
which mints its own code. An instance receiving a socket for a code it does not own answers `421`
and closes. This is what makes a routing bug an error screen instead of a split-brain room.

## Running it

```bash
go build ./...
go vet ./...
go test -race ./...     # -race is mandatory, not optional
gofmt -l .              # must print nothing
```

There is nothing to run yet, `cmd/server` is a stub until #50.

## Environment variables

**Local development example:**

_Environment file has to be located at: `backend-v2/.env`_

| Variable Name        | Value                                         | Description                                             |
| -------------------- | --------------------------------------------- | ------------------------------------------------------- |
| **APP_ENV**          | `dev`                                         | Defined environment of the application                  |
| INSTANCE_ID          | `local`                                       | Instance id for each instance                           |
| CLUSTER_PEERS        | `local=ws://localhost:8080`                   | Cluster peers                                           |
| SESSION_KEYS         | `dev1=<SECRET>`                               | Session key to each cluster/peer                        |
|  SESSION_KEY_CURRENT | `dev1`                                        | Session key to the current cluster/peer                 |
| ORIGIN_ALLOW         | `http://localhost:5173,http://localhost:8080` | The allowed origins                                     |
| LISTEN_PORT          | `:8080`                                       | The active listen port                                  |
| LOG_LEVEL            | `debug` \| `info`                             | What level of information should be printed _logs, etc_ |
| LOG_FORMAT           | `text` \| `json`                              | Defines the format of the logging                       |

**Production environment example:**

`docker compose.yaml`

```yaml
x-shared: &shared
  APP_ENV: prod
  CLUSTER_PEERS: <INSTANCE_ID_1>=wss://<URL>/i/<INSTANCE_ID_1>,<INSTANCE_ID_2>=wss://<URL>/i/<INSTANCE_ID_2>,<INSTANCE_ID_3>=wss://<URL>/i/<INSTANCE_ID_3>
  SESSION_KEYS: <KEY>=<SECRET>
  SESSION_KEY_CURRENT: <KEY>
  ORIGIN_ALLOW: <URL>
  LISTEN_ADDR: "<PORT>"
  LOG_LEVEL: info
  LOG_FORMAT: json

services:
  inst-1:
    environment: { <<: *shared, INSTANCE_ID: <INSTANCE_ID_1> }
  inst-2:
    environment: { <<: *shared, INSTANCE_ID: <INSTANCE_ID_2> }
  inst-3:
    environment: { <<: *shared, INSTANCE_ID: <INSTANCE_ID_3> }
```

## Conventions

- Package doc comment on every package, stating what it owns and which goroutine owns it.
- Log through the injected `*slog.Logger`, never a global and never `fmt.Sprintf` into a message.
  Use the `logging.Key*` constants, a field spelled two ways splits every aggregate query.
- Log at the boundary: helpers return wrapped errors, the goroutine that owns the state logs them.
  Never log and return.
- Exported symbols get a comment explaining the _why_, including the failure path. The old backend
  is unusually thorough here; match that density.
- All user-facing strings in Swedish. Internal logs in English, structured, via `log/slog`.
- Anything touching goroutines or timers is checked with `go test -race` before it is trusted.
- Timers go through `clock.Clock`, never the `time` package directly. `grep -rn 'time.After' .`
  should only ever match the real clock implementation.
