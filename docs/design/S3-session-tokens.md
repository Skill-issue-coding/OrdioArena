> **Status:** Not started · **Tracking:** milestone S3, issues [#64–#66](https://github.com/Skill-issue-coding/OrdioArena/milestone/8) · **Updated:** 2026-08-24
>
> Stage spec. Architecture rationale: [0003-rewrite-architecture.md](0003-rewrite-architecture.md) §2.

---

# S3 · Session tokens

**Goal:** opaque, instance-agnostic, signed identity.

**Exit:** a token minted on `inst-1` verifies on `inst-3`, and carries no instance identity of any
kind.

## What the token is for

No accounts, no login, no email. The token is the only thing that lets a player who refreshed the
page prove they are the same player, so their seat, name, score and secret word come back instead
of a stranger joining.

It is deliberately small: identity plus which room it is good for, nothing else.

## Format

```text
v1.<key-id>.<base64url(claims-json)>.<base64url(hmac-sha256)>
```

```go
type Claims struct {
    PlayerID  uuid.UUID `json:"pid"`
    LobbyCode string    `json:"lc"`
    IssuedAt  int64     `json:"iat"`   // unix ms
    ExpiresAt int64     `json:"exp"`   // unix ms
}
```

**No instance identity.** No peer id, no shard hint, no host. A token minted by `inst-1` verifies
on `inst-3` because every instance holds the same secret. A token that encoded placement would turn
every future scaling decision into a token-format migration.

**Bound to one lobby.** A valid token presented for a different room grants nothing and is treated
as no token at all. This keeps a stale token from a previous game out of a new one.

## HMAC rather than JWT

|                 | HMAC as above                 | JWT                                  |
| --------------- | ----------------------------- | ------------------------------------ |
| Dependencies    | stdlib only                   | a library, and its CVEs              |
| `alg` confusion | Not possible                  | The classic footgun                  |
| Claim surface   | Four fields we chose          | A spec's worth of optional semantics |
| Interop         | None needed, we are both ends | Its actual advantage                 |

Nothing consumes this token but us. The interop JWT buys is worth nothing here, and its failure
modes are worth avoiding.

## Verification

```go
func Verify(tok string, keys Keyset, now time.Time) (Claims, error)
```

- `hmac.Equal` for the signature. Never `==`, that is a timing oracle.
- Expiry checked against the injected `Clock`, with a small skew tolerance.
- Typed errors: `ErrMalformed`, `ErrBadSignature`, `ErrExpired`, `ErrUnknownKey`. The caller needs
  to distinguish "start fresh silently" from "tell the player something".
- Unknown key id is an ordinary verification failure, not a panic.

## The token never appears in a URL

It is exchanged in the first message over the socket, not as a query parameter. Query strings land
in proxy access logs, browser history and `Referer` headers. A test asserts no token value reaches
any log line.

## Secret configuration

The signing secret must be identical on every instance. That is exactly what lets any instance
verify any other's token, and per-instance secrets would silently hand reconnecting players
brand-new identities, which presents as "reconnect is broken" rather than "config is wrong".

Silent misconfiguration is the dangerous failure, so it is made loud:

- `SESSION_KEYS` and `SESSION_KEY_CURRENT` required, minimum length enforced per key.
- The server **refuses to start** on a missing, empty or placeholder secret. No generate-at-boot
  fallback, it would appear to work on one instance and break on N, which is the worst of both.
- A short fingerprint of the secret (a hash, never the value) is logged at boot, so a mismatched
  cluster is diagnosable from the logs alone.

## Key rotation

Rotating the signing key must not sign every player out mid-game.

```go
type Keyset struct {
    Current  Key            // signs
    Accepted map[string]Key // verifies: current + recently retired
}
```

The token carries its key id; verification selects from the keyset; signing always uses the
current key. Retired keys stay accepted for at least one token lifetime.

## Decisions taken in this stage

| Decision                       | Rationale                                                         |
| ------------------------------ | ----------------------------------------------------------------- |
| HMAC-SHA256, not JWT           | stdlib only; no `alg` confusion; no interop requirement           |
| Opaque, instance-agnostic      | Token format never becomes a scaling migration                    |
| Bound to one lobby code        | A stale token cannot leak into a different game                   |
| Refuse to boot on a bad secret | A silently wrong secret breaks reconnect across the whole cluster |
| Key id + keyset from the start | Rotation without disconnecting live sessions                      |
| Exchanged over the socket      | Keeps the token out of logs, history and `Referer`                |

## Issues

| Issue                                                             | Title                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------- |
| [#64](https://github.com/Skill-issue-coding/OrdioArena/issues/64) | Signed session token: mint, verify, expiry           |
| [#65](https://github.com/Skill-issue-coding/OrdioArena/issues/65) | SESSION_SECRET config with refuse-to-boot validation |
| [#66](https://github.com/Skill-issue-coding/OrdioArena/issues/66) | Key id and keyset so the signing key can rotate      |

## Open questions

- **Token lifetime.** Long enough to survive a full session plus a lunch break; short enough that
  a leaked token expires. Twelve hours, refreshed on each handshake, is the starting proposal.
- **Should the token survive the lobby?** Binding to `lobby_code` means creating a new room mints
  a new token and the player's identity does not persist across rooms. That is consistent with
  "no accounts" but worth stating out loud rather than discovering.
- **Revocation.** There is none, by design, an HMAC token is valid until it expires. Acceptable
  while a token only grants a seat in one ephemeral room.
