package httpx

import (
	"net/http"

	"github.com/Skill-issue-coding/OrdioArena/backend/internal/logging"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// Router builds the complete HTTP surface. Every route this instance answers is
// declared here, in one tree: invariant 3 (no lobby is ever created from a
// client-supplied code) is only auditable if the whole surface fits on a screen.
//
// Returns http.Handler, not *chi.Mux, callers need ServeHTTP and nothing else,
// and chi stays an implementation detail of this package.
func Router(d Deps) http.Handler {
	l := logging.WithDomain(d.log, logging.DomainHTTP)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)

	// JSON API. Short-lived requests, so one log line per request is signal.
	r.Route("/api", func(r chi.Router) {
		r.Use(requestLogger(l, d.clk))
		r.Use(recoverer(l))
		r.Get("/status", handleStatus(d.clk, d.started, d.instance, d.revision))
		// S2 #61: r.Post("/lobby", ...)
		// S2 #62: r.Get("/lobby/{code}/route", ...)
	})

	// WebSocket. Deliberately outside requestLogger: these connections live for
	// a whole game, so a line emitted at disconnect with a 40-minute duration is
	// not a request log. Connection lifecycle is logged by DomainConn in S4.
	r.Route("/ws", func(r chi.Router) {
		r.Use(recoverer(l))
		// S2 #63 / S4 #67: r.Get("/game/{code}", ...)
	})

	return r
}
