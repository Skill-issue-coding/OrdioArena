// Package logging constructs the process logger and manages logging vocabulary.
//
// It returns a standard *slog.Logger rather than wrapping it, preserving
// slog.Handler composition and third-party integrations.
//
// Loggers are built in main and injected as dependencies (never global),
// allowing per-lobby tagging and parallel test isolation.
//
// Responsibilities:
//   - Root logger construction (handler, level, format, instance attribute).
//   - Consistent attribute keys via constants to ensure query reliability.
//   - Redaction of sensitive tokens and secrets (S3 requirement).
//
// Logging discipline: Log at the boundary and return errors from within. Never
// log and return the same error, as it duplicates failures in logs.
//
// See docs/design/S0-skeleton-tooling-ci.md.
package logging
