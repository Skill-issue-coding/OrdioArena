// Package logging constructs the process logger and owns the vocabulary every
// other package logs with.
//
// It deliberately does not wrap log/slog. New returns a *slog.Logger and that
// is the type passed around the backend, because *slog.Logger is already the
// shared interface: wrapping it behind a local type would cost slog.Handler
// composition, slog.LogValuer, context propagation and every third-party
// handler, in exchange for nothing.
//
// There is no package-level logger. The root logger is built once in main and
// injected, the same way clock.Clock is, so a lobby can carry a logger already
// tagged with its own room code and tests can capture output per test without
// racing each other over a global.
//
// What this package owns:
//
//   - Root logger construction: handler, level, format, instance attribute.
//   - Attribute keys as constants. This is the practical reason the package
//     exists: with several instances shipping into one aggregate, a concept
//     spelled "lobby_code" in one file and "lobbyCode" in another silently
//     splits every query, and nothing catches it at compile time.
//   - Redaction. S3 requires that no token value ever reaches a log line and
//     that the session secret appears only as a fingerprint.
//
// Logging discipline, which matters more than any of the above: log at the
// boundary, return errors from the inside. Deep helpers return wrapped errors;
// the goroutine that owns the state logs them. Never log and return, that
// produces one failure twice in the aggregate with no way to tell it was one
// event.
//
// See docs/design/S0-skeleton-tooling-ci.md for the stage this package belongs
// to.
package logging
