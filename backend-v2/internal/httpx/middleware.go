package httpx

import (
	"log/slog"
	"net/http"
	"runtime/debug"

	"github.com/Skill-issue-coding/OrdioArena/backend/internal/clock"
	"github.com/Skill-issue-coding/OrdioArena/backend/internal/logging"
	"github.com/go-chi/chi/v5/middleware"
)

// requestLogger emits one line per completed request and places a request-scoped
// logger in the context for handlers to retrieve with logging.From. Scoped to /api
// only: it wraps the ResponseWriter, which the WebSocket upgrade cannot tolerate.
func requestLogger(l *slog.Logger, c clock.Clock) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := c.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			rl := l.With(logging.KeyRequestID, middleware.GetReqID(r.Context()))
			next.ServeHTTP(ww, r.WithContext(logging.Into(r.Context(), rl)))
			rl.Log(r.Context(), levelFor(ww.Status()), "request",
				logging.KeyMethod, r.Method,
				logging.KeyPath, r.URL.Path,
				logging.KeyStatus, ww.Status(),
				logging.KeyDuration, c.Now().Sub(start),
			)
		})
	}
}

// recoverer turns a handler panic into a logged 500 instead of net/http's silent
// connection close, which reaches the client only as a reset. It re-panics on
// http.ErrAbortHandler, which is net/http signalling an intentional abort, not a bug.
func recoverer(l *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				rv := recover()
				if rv == nil {
					return
				}
				if rv == http.ErrAbortHandler {
					panic(rv) // net/http contract, not a bug
				}

				rl := logging.FromOr(r.Context(), l)

				rl.Error("panic recovered",
					logging.KeyError, rv,
					"stack", string(debug.Stack()),
					logging.KeyMethod, r.Method,
					logging.KeyPath, r.URL.Path,
				)

				// Respond only when nothing has been written yet. Under /ws there is no wrapped
				// writer and the connection may be hijacked, where a write fails with ErrHijacked.
				if ww, ok := w.(middleware.WrapResponseWriter); ok && ww.Status() == 0 {
					writeError(w, rl, http.StatusInternalServerError, msgInternal)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// levelFor maps a response status to a log level so 5xx pages someone and 4xx does not.
func levelFor(status int) slog.Level {
	switch {
	case status >= 500:
		return slog.LevelError
	case status >= 400:
		return slog.LevelWarn
	default:
		return slog.LevelInfo
	}
}
