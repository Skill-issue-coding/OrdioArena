# OrdioArena docs

Specs, decisions and notes. **Tracking lives in GitHub, not here** —
[issues](https://github.com/Skill-issue-coding/OrdioArena/issues) and the
[roadmap board](https://github.com/orgs/Skill-issue-coding/projects/1). A document describes
_what and why_; an issue owns _whether it is done_. If you find a checklist in here, it is
describing acceptance criteria, not progress.

Reference documentation (how the code works today, as opposed to plans) is not in this directory:
see `server/README.md`, `frontend/CLAUDE.md`, `frontend/README.md`, `preprocessing/README.md`, and
the root `CLAUDE.md` for the map.

## Index

| Document                                                                     | Kind     | Status                       | Tracking                                                          |
| ---------------------------------------------------------------------------- | -------- | ---------------------------- | ----------------------------------------------------------------- |
| [design/0001-reconnect.md](design/0001-reconnect.md)                         | Spec     | Accepted, not implemented    | [#17](https://github.com/Skill-issue-coding/OrdioArena/issues/17) |
| [design/0002-word-selection.md](design/0002-word-selection.md)               | Spec     | **Largely implemented**      | [#27](https://github.com/Skill-issue-coding/OrdioArena/issues/27) |
| [decisions/anti-match-tuning.md](decisions/anti-match-tuning.md)             | Decision | Options open                 | [#25](https://github.com/Skill-issue-coding/OrdioArena/issues/25) |
| [notes/architecture-review.md](notes/architecture-review.md)                 | Findings | 2026-07-02, partly addressed | [#30](https://github.com/Skill-issue-coding/OrdioArena/issues/30) |
| [notes/code-vs-plan-audit.md](notes/code-vs-plan-audit.md)                   | Audit    | Point-in-time, has a delta   | —                                                                 |
| [notes/preprocessing-w2v-migration.md](notes/preprocessing-w2v-migration.md) | Notes    | Implemented                  | —                                                                 |
| [../archive/reconnect-plan-v1.md](../archive/reconnect-plan-v1.md)           | Spec     | **Superseded, do not use**   | —                                                                 |

## Kinds

- **Spec** — a design to build, in `design/`, numbered so it can be referenced as "0001". Numbers
  are permanent; a rewrite gets a new number and the old one is archived, not edited into place.
- **Decision** — options with trade-offs, in `decisions/`. Records the reasoning and, once made,
  the choice. Sections stay after a decision is taken so the rejected options remain readable.
- **Findings / Notes / Audit** — observations about the code at a point in time, in `notes/`.
  These go stale by nature, so each carries the date it was written.
- **Archive** — superseded documents, in `../archive/`. Never deleted, never implemented.

## Read the status header first

Every document opens with a blockquote carrying `Status`, `Tracking` and `Updated`. Several of
these documents were written before work happened and describe gaps that are now closed —
`decisions/anti-match-tuning.md` §4a and §5a are the clearest examples. The header says so. Trust
the header and the code over the body text.

## Conventions

- Reference code as `path/file.go:123` so it is clickable, and prefer section references (`§4a`)
  over line numbers when pointing at another document — line numbers drift.
- When a spec is implemented, set its status to `Implemented` and leave it in place; the closed
  issue is the record of the work, the spec is the record of the intent.
- New spec: next free number in `design/`, add a row above, open a tracking issue, link both ways.
