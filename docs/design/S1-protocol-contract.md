> **Status:** Not started · **Tracking:** milestone S1, issues [#55–#58](https://github.com/Skill-issue-coding/OrdioArena/milestone/6) · **Updated:** 2026-08-24
>
> Stage spec. Architecture rationale: [0003-rewrite-architecture.md](0003-rewrite-architecture.md) §3.

---

# S1 · Protocol contract

**Goal:** kill hand-duplicated event protocol. Go = single source of truth.

**Exit:** add event = one Go file + one command. CI catch un-regenerated client.

## The problem being solved

Protocol hand-written in 3 places: Go constants, TypeScript mirrors, tables in `server/README.md`. No compile-time link. Mismatch not fail build, fail at runtime, in game, as event that silently do nothing.

Stage early on purpose: every later stage add events. Fix duplication after S4 = fix across 4 stages of hand-written mirrors.

## Envelope

Unchanged. Client pub/sub transport already built on it, works:

```json
{ "type": "phase_started", "payload": { "phase": "input", "endTime": 1756042800000 } }
```

```go
type Envelope struct {
    Type    EventType       `json:"type"`
    Payload json.RawMessage `json:"payload"`
}
```

`json.RawMessage` inbound so router dispatch on `Type` before commit to payload shape. Unknown `Type` logged and dropped, never fatal, newer client hitting older instance during rolling deploy is normal, not attack.

## Registry

One place knowing every event + payload type:

```go
type EventDef struct {
    Type      EventType
    Direction Direction     // ClientToServer | ServerToClient
    Payload   reflect.Type
    Doc       string        // one line: when it is sent, what the receiver does
}

var Registry = map[EventType]EventDef{ ... }
```

Generator and inbound router both read here, cannot disagree. Test assert every declared `EventType` constant has registry entry. Constant without one = compile-passing, runtime-silent bug.

## Generation

```text
internal/protocol/*.go  ──generator──▶  web/src/protocol/generated.ts
                                        └─ payload interfaces
                                        └─ EventType union
                                        └─ discriminated { type, payload } union
                                        └─ type guards
```

Output must be deterministic: stable ordering, no timestamps, no map iteration. Else CI diff check = noise not signal.

Generated file **committed**, web build need no Go toolchain. Carries do-not-edit header.

### tygo or a custom generator

|                          | tygo                          | custom, on `go/types`   |
| ------------------------ | ----------------------------- | ----------------------- |
| Time to working output   | Hours                         | A day or two            |
| `uuid.UUID`, `time.Time` | Needs explicit type overrides | Handled however we want |
| Discriminated union      | Not native; needs a template  | Direct                  |
| Maintenance              | Someone else's                | Ours                    |

Start tygo. If type overrides + union template turn into fight, fallback = ~200 lines of `go/types` walking registry. Known quantity, not risk.

## CI enforcement

Regenerate, then `git diff --exit-code`. Payload change without regenerated client fails build with readable message instead of shipping silent mismatch.

Backend README event tables generated from same registry, docs cannot drift.

## Decisions taken in this stage

| Decision                                | Rationale                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------- |
| Go authoritative, TS generated          | One language already own semantics; schema-first add third artefact to sync |
| Envelope unchanged                      | Client transport already work on it                                         |
| Generated file committed                | Web build stay toolchain-free                                               |
| Unknown inbound type dropped, not fatal | Rolling deploys mix client and server versions                              |
| Registry completeness asserted by test  | Missing entry invisible until runtime                                       |

## Issues

| Issue                                                             | Title                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| [#55](https://github.com/Skill-issue-coding/OrdioArena/issues/55) | Event envelope, EventType registry, payload structs    |
| [#56](https://github.com/Skill-issue-coding/OrdioArena/issues/56) | Go to TypeScript protocol generator                    |
| [#57](https://github.com/Skill-issue-coding/OrdioArena/issues/57) | Typed client transport: discriminated union and guards |
| [#58](https://github.com/Skill-issue-coding/OrdioArena/issues/58) | CI drift check and generated event tables              |

## Open questions

- **Timestamp representation.** Design say Unix milliseconds as numbers, survive JSON and JavaScript without parsing. Confirm nothing want RFC 3339.
- **Payload naming.** `PhaseStartedPayload` in Go → `PhaseStartedPayload` in TS: literal but verbose. Decide before 40 events exist.
- **Versioning.** Nothing here version protocol. OK while client and server deploy together. Revisit if that stop being true.
