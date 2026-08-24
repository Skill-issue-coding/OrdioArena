# OrdioArena docs

Specs, decisions, notes. **Tracking lives in GitHub, not here** —
[issues](https://github.com/Skill-issue-coding/OrdioArena/issues) and
[roadmap board](https://github.com/orgs/Skill-issue-coding/projects/2). Doc describe
_what and why_; issue own _whether done_. Checklist in here = acceptance criteria, not progress.

Reference docs (how code work today, not plans) live elsewhere:
`server/README.md`, `frontend/CLAUDE.md`, `frontend/README.md`, `preprocessing/README.md`, root
`CLAUDE.md`.

## Start here

Full backend + frontend rewrite underway. Read these two first:

| Document                                                                   | What it is                                      |
| -------------------------------------------------------------------------- | ----------------------------------------------- |
| [roadmap.md](roadmap.md)                                                   | Eleven stages, in order, with exit criteria     |
| [design/0003-rewrite-architecture.md](design/0003-rewrite-architecture.md) | Why rewrite, locked decisions, rejected options |

## Stage specs

One per stage. Each hold: what get built, signatures + pseudocode pinning shape, decisions taken
that stage, issues, open questions. Read stage spec before picking up any issue in that milestone.

| Stage | Document                                                                         | Milestone                                                            |
| ----- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| S0    | [design/S0-skeleton-tooling-ci.md](design/S0-skeleton-tooling-ci.md)             | [S0](https://github.com/Skill-issue-coding/OrdioArena/milestone/5)   |
| S1    | [design/S1-protocol-contract.md](design/S1-protocol-contract.md)                 | [S1](https://github.com/Skill-issue-coding/OrdioArena/milestone/6)   |
| S2    | [design/S2-cluster-routing.md](design/S2-cluster-routing.md)                     | [S2](https://github.com/Skill-issue-coding/OrdioArena/milestone/7)   |
| S3    | [design/S3-session-tokens.md](design/S3-session-tokens.md)                       | [S3](https://github.com/Skill-issue-coding/OrdioArena/milestone/8)   |
| S4    | [design/S4-websocket-seats-reconnect.md](design/S4-websocket-seats-reconnect.md) | [S4](https://github.com/Skill-issue-coding/OrdioArena/milestone/9)   |
| S5    | [design/S5-lobby-domain.md](design/S5-lobby-domain.md)                           | [S5](https://github.com/Skill-issue-coding/OrdioArena/milestone/10)  |
| S6    | [design/S6-game-engine-registry.md](design/S6-game-engine-registry.md)           | [S6](https://github.com/Skill-issue-coding/OrdioArena/milestone/11)  |
| S7    | [design/S7-anti-match.md](design/S7-anti-match.md)                               | [S7](https://github.com/Skill-issue-coding/OrdioArena/milestone/12)  |
| S8    | [design/S8-cutover.md](design/S8-cutover.md)                                     | [S8](https://github.com/Skill-issue-coding/OrdioArena/milestone/13)  |
| S9    | [design/S9-impostor.md](design/S9-impostor.md)                                   | [S9](https://github.com/Skill-issue-coding/OrdioArena/milestone/14)  |
| S10   | [design/S10-new-modes.md](design/S10-new-modes.md)                               | [S10](https://github.com/Skill-issue-coding/OrdioArena/milestone/15) |

## Still current, outside the rewrite

Rewrite not touch `preprocessing/`, so its docs stand unchanged.

| Document                                                                     | Kind     | Status                     |
| ---------------------------------------------------------------------------- | -------- | -------------------------- |
| [design/0002-word-selection.md](design/0002-word-selection.md)               | Spec     | Largely implemented        |
| [decisions/anti-match-tuning.md](decisions/anti-match-tuning.md)             | Decision | Options open, feeds S7     |
| [notes/code-vs-plan-audit.md](notes/code-vs-plan-audit.md)                   | Audit    | Point-in-time, has a delta |
| [notes/preprocessing-w2v-migration.md](notes/preprocessing-w2v-migration.md) | Notes    | Implemented                |

## Deleted

`design/0001-reconnect.md` and `notes/architecture-review.md` described old server rewrite
replaces. Both superseded by `design/0003-rewrite-architecture.md` + stage specs. Deleted, not
archived, two descriptions of same system = drift. Still in git history if reasoning needed.

## Kinds

- **Stage spec**, one per rewrite stage, in `design/`, named `S<n>-<slug>.md`. Own shape of that
  stage: what get built, decisions taken there, issues, open questions.
- **Spec**, design to build, in `design/`, numbered for reference as "0003". Numbers permanent;
  rewrite get new number, old one archived or deleted, never edited into place.
- **Decision**, options with trade-offs, in `decisions/`. Record reasoning and, once made, choice.
  Sections stay after decision so rejected options stay readable.
- **Notes / Audit**, observations about code at point in time, in `notes/`. Go stale by nature, so
  each carry write date.

## Read the status header first

Every doc open with blockquote holding `Status`, `Tracking`, `Updated`. Trust header and code over
body text.

## Conventions

- Reference code as `path/file.go:123`, clickable. Prefer section refs (`§4a`) over line numbers
  when pointing at another doc; line numbers drift.
- Stage spec **Open questions** = working list for that stage. Answer one → move up into
  **Decisions taken in this stage**, not delete. Reasoning is the point.
- Stage complete → set status header to `Complete`, leave in place. Closed milestone record work;
  spec record intent.
