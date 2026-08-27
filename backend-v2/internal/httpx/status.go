package httpx

import (
	"net/http"
	"time"

	"github.com/Skill-issue-coding/OrdioArena/backend/internal/clock"
	"github.com/Skill-issue-coding/OrdioArena/backend/internal/cluster"
	"github.com/Skill-issue-coding/OrdioArena/backend/internal/logging"
)

// statusResponse is the wire shape of GET /api/status. Field names are the
// contract the compose healthcheck and the proxy poll; renaming one breaks
// both silently.
type statusResponse struct {
	Instance string `json:"instance"`
	Revision string `json:"revision"`
	UptimeMS int64  `json:"uptime_ms"`
}

// handleStatus reports liveness and identity for this instance.
//
// Uptime is derived from the injected Clock rather than time.Since, so the
// handler is testable without sleeping: a clock.Fake advanced by a known
// duration must produce exactly that uptime.
func handleStatus(c clock.Clock, started time.Time, instance cluster.PeerID, revision string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		resp := statusResponse{
			Instance: instance.String(),
			Revision: revision,
			UptimeMS: c.Now().Sub(started).Milliseconds(),
		}
		writeJSON(w, logging.From(r.Context()), http.StatusOK, resp)
	}
}
