// Package logging provides three domain-scoped structured loggers — Hub,
// Lobby, and Game — backed by log/slog.
//
// Behaviour is controlled by the LOG_TO_FILE environment variable:
//
//   - LOG_TO_FILE unset / "false" / "0": all three loggers write to stdout
//     (the console), matching the previous log.Printf behaviour. Level: Info.
//
//   - LOG_TO_FILE "true" / "1": each logger writes detailed output to its own
//     file under the logs/ directory (hub.log, lobby.log, game.log). Level:
//     Debug, so the extra g.Debug(...) detail lines are captured too.
//
// Call Init once at process start (before any logger is used). Init is safe to
// call from main; the loggers are package-level singletons.
package logging

import (
	"io"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Domain loggers. They are initialised to stdout-backed loggers so that any
// code path that logs before Init() runs still produces console output rather
// than panicking on a nil logger.
var (
	Hub   = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	Lobby = Hub
	Game  = Hub
	// Client receives logs shipped from the browser via POST /api/log.
	Client = Hub
)

// logDir is where per-domain log files are written when LOG_TO_FILE is enabled.
const logDir = "logs"

var (
	initOnce  sync.Once
	openFiles []*os.File
)

// ToFile reports whether file logging is currently enabled. Useful for callers
// that want to avoid expensive log payload construction in console mode.
var toFile bool

func ToFile() bool { return toFile }

// Init configures the three domain loggers based on the LOG_TO_FILE env var.
// It is idempotent — only the first call has an effect.
func Init() {
	initOnce.Do(func() {
		toFile = parseBool(os.Getenv("LOG_TO_FILE"))

		if !toFile {
			// Console mode: every domain shares stdout. Prefix each line with
			// its domain via a logger attribute so the source stays clear.
			h := slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
			Hub = slog.New(h).With("domain", "hub")
			Lobby = slog.New(h).With("domain", "lobby")
			Game = slog.New(h).With("domain", "game")
			Client = slog.New(h).With("domain", "client")
			log.Printf("[logging] console mode (set LOG_TO_FILE=true for file logs)")
			return
		}

		if err := os.MkdirAll(logDir, 0o755); err != nil {
			log.Printf("[logging] could not create %s dir, falling back to console: %v", logDir, err)
			toFile = false
			return
		}

		Hub = fileLogger("hub.log", "hub")
		Lobby = fileLogger("lobby.log", "lobby")
		Game = fileLogger("game.log", "game")
		Client = fileLogger("client.log", "client")
		log.Printf("[logging] file mode — writing detailed logs to %s/{hub,lobby,game,client}.log", logDir)
	})
}

// fileLogger opens (or creates/appends) a log file and returns a Debug-level
// text logger writing to it. On failure it logs the error and falls back to a
// stdout logger so the server keeps running.
func fileLogger(filename, domain string) *slog.Logger {
	path := filepath.Join(logDir, filename)
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		log.Printf("[logging] could not open %s, using stdout: %v", path, err)
		return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})).With("domain", domain)
	}
	openFiles = append(openFiles, f)

	// Detailed: include source file:line and Debug level so every input and
	// phase transition is captured.
	h := slog.NewTextHandler(f, &slog.HandlerOptions{
		Level:     slog.LevelDebug,
		AddSource: true,
	})
	return slog.New(h)
}

// Close flushes and closes any open log files. Call on graceful shutdown. It is
// safe to call when in console mode (no-op).
func Close() {
	for _, f := range openFiles {
		_ = f.Sync()
		_ = f.Close()
	}
	openFiles = nil
}

// Writer returns an io.Writer that fans out to stdout — used to bridge gin's
// default logger when desired. Currently stdout-only; kept for future use.
func Writer() io.Writer { return os.Stdout }

func parseBool(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
