# backend-v2

The OrdioArena backend, rewritten. Go 1.27, `net/http` + `chi`, `log/slog`, no framework beyond
that. The old backend at `../server/` still runs and stays readable until the S8 cutover deletes it;
nothing here imports it, and nothing there is a precedent worth copying except the parts this
document explicitly names.

`go.mod` declares `github.com/Skill-issue-coding/OrdioArena/backend` while the directory is
`backend-v2/`. Deliberate: S8 renames the directory, and the final module path being already in
place means that rename touches zero import lines.

Stage plan in [`../docs/roadmap.md`](../docs/roadmap.md); the _why_ behind the architecture in
[`../docs/design/0003-rewrite-architecture.md`](../docs/design/0003-rewrite-architecture.md); one
spec per stage in `../docs/design/S0-*.md` … `S10-*.md`. **Read the stage spec before picking up an
issue in that milestone.** Whether a stage is done is answered by its GitHub milestone, never by a
document.

---

## 1. How to work in this directory

This section outranks everything else in this file. It is not a style preference; it is what the
directory is for.

**The developer is learning this codebase by building it. Claude's job is to make the design legible,
not to produce the code.** A correct patch that the developer accepts without understanding is a
failure here, even when it compiles, even when it is what was asked for.

### Pseudocode only

Answer with **signatures, struct fields, control flow, channel wiring, and the handful of lines that
are genuinely tricky, verbatim**. Everything else is prose or `// ...`.

Give verbatim:

- exact `EventType` string constants and JSON tags, a typo here fails silently at runtime
- a `select` with its `default` branch, because the drop is the point
- a cosine comparison, a `hmac.Equal` call, a constant-time check
- the order of operations in a shutdown or a lock acquisition
- anything where getting it subtly wrong produces a race rather than an error

Leave as prose or `// ...`:

- loop bodies, field copying, error wrapping, JSON marshalling
- anything a competent Go developer writes the same way every time

**Exceptions, only when asked explicitly:** the developer says "write it" / "apply it", or the change
is mechanical, a rename, a formatting fix, moving a block, a config value.

### Every answer carries its reasoning

State the approach before any code: what changes, which files, in what order. Then **the trade-off
against at least one alternative that was rejected, and why**. An answer that presents one option as
if it were the only option teaches nothing.

Name which of the three invariants (§4) the change touches. If it touches none, say so, that is
information too.

### Answer "where does this live" with the rule, not the path

When asked where something belongs, give the ownership rule that decides it, then the path that
follows from it. "In `internal/httpx`" is an answer the developer cannot generalise. "Handlers own no
state, so anything that needs lobby state asks over a channel, which puts the handler in `httpx` and
the state in `session`" is one they can apply to the next case without asking.

### Surface disagreement, do not silently fix

Code in this directory that looks wrong usually is, and usually for a reason worth knowing. Say what
is wrong, why it is wrong, and what the fix is, then let the developer make it. Do not fold a
correction into an unrelated answer.

### Do not skip ahead

Each stage's exit criteria are the next stage's assumptions. Do not build S2 abstractions into S0
code "so it's ready". A `Deps` field for a hub that does not exist, an error helper with no caller, a
config variable nothing reads, each one is a guess at a shape that the stage itself would have
taught. Leave a `// S2 #61:` comment where the seam goes and stop there.

---

## 2. What exists right now

| Package            | State                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `internal/config`  | Complete, tested. Load, validate, freeze.                                                                                                                                                               |
| `internal/logging` | Complete. Root logger, attr keys, redaction, and the context carriers `Into` / `From` / `FromOr`. Tested except the carriers.                                                                           |
| `internal/clock`   | Complete, tested. Real + fake.                                                                                                                                                                          |
| `internal/httpx`   | **Complete for S0, untested.** `Router`, `requestLogger`, `recoverer`, `levelFor`, `writeJSON` / `writeError`, `Revision`, `Deps` / `NewDeps`, and `GET /api/status`. `lobby.go` and `ws.go` are empty. |
| `cmd/server`       | Complete for S0. `run() error` with a thin `main`, explicit `net.Listen`, signal handling, graceful drain. The root-context cancel is marked but not built, it has nothing to cancel until S4.          |
| `internal/cluster` | `PeerID` and `Peer` only. They exist ahead of S2 because `config` parses the peer list.                                                                                                                 |
| `internal/token`   | `Key` and `Keyset` only. Same reason: `config` parses `SESSION_KEYS`.                                                                                                                                   |
| everything else    | `doc.go` only, the package's contract, no behaviour.                                                                                                                                                    |

