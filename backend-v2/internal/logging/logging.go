package logging

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path"
	"strings"

	"github.com/Skill-issue-coding/OrdioArena/backend/internal/cluster"
)

// Format selects the handler. Text is for a human reading a terminal; JSON is
// for anything that will be shipped, indexed or queried.
type Format string

const (
	FormatJSON Format = "json"
	FormatText Format = "text"
)

// ParseFormat converts a configuration string to a Format.
//
// It lives here rather than in config so the string vocabulary has exactly one
// definition. config calls it during validation, which is what keeps New
// infallible: by the time New runs, an invalid value has already failed startup.
func ParseFormat(s string) (Format, error) {
	switch Format(strings.ToLower(strings.TrimSpace(s))) {
	case FormatJSON:
		return FormatJSON, nil
	case FormatText:
		return FormatText, nil
	default:
		return "", fmt.Errorf("unknown log format %q, want %q or %q", s, FormatJSON, FormatText)
	}
}

// ParseLevel converts a configuration string to a slog.Level.
//
// slog.Level already implements encoding.TextUnmarshaler; this wraps it only to
// produce an error message that names the variable's accepted values, since a
// startup failure has to tell the operator what to type instead.
func ParseLevel(s string) (slog.Level, error) {
	var l slog.Level
	if err := l.UnmarshalText([]byte(strings.TrimSpace(s))); err != nil {
		return 0, fmt.Errorf("unknown log level %q, want debug, info, warn or error", s)
	}
	return l, nil
}

// Options configures the root logger. Writer is injected rather than assumed so
// tests can capture output into a buffer instead of reaching for a global.
type Options struct {
	Writer     io.Writer // nil means os.Stdout
	Level      slog.Level
	Format     Format // empty means FormatJSON
	InstanceID cluster.PeerID
}

// New builds the root logger. Call it once, in main, and inject the result.
//
// The instance id is attached here rather than at each call site: with several
// instances shipping into one aggregate, a line that cannot say which instance
// produced it is close to useless, and relying on every caller to remember
// guarantees the one line that matters will be missing it.
//
// Source locations are attached only at debug level. They are genuinely useful
// when tracing a goroutine handoff and pure noise at info.
func New(o Options) *slog.Logger {
	w := o.Writer
	if w == nil {
		w = os.Stdout
	}

	opts := &slog.HandlerOptions{
		Level:       o.Level,
		AddSource:   o.Level <= slog.LevelDebug,
		ReplaceAttr: trimSource,
	}

	var h slog.Handler
	if o.Format == FormatText {
		h = slog.NewTextHandler(w, opts)
	} else {
		h = slog.NewJSONHandler(w, opts)
	}

	l := slog.New(h)
	if o.InstanceID != "" {
		l = l.With(KeyInstance, o.InstanceID)
	}
	return l
}

// trimSource shortens the absolute build path slog records to the last two path
// elements, so a source attribute reads "session/lobby.go" rather than the
// machine-specific path of whoever compiled the binary.
func trimSource(_ []string, a slog.Attr) slog.Attr {
	if a.Key != slog.SourceKey {
		return a
	}
	src, ok := a.Value.Any().(*slog.Source)
	if !ok {
		return a
	}
	return slog.Any(slog.SourceKey, &slog.Source{
		Function: src.Function,
		File:     path.Join(path.Base(path.Dir(src.File)), path.Base(src.File)),
		Line:     src.Line,
	})
}

// Attribute keys.
//
// Use these constants rather than string literals. Every one of them is a field
// someone will eventually filter an aggregate by, and a concept spelled two ways
// splits that query in half with no compile-time warning.
const (
	KeyDomain    = "domain"
	KeyInstance  = "instance"
	KeyLobbyCode = "lobby_code"
	KeyPlayerID  = "player_id"
	KeyEpoch     = "epoch"
	KeySeatState = "seat_state"
	KeyMode      = "mode"
	KeyPhase     = "phase"
	KeyRound     = "round"
	KeyEventType = "event_type"
	KeyCloseCode = "close_code"
	KeyPeer      = "peer"
	KeyDropped   = "dropped"
	KeyReason    = "reason"
	KeyDuration  = "duration"
	KeyError     = "error"
	KeyRequestID = "request_id"
	KeyMethod    = "method"
	KeyPath      = "path"
	KeyStatus    = "status"

	// KeySecretFP carries the output of Fingerprint, never a secret itself.
	KeySecretFP = "secret_fingerprint"
	// KeyConfigKeys carries which configuration keys a source supplied. Keys
	// only, the values are the thing being protected.
	KeyConfigKeys = "config_keys"
	// KeyConfigSource names where configuration came from, e.g. ".env".
	KeyConfigSource = "config_source"
)

// Domain values for KeyDomain. One structured stream with a domain attribute
// replaces the previous backend's four separate log files, which do not scale
// past one instance: three instances times four domains is twelve files nobody
// will tail.
const (
	DomainConfig  = "config"
	DomainCluster = "cluster"
	DomainHTTP    = "http"
	DomainConn    = "conn"
	DomainHub     = "hub"
	DomainLobby   = "lobby"
	DomainGame    = "game"
	DomainWords   = "words"
)

// WithDomain returns a child logger tagged with a domain.
//
// Prefer tagging once, where the owning goroutine is created, over repeating the
// attribute at every call site, a lobby's logger should already know its own
// room code:
//
//	l := logging.WithDomain(root, logging.DomainLobby).With(logging.KeyLobbyCode, code)
func WithDomain(l *slog.Logger, domain string) *slog.Logger { return l.With(KeyDomain, domain) }

// Redacted is a string that cannot be logged by accident.
//
// Wrapping a sensitive value in this type makes leaking it structurally
// impossible rather than merely against the rules, which matters because the
// leak that gets shipped is the one someone adds at two in the morning:
//
//	slog.Any("token", logging.Redacted(tok))  // logs "<redacted>"
type Redacted string

// LogValue implements slog.LogValuer.
func (Redacted) LogValue() slog.Value { return slog.StringValue("<redacted>") }

// String keeps the value out of fmt verbs too, since %v on a struct containing
// one would otherwise print it.
func (Redacted) String() string { return "<redacted>" }

// fingerprintLen is the number of hex characters kept. Forty-eight bits is far
// more than enough to tell "these instances agree" from "these instances do
// not", which is the only question a fingerprint is asked.
const fingerprintLen = 12

// Fingerprint returns a short, stable hash of b, suitable for logging.
//
// Its purpose is the S3 boot check: every instance logs the fingerprint of its
// session secret, so a cluster that has been handed mismatched secrets is
// diagnosable from the logs alone rather than from players mysteriously losing
// their identity on reconnect.
//
// This is safe because config enforces a minimum secret length, a fingerprint
// of a short or guessable secret is brute-forceable, so the length check is what
// makes this a fingerprint rather than a disclosure.
func Fingerprint(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])[:fingerprintLen]
}

// Secret returns a loggable fingerprint of b. It never returns the value.
//
//	slog.Any(logging.KeySecretFP, logging.Secret(cfg.SessionSecret))
func Secret(b []byte) slog.Value { return slog.StringValue(Fingerprint(b)) }
