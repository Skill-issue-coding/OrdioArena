package logging_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"github.com/Skill-issue-coding/OrdioArena/backend/internal/logging"
)

// newBuf builds a logger writing into a buffer the test owns, so tests never
// contend over a shared destination and can run in parallel.
func newBuf(t *testing.T, o logging.Options) (*slog.Logger, *bytes.Buffer) {
	t.Helper()
	var buf bytes.Buffer
	o.Writer = &buf
	return logging.New(o), &buf
}

// decode parses the single JSON record in buf.
func decode(t *testing.T, buf *bytes.Buffer) map[string]any {
	t.Helper()
	line := strings.TrimSpace(buf.String())
	if line == "" {
		t.Fatal("no log output")
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(line), &m); err != nil {
		t.Fatalf("output is not valid JSON: %v\n%s", err, line)
	}
	return m
}

func TestNewAttachesInstance(t *testing.T) {
	t.Parallel()
	l, buf := newBuf(t, logging.Options{Level: slog.LevelInfo, Format: logging.FormatJSON, InstanceID: "inst-2"})

	l.Info("player joined", logging.KeyLobbyCode, "ABCD")

	m := decode(t, buf)
	if got := m[logging.KeyInstance]; got != "inst-2" {
		t.Errorf("instance = %v, want inst-2", got)
	}
	if got := m[logging.KeyLobbyCode]; got != "ABCD" {
		t.Errorf("lobby_code = %v, want ABCD", got)
	}
	if got := m["msg"]; got != "player joined" {
		t.Errorf("msg = %v, want %q", got, "player joined")
	}
}

func TestNewOmitsInstanceWhenUnset(t *testing.T) {
	t.Parallel()
	l, buf := newBuf(t, logging.Options{Level: slog.LevelInfo})

	l.Info("hello")

	if _, ok := decode(t, buf)[logging.KeyInstance]; ok {
		t.Error("instance attribute present despite empty InstanceID")
	}
}

func TestNewDefaultsToJSON(t *testing.T) {
	t.Parallel()
	// Format left empty.
	l, buf := newBuf(t, logging.Options{Level: slog.LevelInfo})

	l.Info("hello")

	decode(t, buf) // fails the test if the output is not JSON
}

func TestLevelFiltering(t *testing.T) {
	t.Parallel()
	l, buf := newBuf(t, logging.Options{Level: slog.LevelInfo})

	l.Debug("should be dropped")
	if buf.Len() != 0 {
		t.Fatalf("debug record emitted at info level: %s", buf.String())
	}

	l.Warn("should be kept")
	if buf.Len() == 0 {
		t.Fatal("warn record dropped at info level")
	}
}

func TestTextFormat(t *testing.T) {
	t.Parallel()
	l, buf := newBuf(t, logging.Options{Level: slog.LevelInfo, Format: logging.FormatText, InstanceID: "inst-1"})

	l.Info("hello")

	out := buf.String()
	if !strings.Contains(out, logging.KeyInstance+"=inst-1") {
		t.Errorf("text output missing instance attribute: %s", out)
	}
	if json.Valid([]byte(strings.TrimSpace(out))) {
		t.Errorf("text format produced JSON: %s", out)
	}
}

func TestSourceOnlyAtDebug(t *testing.T) {
	t.Parallel()

	t.Run("debug attaches and trims source", func(t *testing.T) {
		t.Parallel()
		l, buf := newBuf(t, logging.Options{Level: slog.LevelDebug})

		l.Debug("tracing")

		src, ok := decode(t, buf)[slog.SourceKey].(map[string]any)
		if !ok {
			t.Fatal("no source attribute at debug level")
		}
		file, _ := src["file"].(string)
		if strings.HasPrefix(file, "/") {
			t.Errorf("source file not trimmed, still absolute: %q", file)
		}
		if strings.Count(file, "/") != 1 {
			t.Errorf("source file = %q, want exactly dir/file.go", file)
		}
	})

	t.Run("info omits source", func(t *testing.T) {
		t.Parallel()
		l, buf := newBuf(t, logging.Options{Level: slog.LevelInfo})

		l.Info("routine")

		if _, ok := decode(t, buf)[slog.SourceKey]; ok {
			t.Error("source attribute present at info level")
		}
	})
}

