package logging

import (
	"context"
	"log/slog"
)

// ctxKey is unexported and zero-sized: context keys compare by type identity,
// so a package-private type cannot collide with, or be forged by, any other
// package's key.
type ctxKey struct{}

// Into returns a context carrying l, so request-scoped attributes such as the
// request id travel with the request instead of being re-passed by hand.
func Into(ctx context.Context, l *slog.Logger) context.Context {
	return context.WithValue(ctx, ctxKey{}, l)
}

// From returns the logger stored by Into, or slog.Default() when none is present,
// so a missing logger costs one malformed log line rather than the request. Use it
// only where a logger is guaranteed to be in the context; elsewhere prefer FromOr.
func From(ctx context.Context) *slog.Logger {
	return FromOr(ctx, slog.Default())
}

// FromOr returns the logger stored by Into, or fallback when none is present. A
// caller that already holds a configured logger, the recoverer on /ws, which sits
// outside the request-logging middleware, passes it here rather than letting From
// drop to slog.Default(), whose handler is not the one this process configured.
func FromOr(ctx context.Context, fallback *slog.Logger) *slog.Logger {
	if l, ok := ctx.Value(ctxKey{}).(*slog.Logger); ok {
		return l
	}
	return fallback
}
