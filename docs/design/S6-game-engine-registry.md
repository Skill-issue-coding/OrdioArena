> **Status:** Not started · **Tracking:** milestone S6, issues [#81–#86](https://github.com/Skill-issue-coding/OrdioArena/milestone/11) · **Updated:** 2026-08-24
>
> Stage spec. Architecture rationale: [0003-rewrite-architecture.md](0003-rewrite-architecture.md) §4, §5.

---

# S6 · Game engine and mode registry

**Goal:** add mode = touch one file, zero switch statements.

**Exit:** throwaway test mode run full phase chain on fake clock. Deterministic, no sleeps, race-clean.

## The Game interface

```go
type Game interface {
    Run()
    HandleInput(ev Event)
    Snapshot(playerID uuid.UUID) any   // public + that player's private state
    PlayerLeft(playerID uuid.UUID)
    Stop()
}
```

**`Snapshot` mandatory, not optional.** Mode no merge without it.

This decision = reason rewrite exist. Retrofit resync onto finished modes killed current codebase: modes written first, snapshot reverse-engineered from state never designed to be described. In interface = mode that cannot describe itself no compile.

`Snapshot` called on game goroutine like any event. Never read state concurrently.

## GameBase

Embed it, only `Run` left to write:

```go
type GameBase struct {
    deps    GameDeps      // dict, clock, outputs channel, onDone
    inputs  chan Event
    stop    chan struct{}
}

func (b *GameBase) HandleInput(ev Event)          // non-blocking send onto inputs
func (b *GameBase) Broadcast(t EventType, p any)  // non-blocking, per recipient
func (b *GameBase) Send(id uuid.UUID, t EventType, p any)
func (b *GameBase) StartPhase(...)
func (b *GameBase) Stop()
```

Deps injected at construction, dictionary pointer, outputs channel, clock, `onDone`. Game testable with no lobby, no sockets. Current code do this well. Carries over unchanged.

## Phase chain

```go
type Phase[T any] struct {
    Name     PhaseName
    Duration time.Duration
    OnEnter  func(*T)
    OnInput  func(*T, Event) (advanceEarly bool)
    OnExit   func(*T)
    Next     *Phase[T]
}
```

Modes loop by relinking `Next`. Linked list, walked on game goroutine only. Transitions happen nowhere else.

Each phase carry own deadline + timer, both from injected `Clock`. Stop mid-phase cancels clean. No orphan timers, no leftover goroutine.

## Mode registry

```go
type ModeDef struct {
    ID       ModeID
    Settings SettingsSchema
    New      func(GameDeps) Game
}

var registry = map[ModeID]ModeDef{ ... }
```

Mode selection, settings lookup, settings application, game construction all read from here. Unknown mode id = validation error with Swedish message, never panic.

Test assert every registered mode has schema + constructor. Acceptance check blunt, effective:

```text
grep -rn 'switch.*[Mm]ode' backend-v2/     →  nothing outside the registry
```

Pay cost once, **before** third and fourth modes, not after. Current codebase made that mistake, why `contexto` and `synonym` still unimplemented.

## Server-authoritative timestamps

Every phase event carry `start_time`, `ready_time` (start + 2 s sync delay), `end_time` as Unix milliseconds. All from injected `Clock`.

Clients render countdowns from those. Never decide when phase ends. Submission after `end_time` rejected, whatever client timer showed.

Client estimate clock offset during handshake. Device with wrong system clock still render correct countdown.

## Dictionary

Wordfiles contract unchanged: same six files, same binary layout. `preprocessing/` needs no coordination during rewrite.

- `vocab.bin`, raw little-endian float32 vectors, no CSV parsing at startup
- `vocab.json`, word list, index-aligned with binary
- `meta.json`, `{n, dims}`
- `targets.json`, curated targets with `notability_score`, `sim_at_rank`, `antihive_threshold`,
  `impostor_candidates`
- `lemma_map.json`, surface form → canonical lemma
- `sources.json`, provenance

`Lookup` and `Resolve` = entry points. Submissions resolve through lemma map before dictionary lookup, so "bilar" and "bil" hit same entry. Distance = cosine over 300-dim vectors, range `[0, 2]`, 0 = identical. Target selection weighted by `notability_score`, recognisable words come up more.

Startup fail loud, name missing file. Backend cannot function without these.

**Dictionary read-only after load.** Shared across every lobby, no synchronisation. Document that at type, only large shared structure in system, someone will eventually want to mutate it.

## Decisions taken in this stage

| Decision                            | Rationale                                                |
| ----------------------------------- | -------------------------------------------------------- |
| `Snapshot` mandatory on interface   | Mode that cannot describe itself no compile              |
| Registry instead of switch sites    | Add mode stop costing four edits                         |
| All timers through injected `Clock` | Phase tests run instant, deterministic                   |
| Server enforces phase deadlines     | Client timer = rendering detail, not authority           |
| Dictionary read-only after load     | Shared across lobbies, no synchronisation                |
| Test mode before real mode          | Debug engine + `anti_match` at once = two bugs at a time |

## Issues

| Issue                                                             | Title                                           |
| ----------------------------------------------------------------- | ----------------------------------------------- |
| [#81](https://github.com/Skill-issue-coding/OrdioArena/issues/81) | Game interface with mandatory Snapshot          |
| [#82](https://github.com/Skill-issue-coding/OrdioArena/issues/82) | GameBase and the Phase chain                    |
| [#83](https://github.com/Skill-issue-coding/OrdioArena/issues/83) | Mode registry replacing the switch sites        |
| [#84](https://github.com/Skill-issue-coding/OrdioArena/issues/84) | Server-authoritative phase timestamps via Clock |
| [#85](https://github.com/Skill-issue-coding/OrdioArena/issues/85) | Dictionary loading from wordfiles               |
| [#86](https://github.com/Skill-issue-coding/OrdioArena/issues/86) | Throwaway test mode and fake-clock phase tests  |

## Open questions

- **Does `Phase` need `OnTick`?** Contexto Battle (S10) want continuous feedback during phase. Better find out here than bolt on in S10, exactly what test mode exists to surface.
- **`Snapshot(playerID) any` returning `any`.** Honest, each mode shape differs, but gives up type safety at boundary. Alternative = generic `Game[T]`, complicates registry map. Keep `any` unless S7 make it painful.
- **Dictionary load time.** If boot slow enough to hurt rolling deploys, lazy-load vectors = lever. Trades startup cost for first-request latency.
