package httpx

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/Skill-issue-coding/OrdioArena/backend/internal/logging"
)

// msgInternal is the body of every unexpected 500, held as one constant so the
// player-facing wording cannot drift between callers.
const msgInternal = "Något gick fel."

// errorResponse is the body of every error response. The client switches on
// the HTTP status; this carries only what a player is shown.
type errorResponse struct {
	Error string `json:"error"`
}

// writeJSON writes v as a JSON body in the only order net/http permits: headers,
// then status, then body. Encoding failures are logged rather than returned, because
// by then the status is on the wire and the caller has no move left.
func writeJSON(w http.ResponseWriter, l *slog.Logger, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	err := json.NewEncoder(w).Encode(v)
	if err != nil {
		// Unmarshalable type reaching a handler is our bug: page-worthy.
		// Anything else is the client going away mid-write: routine.
		_, badType := errors.AsType[*json.UnsupportedTypeError](err)
		_, badValue := errors.AsType[*json.UnsupportedValueError](err)
		if badType || badValue {
			l.Error("encoding response body failed", logging.KeyError, err)
			return
		}

		l.Debug("encoding response body failed", logging.KeyError, err)
	}
}

// writeError sends msg as the sole error body so no handler hand-builds one and
// drifts from the shape. msg is always a Swedish constant: internal detail belongs in
// the log, never in a response.
func writeError(w http.ResponseWriter, l *slog.Logger, status int, msg string) {
	writeJSON(w, l, status, errorResponse{Error: msg})
}