S0 is not closed. Still missing: tests in `httpx`, a Dockerfile and a compose file running three
instances behind a proxy, CI (#53), and the `web/` scaffold. The compose file is the exit criterion,
and it is also the first thing that runs `CLUSTER_PEERS` with three real instance ids.

Those `doc.go` files are not placeholders. Each states what the package owns and which goroutine owns
it, and that statement is the contract the stage fills in. **Read the `doc.go` of a package before
touching it, and treat a contradiction between the code and the doc comment as a bug in the code**
until the developer says otherwise.

---

## 3. Package map

Everything is under `internal/`: nothing here is a library for outside consumers, and `internal/`
makes that a compiler guarantee rather than a convention.

```text
cmd/server/          wiring only, config → deps → router → serve → drain
internal/
  config/            env load, validate, freeze                    S0  #50
  clock/             Clock interface, real + fake                  S0  #51
  logging/           root logger, attribute keys, redaction        S0  #50
  httpx/             router, middleware, handlers                  S0  #50
  protocol/          envelope, events, payloads, TS codegen        S1  #55–#58
  cluster/           HRW ownership, peer list, routing             S2  #59–#63
  token/             session token mint/verify                     S3  #64–#66
  session/           hub, lobbies, seats, connections              S4  #67–#80
  game/              engine, phase chain, mode registry            S6  #81–#86
    antimatch/       Anti-matchning                                S7  #87–#93
    impostor/        Hitta Impostern                               S9  #98–#102
  words/             dictionary, vectors, targets                  S6  #85
```

`cmd/server/main.go` does wiring and nothing else. Logic placed there is untestable by construction,
which is the whole reason the rule exists.

### Who owns what state

| Package            | Owning goroutine                               | Notes                                                                                    |
| ------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `config`           | none, immutable value                          | Loaded once, passed by value. Nothing outside reads `os.Getenv`.                         |
| `logging`, `clock` | none, injected values                          | Never package globals.                                                                   |
| `httpx`            | one goroutine per request, owned by `net/http` | Handlers own **no** lobby or game state.                                                 |
| `words`            | none, read-only after load                     | Shared across every lobby with no synchronisation. Adding a mutating method breaks that. |
| `cluster`          | none, pure function of the peer list           | Ownership is computed, never stored.                                                     |
| `session`          | `Hub.Run`, then one `Lobby.Run` per room       | The only writers of their state.                                                         |
| `game`             | `Game.Run`                                     | The only reader _and_ writer of game state.                                              |

---

## 4. The three invariants

Breaking one produces races that appear only under real multiplayer load, which is the worst possible
time to find them.

**1 · Single-goroutine state ownership.**

```text
readPump ─┐                                        ┌─▶ Game.Run
          ├─▶ Conn ──▶ Hub.Run ──▶ Lobby.Run ──────┤   (owns game state)
writePump ┘            (owns       (owns ALL
                        conns)      lobby state)
```

Never mutate lobby or game state from a timer callback, an HTTP handler, or a spawned helper. Send on
a channel and handle it inside the owning `select`. A grace timer firing does not touch the lobby; it
sends, and `Lobby.Run` decides.

**2 · Non-blocking cross-goroutine sends.** Every send uses `select` with a `default` that drops —
and _counts_ the drop, because a silent drop is invisible:

```go
select {
case ch <- ev:
default:
    // dropped: log at Debug with logging.KeyDropped, increment the counter.
    // One slow client must never stall a lobby or a game.
}
```

**3 · No lobby is ever created from a client-supplied code.** The only creator is `POST /api/lobby`,
which mints its own code. An instance receiving a socket for a code it does not own answers `421
Misdirected Request` and closes. This is what makes a routing bug an error screen instead of a
split-brain room, and it is why the entire route surface is declared in one function in
`httpx/router.go`, an invariant nobody can see the whole of is an invariant nobody can check.

---

## 5. Cross-cutting rules

### Dependency injection, never package globals

`Clock`, `*slog.Logger` and `Config` are constructed in `main` and passed down through a `Deps`
struct. The old backend used `logging.Hub` / `.Lobby` / `.Game` singletons behind `sync.Once`; the
shape was right, real `*slog.Logger` values, not wrappers, but the lifetime was wrong. A global
carries no per-lobby context, so every call site re-passes the room code by hand until someone
forgets on the one line that mattered. Globals also make parallel tests impossible: two tests cannot
hold two different clocks.

### Config

`config.Load()` runs once, in `main`, before anything else. It returns `(Config, Source, error)`.

Three things to understand about it, because they are the pattern the rest of the backend follows:

- **Validation collects, it does not short-circuit.** One bad configuration comes back as a single
  `*ValidationError` listing every problem. Fixing one variable per redeploy across a three-instance
  stack is the worst available loop.
- **`Source` is provenance as data, not a log line.** `Load` runs before the logger exists, because
  the logger's level and format are themselves things `Load` returns. So it hands back which keys came
  from where and lets `main` log it. `Source` holds **keys only, never values.**
- **Defaults apply only when `APP_ENV=dev`.** In production a missing `INSTANCE_ID` fails the boot
  instead of quietly becoming `local`. Silent defaulting is how three instances end up with three
  different configurations and nobody notices until players scatter.

`SESSION_KEYS` and `SESSION_KEY_CURRENT` have no default in any environment and no generate-at-boot
fallback. A generated secret works perfectly on one instance and breaks reconnect on N, presenting as
"reconnect is broken" rather than "configuration is wrong".

| Variable              | Required     | Notes                                               |
| --------------------- | ------------ | --------------------------------------------------- |
| `APP_ENV`             | no (`prod`)  | `dev` unlocks the defaults below                    |
| `INSTANCE_ID`         | prod only    | must appear exactly once in `CLUSTER_PEERS`         |
| `CLUSTER_PEERS`       | prod only    | `id=url,…`; includes **this** instance              |
| `SESSION_KEYS`        | **always**   | `id=base64,…`; ≥32 bytes, no placeholders           |
| `SESSION_KEY_CURRENT` | **always**   | names the signing key; the rest still verify        |
| `ORIGIN_ALLOW`        | prod only    | exact match, no wildcards; `https` enforced in prod |
| `LISTEN_ADDR`         | no (`:8080`) | numeric port only                                   |
| `LOG_LEVEL`           | no           | `debug` in dev, `info` in prod                      |
| `LOG_FORMAT`          | no           | `text` in dev, `json` in prod                       |

> Two of these have already drifted from the roadmap text, which is older. `PUBLIC_WS_URL` does not
> exist: the peer list includes this instance, so `cfg.Self()` derives it. `SESSION_SECRET` became a
> keyset so the signing key can rotate without invalidating live sessions. **The code is the
> authority; when a doc disagrees, fix the doc.**

### Logging

One structured stream, `log/slog`. The `domain` attribute replaces the old backend's four log files,
which do not survive multi-instance anyway, three instances times four domains is twelve files
nobody tails.

- `logging.New` returns a plain `*slog.Logger`. It is not wrapped in a local type: wrapping costs
  `slog.Handler` composition, `slog.LogValuer`, context propagation and every third-party handler, in
  exchange for nothing. `*slog.Logger` already is the shared interface.
- **Attribute keys are constants** (`logging.KeyLobbyCode`, …). A concept spelled `lobby_code` in one
  file and `lobbyCode` in another splits every query in the aggregate, and the compiler catches
  nothing.
- **Tag once, where the owning goroutine is created**, not at every call site:
  `logging.WithDomain(root, logging.DomainLobby).With(logging.KeyLobbyCode, code)`.
- **Redaction is structural.** `logging.Redacted` implements both `slog.LogValuer` and
  `fmt.Stringer`, so a wrapped value cannot leak even when logged by accident. Impossible beats
  forbidden. `logging.Fingerprint` gives a comparable, non-disclosing value for boot checks.
- **Never log a URL query string.** S3 puts tokens on the wire. A logger that only ever knew
  `r.URL.Path` cannot leak one.
- **Log at the boundary, return errors from inside.** Deep helpers wrap and return; the goroutine that
  owns the state logs. Never log _and_ return, that puts one failure in the aggregate twice with no
  way to tell it was one event.

### Clock

Nothing calls `time.Now`, `time.After` or `time.NewTimer` outside `internal/clock`. Everything takes a
`clock.Clock`. This was decided in S0 rather than S6 because retrofitting it means rewriting every
test that exists by then.

`clock.Fake` holds a virtual now plus pending timers; `Advance(d)` fires everything due, in order, and
is safe to call from the test goroutine while the code under test runs. Two things the fake's `doc.go`
warns about, worth repeating because they are the two ways tests go wrong:

- **Advance in steps, not one jump.** `Advance(8s)` then `Advance(30s)`, not `Advance(38s)`, a single
  large jump can skip a timer that a handler registers partway through.
- **`Advance` synchronises delivery, not handling.** Assert on what was received, not on state a
  handler sets after receiving. Use `AdvanceNoWait` when the mid-flight state is the thing being
  tested.

### Errors

Wrap with `%w` and return; let the owner log. Operator-facing messages name the variable or the file
that is wrong, the reader is someone at a terminal at an unpleasant hour, not the author.

---

## 6. Testing

```bash
go build ./...
go vet ./...
go test -race ./...     # -race is mandatory, not optional
gofmt -l .              # must print nothing
```

- **`-race` from the first commit**, not added once there is something to test. Concurrency bugs in
  this architecture surface only under real load, and the race detector is the only cheap way to find
  them.
- **No `time.Sleep` in any test, ever.** That is what `clock.Fake` is for. A sleeping test is either
  slow or flaky, and usually becomes both.
- **Tests call the injectable seam, not the environment.** `config` tests call `loadFrom` with a map,
  never `t.Setenv`, so they are `t.Parallel()`-safe. Follow that shape: if something is hard to test
  without a global, the global is the bug.
- Table-driven where the cases are data. Name the case after the behaviour, not the input.

---

## 7. Conventions

- **Package doc comment on every package**, stating what it owns and which goroutine owns it.
- **Exported symbols get a comment explaining the _why_**, including the failure path. The existing
  comment density in this directory is unusually high and deliberate, match it. A comment that
  restates the signature is worse than none.
- **All user-facing strings are Swedish.** Errors that reach a player, lobby messages, everything the
  browser renders. `"Hittade inget rum med den koden."`
- **All logs and internal errors are English.**
- Standard Go naming; receivers are one or two letters. `String()` for `fmt.Stringer`, not `ToString()`.
- `gofmt` clean, `golangci-lint` clean. Deprecated symbols are build failures once CI lands (#53), so
  do not reach for `middleware.RealIP` and friends.

---

## 8. Traps

Things that look reasonable and are not:

- **`maphash` for lobby ownership.** Its seed is per-process by design, so three instances would
  compute three different owners. Ownership hashing must be stable across processes.
- **`==` on signatures.** `hmac.Equal`, always. Timing is an oracle.
- **Prefix matching on origins.** `"https://ordio.example"` as a prefix admits
  `"https://ordio.example.evil.com"`. `config.canonicalOrigin` normalises to the exact shape a browser
  sends so the upgrade guard can compare with `==`.
- **Externalising lobby state to Redis to get multi-instance.** It is the textbook answer, and it
  dissolves invariant 1, which is precisely what makes this code safe without locks. Ownership is
  computed from the code instead.
- **Encoding anything instance-specific into a session token.** No node id, no shard hint. A stateless
  token survives any future topology; one that encodes placement turns every scaling decision into a
  token-format migration.
- **A status field that is always zero.** Do not stub `"lobbies": 0` into `/api/status` before S2. A
  field that is constant across every row looks like data and is not.
- **Wrapping the `ResponseWriter` on the WebSocket route.** The upgrade needs the real one. Keep
  request-logging middleware scoped to `/api`.

---

## 9. Out of scope, permanently

Not oversights, decisions, recorded in `../docs/roadmap.md`:

- **Lobbies surviving a restart.** Deploys and crashes kill in-flight games. Making state
  serialisable constrains every type in the system for a benefit visible only during a deploy.
- **Cross-device session transfer.** Reconnect covers the same device: refresh, tab reopen, network
  drop.
- **Accounts and logins.** The zero-friction path _is_ the product. Identity is assigned by the server
  on connect and proved afterwards by a token.