func TestWithDomain(t *testing.T) {
	t.Parallel()
	root, buf := newBuf(t, logging.Options{Level: slog.LevelInfo})

	logging.WithDomain(root, logging.DomainLobby).
		With(logging.KeyLobbyCode, "EFGH").
		Info("settings changed")

	m := decode(t, buf)
	if got := m[logging.KeyDomain]; got != logging.DomainLobby {
		t.Errorf("domain = %v, want %v", got, logging.DomainLobby)
	}
	if got := m[logging.KeyLobbyCode]; got != "EFGH" {
		t.Errorf("lobby_code = %v, want EFGH", got)
	}
}

func TestFingerprintIsStableAndDistinguishing(t *testing.T) {
	t.Parallel()
	a := []byte("correct-horse-battery-staple")
	b := []byte("correct-horse-battery-stapleX")

	// A distinct slice with equal contents, not the same slice twice: the
	// property under test is that two instances hashing their own copy of one
	// secret agree, which is what makes a mismatched cluster diagnosable.
	a2 := append([]byte(nil), a...)
	if logging.Fingerprint(a) != logging.Fingerprint(a2) {
		t.Error("fingerprint depends on more than the bytes")
	}

	// Pinned so a change to the hash, the encoding or the truncation is loud.
	// Two builds run side by side during a rolling deploy; if they fingerprint
	// an identical secret differently, the boot logs accuse a config that is fine.
	const wantFP = "87cbebfeebc0"
	if got := logging.Fingerprint(a); got != wantFP {
		t.Errorf("Fingerprint = %q, want %q", got, wantFP)
	}
	if logging.Fingerprint(a) == logging.Fingerprint(b) {
		t.Error("different secrets produced the same fingerprint")
	}
	if got := len(logging.Fingerprint(a)); got != 12 {
		t.Errorf("fingerprint length = %d, want 12", got)
	}
}

func TestSecretNeverLogsTheValue(t *testing.T) {
	t.Parallel()
	secret := []byte("super-secret-session-key-value")
	l, buf := newBuf(t, logging.Options{Level: slog.LevelInfo})

	l.Info("config loaded", logging.KeySecretFP, logging.Secret(secret))

	out := buf.String()
	if strings.Contains(out, string(secret)) {
		t.Fatalf("secret value leaked into log output: %s", out)
	}
	if got := decode(t, buf)[logging.KeySecretFP]; got != logging.Fingerprint(secret) {
		t.Errorf("secret_fingerprint = %v, want %v", got, logging.Fingerprint(secret))
	}
}

func TestRedactedNeverLeaks(t *testing.T) {
	t.Parallel()
	const token = "v1.k1.eyJwaWQiOiJ4In0.signature"
	l, buf := newBuf(t, logging.Options{Level: slog.LevelInfo})

	l.Info("resume attempt", "token", logging.Redacted(token))

	out := buf.String()
	if strings.Contains(out, token) {
		t.Fatalf("token leaked through slog: %s", out)
	}
	if got := decode(t, buf)["token"]; got != "<redacted>" {
		t.Errorf("token = %v, want <redacted>", got)
	}
	// A struct printed with %v must not leak it either.
	if s := fmt.Sprintf("%v", logging.Redacted(token)); strings.Contains(s, token) {
		t.Errorf("token leaked through fmt: %s", s)
	}
}

func TestParseFormat(t *testing.T) {
	t.Parallel()
	tests := []struct {
		in      string
		want    logging.Format
		wantErr bool
	}{
		{"json", logging.FormatJSON, false},
		{"text", logging.FormatText, false},
		{"  JSON  ", logging.FormatJSON, false},
		{"logfmt", "", true},
		{"", "", true},
	}
	for _, tc := range tests {
		got, err := logging.ParseFormat(tc.in)
		if (err != nil) != tc.wantErr {
			t.Errorf("ParseFormat(%q) error = %v, wantErr %v", tc.in, err, tc.wantErr)
			continue
		}
		if got != tc.want {
			t.Errorf("ParseFormat(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestParseLevel(t *testing.T) {
	t.Parallel()
	tests := []struct {
		in      string
		want    slog.Level
		wantErr bool
	}{
		{"debug", slog.LevelDebug, false},
		{"INFO", slog.LevelInfo, false},
		{" warn ", slog.LevelWarn, false},
		{"error", slog.LevelError, false},
		{"verbose", 0, true},
	}
	for _, tc := range tests {
		got, err := logging.ParseLevel(tc.in)
		if (err != nil) != tc.wantErr {
			t.Errorf("ParseLevel(%q) error = %v, wantErr %v", tc.in, err, tc.wantErr)
			continue
		}
		if !tc.wantErr && got != tc.want {
			t.Errorf("ParseLevel(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
