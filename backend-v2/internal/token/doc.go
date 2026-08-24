// Package token mints and verifies session tokens.
//
// A token is opaque, HMAC-SHA256 signed, and carries player id, lobby code and
// expiry, nothing else. It is what lets a player who refreshed the page prove
// they are the same player, so their seat, name, score and secret word come back
// instead of a stranger joining.
//
// The token carries no instance identity: no peer id, no shard hint, no host. A
// token minted by one instance verifies on any other because every instance
// holds the same secret, which is what keeps future topology changes from
// becoming token-format migrations.
//
// The signing secret must be identical across the cluster. Per-instance secrets
// would silently hand reconnecting players brand-new identities, which presents
// as "reconnect is broken" rather than "configuration is wrong", so a missing
// or placeholder secret refuses to boot.
//
// Signatures are compared with hmac.Equal, never ==.
//
// Scaffold only. See docs/design/S3-session-tokens.md, issues #64-#66.
package token
