> **Status:** Not started · **Tracking:** milestone S8, issues [#94–#97](https://github.com/Skill-issue-coding/OrdioArena/milestone/13) · **Updated:** 2026-08-24
>
> Stage spec. Architecture rationale: [0003-rewrite-architecture.md](0003-rewrite-architecture.md) §Scope.

---

# S8 · Cutover

**Goal:** new code is only code.

**Exit:** one backend, one client, docs match code, preprocessing run writes to new path unaided.

## The rename

Old implementation stayed on disk as reference until now. After this stage: git history only.

```text
server/        →  deleted
frontend/      →  deleted
backend-v2/    →  backend/
web/           →  frontend/
server/wordfiles/  →  backend/wordfiles/
```

## The one place this touches Python

**`server/` disappearing not cosmetic.** `server/wordfiles/` is preprocessing pipeline output path, hardcoded in three files:

| File                                  | Constant       |
| ------------------------------------- | -------------- |
| `preprocessing/shared.py:29`          | `OUTPUT_DIR`   |
| `preprocessing/model_reduction.py:66` | `TARGETS_JSON` |
| `preprocessing/stage_5.py:55`         | `SERVER_DIR`   |

Move dir without moving constants = pipeline breaks silent on next run. Next run maybe months later, long after cause memorable.

Whole preprocessing footprint of rewrite. Deferred to this stage on purpose so pipeline keeps working until old dir gone.

### Worth considering instead

Top-level `wordfiles/` decouples preprocessing from backend dir name forever. Contract lives in dir owned by neither side. No future rename touches Python again.

Bigger change, preprocessing otherwise out of scope, so called out, not assumed. **Decide during this stage.**

## Git LFS

`vocab.bin` is Git LFS object. Move with `git mv` so pointer survives. Verify with `git lfs ls-files` **before** pushing. LFS pointer swapped for literal contents (or reverse) is nasty to unwind once in remote.

## Documentation

Several current doc statements go actively wrong at cutover. Biggest: single-instance deployment constraint, whole point of rewrite.

- Root `CLAUDE.md`: new architecture invariants, routing model replacing single-instance section, seat model, generated protocol, mode registry.
- `backend/README.md`: goroutine topology, event tables (generated from registry), phase state machines, settings reference, cluster config.
- `frontend/CLAUDE.md` and `frontend/README.md`: route tree, protocol type architecture, reconnect behaviour.
- Delete "known gaps" list wholesale. Rebuild from what still open.

## Deployment

- Reverse proxy in front, TLS, each instance reachable at own public address for per-lobby WebSocket URL.
- Shared `SESSION_KEYS` and `SESSION_KEY_CURRENT`; per-instance `INSTANCE_ID`; identical `CLUSTER_PEERS` everywhere.
- Origin allowlist set to real frontend origin.
- Check secret fingerprint across instances. Three instances that disagree = three different notions of who each player is.

### Drain, do not reshuffle

**Peer list change is deploy event, not runtime one.** Rolling restart that changes membership mid-play remaps codes and strands live lobbies on instances that no longer own them.

Deploy procedure must drain first, then change membership. Write it down. Execute once before trusting it.

## Decisions taken in this stage

| Decision                                   | Rationale                                           |
| ------------------------------------------ | --------------------------------------------------- |
| Old directories deleted, not archived      | Two implementations on disk = drift starts          |
| Preprocessing paths updated in the same PR | Path change split across PRs breaks pipeline silent |
| `git mv` for wordfiles                     | Preserves LFS pointer for `vocab.bin`               |
| Known-gaps list rebuilt, not edited        | Every entry describes code that no longer exists    |
| Drain before membership change             | Mid-play remap strands live lobbies                 |

## Issues

| Issue                                                             | Title                                             |
| ----------------------------------------------------------------- | ------------------------------------------------- |
| [#94](https://github.com/Skill-issue-coding/OrdioArena/issues/94) | Delete server/ and frontend/, rename the new dirs |
| [#95](https://github.com/Skill-issue-coding/OrdioArena/issues/95) | Rewrite CLAUDE.md and the per-directory READMEs   |
| [#96](https://github.com/Skill-issue-coding/OrdioArena/issues/96) | Multi-instance deploy on the self-hosted box      |
| [#97](https://github.com/Skill-issue-coding/OrdioArena/issues/97) | Archive the pre-rewrite design docs               |

## Open questions

- **Top-level `wordfiles/` or `backend/wordfiles/`?** See above. Decide here, not later.
- **Anything else reference `server/` by path?** Check CI, Docker, editor configs, `.gitattributes` LFS rules before rename, not after.
- **Cutover as one PR or several?** One = atomic but unreviewable. Several = tree broken in between. Single PR with reviewable commits = compromise.
