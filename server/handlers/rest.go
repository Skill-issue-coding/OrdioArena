package handlers

import (
	"log/slog"
	"net/http"
	"server/logging"
	"server/session"
	"server/util"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// HandleStatus returns a simple JSON response
func HandleStatus(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":  "online",
		"message": "Game server is running",
	})
}

type NewUsernameRequest struct {
	UserId string `json:"user_id"`
}

func NewUsername(c *gin.Context, hub *session.GameHub) {
	var request NewUsernameRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Ogiltig förfrågan"})
		return
	}

	userId, err := uuid.Parse(request.UserId)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Ogiltigt användar-id"})
		return
	}

	connected := false
	for client := range hub.Clients {
		if client.UserId == userId {
			connected = true
			break
		}
	}

	if !connected {
		c.JSON(http.StatusNotFound, gin.H{"error": "Användaren är inte ansluten"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"username": util.GenerateUsername()})
}

// ClientLogEntry is a single log line shipped from the browser.
type ClientLogEntry struct {
	Time   string         `json:"time"`
	Level  string         `json:"level"`  // "debug" | "info" | "warn" | "error"
	Domain string         `json:"domain"` // "ws" | "lobby" | "game"
	Msg    string         `json:"msg"`
	UserId string         `json:"user_id"`
	Data   map[string]any `json:"data"`
}

// ClientLogRequest is the batched body POSTed to /api/log.
type ClientLogRequest struct {
	Entries []ClientLogEntry `json:"entries"`
}

// levelFor maps a client level string to a slog.Level.
func levelFor(level string) slog.Level {
	switch level {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// HandleClientLog receives batched browser logs and writes them through the
// Client logger (logs/client.log in file mode, console otherwise).
func HandleClientLog(c *gin.Context) {
	var req ClientLogRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Ogiltig logg-förfrågan"})
		return
	}

	// Cap batch size so a hostile client can't flood the log file in one call.
	const maxEntries = 200
	if len(req.Entries) > maxEntries {
		req.Entries = req.Entries[:maxEntries]
	}

	for _, e := range req.Entries {
		attrs := []any{"client_domain", e.Domain}
		if e.UserId != "" {
			attrs = append(attrs, "id", e.UserId)
		}
		if e.Time != "" {
			attrs = append(attrs, "client_time", e.Time)
		}
		for k, v := range e.Data {
			attrs = append(attrs, k, v)
		}
		logging.Client.Log(c.Request.Context(), levelFor(e.Level), e.Msg, attrs...)
	}

	c.Status(http.StatusNoContent)
}
