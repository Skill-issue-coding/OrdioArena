> **Status:** Started · **Tracking:** milestone S0, issues [#50–#54](https://github.com/Skill-issue-coding/OrdioArena/milestone/5) · **Updated:** 2026-08-28
>
> Stage spec: what get built, why shaped that way. Done-or-not answered by milestone.
> Architecture rationale: [0003-rewrite-architecture.md](0003-rewrite-architecture.md).

---

# S0 · Skeleton, tooling, CI

**Goal:** two apps that build, test, lint, containerise. Nothing game-specific yet.

**Exit:** `docker compose up` give three healthy instances behind one proxy. CI green on pull
request.

## Why this comes first

Two things cheap now, expensive later. Whole reason to spend stage on scaffolding:

**`Clock` interface.** Phase deadlines land S6, modes S7. If timers touch `time` package direct,
every phase test become `time.Sleep`, suite slow and flaky forever. Retrofit = rewrite every test
existing by then.

**Three instances locally.** Cluster bug that only show with >1 instance worthless to find in prod.
Compose stack exist before any cluster code, so S2 have landing spot.

## Directory layout

```text
backend-v2/
  cmd/server/main.go           wiring only: config → deps → router → serve → drain
  internal/
    config/                    env load, validate, freeze
    clock/                     Clock interface, real + fake
    logging/                   root logger, attribute keys, redaction
    httpx/                     router, middleware, /api/status
    cluster/                   HRW ownership, peer list          (S2)
    protocol/                  envelope, events, payloads        (S1)
    token/                     session token mint/verify         (S3)
    session/                   hub, lobby, seats, connections     (S4, S5)
    game/                      engine, phases, registry          (S6)
      antimatch/                                                 (S7)
      impostor/                                                  (S9)
    words/                     dictionary, vectors, targets      (S6)
  go.mod
  README.md
```

All under `internal/`. Nothing here is library for outside consumers, and `internal/` make that
compiler guarantee, not convention. `cmd/server/main.go` do wiring, nothing else, logic there is
untestable by construction.

Empty packages created this stage with one doc comment each, stating which goroutine own state
inside. That comment is contract later stages fill.

## What gets built

### Config

```go
type Config struct {
    InstanceID    string
    PublicWSURL   string
    ClusterPeers  []Peer
    SessionSecret []byte
    OriginAllow   []string
    ListenAddr    string
    LogLevel      slog.Level
}

func Load() (Config, error)   // read env, validate, return immutable value
```

Load once at boot, validate, pass by value. Nothing read `os.Getenv` after `main`.
Missing or malformed required var fail startup with message naming the variable. Silent defaulting
is how three-instance cluster end up with three different configs.

### Logging

`log/slog`, one structured stream. Level and format from config: JSON in prod, text in dev.
`internal/logging` build it.

Replaces per-domain file loggers and `LOG_TO_FILE` plumbing. `domain` attribute give same filtering
as four files without four files. Four files also die multi-instance: three instances × four domains
= twelve files nobody tail.

**Package construct loggers, not wrap `slog`.** `New` return `*slog.Logger`, that type pass around.
Wrapping behind local type cost `slog.Handler` composition, `slog.LogValuer`, context propagation,
every third-party handler, for nothing. `*slog.Logger` already is shared interface.

**No package-level logger.** Old backend used `logging.Hub` / `.Lobby` / `.Game` singletons behind
`sync.Once`. Shape right, real `*slog.Logger` values, not wrappers, but lifetime wrong. Globals
carry no per-lobby context, so every call site re-pass room code by hand until someone forget on the
one line that mattered. Tests also cannot capture output independently or run parallel. Inject root
logger through deps struct, same as `Clock`, tag once where owning goroutine created:

```go
l := logging.WithDomain(root, logging.DomainLobby).With(logging.KeyLobbyCode, code)
```

**Attribute keys are constants.** Practical reason package exist. Many instances ship into one
aggregate; concept spelled `lobby_code` one file and `lobbyCode` another silently split every query,
and compiler catch nothing.

**Redaction structural, not rule.** S3 require no token value reach log line, and session secret
appear only as fingerprint. `logging.Redacted` implement `slog.LogValuer` and `fmt.Stringer`, so
wrapped value cannot leak even when logged by accident, impossible beat forbidden.
`logging.Fingerprint` give S3 boot check its comparable, non-disclosing value.

**Log at boundary, return errors from inside.** Deep helpers return wrapped errors; goroutine owning
state log them. Never log _and_ return, that put one failure twice in aggregate with no way to tell
it was one event. `config` return errors, `main` log them.

### Clock

```go
type Clock interface {
    Now() time.Time
    NewTimer(d time.Duration) Timer
    After(d time.Duration) <-chan time.Time
}

type Timer interface {
    C() <-chan time.Time
    Stop() bool
    Reset(d time.Duration) bool
}
```

Real impl wrap `time`. Fake impl hold virtual now plus heap of pending timers; `Advance(d)` fire
everything due, in order. Fake must be safe to call from test goroutine while code under test run —
that is exactly how phase test work.

Injected through deps struct. Never package global: global clock cannot differ in two parallel tests.

### Router and status

`chi` over Gin: four routes need no framework, and stdlib-shaped `http.Handler` values keep S4
WebSocket upgrade simple.

`GET /api/status` return instance id, build revision, uptime, and (once S2 land) lobby count.
Compose healthcheck and proxy poll it.

### Graceful shutdown

`SIGTERM` → stop accepting new connections → `http.Server.Shutdown(ctx)` → cancel root context so
lobby goroutines drain → exit. Order matter: cancel root context first would kill lobbies while
requests still arriving.

### CI

One workflow, two parallel jobs.

- Go: `go vet`, `golangci-lint run`, `go build ./...`, `go test -race ./...`
- Web: `tsc --noEmit`, `eslint`, `prettier --check`, `npm run build`

`-race` in pipeline from first commit, not added once something exist to test. Concurrency bugs in
this architecture surface only under real multiplayer load, and race detector is only cheap way to
catch them.

### Containers

Multi-stage Dockerfile, non-root user, minimal runtime base. `wordfiles/` mounted, not baked, so
image not carry Git LFS blob.

`docker-compose.yml` bring up three instances behind one proxy. Each get own `INSTANCE_ID`; all
three share one `SESSION_KEYS` and `SESSION_KEY_CURRENT`, and one identical `CLUSTER_PEERS`.

## Decisions taken in this stage

| Decision                                | Rationale                                                |
| --------------------------------------- | -------------------------------------------------------- |
| `internal/` rather than flat packages   | Import boundary enforced by compiler                     |
| `chi` rather than Gin                   | Four routes; stdlib handlers simplify WS upgrade         |
| `log/slog` rather than per-domain files | Same filtering via attributes, no `LOG_TO_FILE` plumbing |
| `Clock` injected, never global          | Parallel tests need independent clocks                   |
| Config immutable after `Load`           | Cluster with drifting config undebuggable                |
| Three instances in local compose        | Cluster bugs must repro before S2 write cluster code     |
| Caddy as the compose proxy              | `handle_path` strips `/i/inst-N` in three lines          |
| Alpine runtime, not distroless          | Compose healthcheck needs an HTTP client in the image    |
| `APP_ENV=dev` in compose                | Prod demand `wss://` and `https` origins, no local certs |
| Proxy bound to `127.0.0.1`              | `8080:8080` publish the dev stack to the whole LAN       |
| `run() error` with thin `main`          | `os.Exit` skip defers; one exit point, real exit status  |
| `net.Listen` before `Serve`             | Bind failure surface synchronously, not inside goroutine |

## Issues

| Issue                                                             | Title                                                    |
| ----------------------------------------------------------------- | -------------------------------------------------------- |
| [#50](https://github.com/Skill-issue-coding/OrdioArena/issues/50) | Go skeleton: chi router, slog, config, graceful shutdown |
| [#51](https://github.com/Skill-issue-coding/OrdioArena/issues/51) | Clock interface with real and fake implementations       |
| [#52](https://github.com/Skill-issue-coding/OrdioArena/issues/52) | Vite + React 19 + TanStack Router + Tailwind v4 scaffold |
| [#53](https://github.com/Skill-issue-coding/OrdioArena/issues/53) | CI pipeline: vet, lint, test -race, typecheck, builds    |
| [#54](https://github.com/Skill-issue-coding/OrdioArena/issues/54) | Dockerfiles and 3-instance compose stack behind a proxy  |

## Open questions

- ~~**Which proxy in compose?**~~ Caddy. `handle_path` strip the `/i/inst-N` prefix in three lines,
  which is the addressing scheme S2 need. S8 deploy the same thing, so the local stack is not fiction.
- ~~**Runtime base image.**~~ Alpine. Distroless is smaller and has no shell, but also no HTTP client,
  so the compose healthcheck would have to move into the server binary as a subcommand, which put
  logic in `main`. Revisit if image size ever matter.
- ~~**Go version floor.**~~ `go 1.27`. Note the cost: golangci-lint's released binaries are built with
  an older Go and refuse to lint a newer target, so `.golangci.yml` pin the language version until a
  release catch up. Expect this on every toolchain bump.
- **Container builds report `revision: "unknown"`.** Build context is `backend-v2/`, not the repo
  root, because the root carry the ~3-4 GB Wikipedia2Vec model and the LFS wordfiles. No `.git` in
  the context means the toolchain stamp nothing. Fix when wanted: a package var in `httpx` set by
  `-ldflags -X` from a `VCS_REF` build arg.
- **Config's own logging.** `config.Load` run before logger exist, since level and format come from
  config. So it return provenance as data and let `main` log it, instead of taking bootstrap logger.
  See note in `internal/config`.
