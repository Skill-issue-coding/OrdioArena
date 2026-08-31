package config

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/Skill-issue-coding/OrdioArena/backend/internal/cluster"
	"github.com/Skill-issue-coding/OrdioArena/backend/internal/logging"
)

// A key that clears every rule in parseKeyset: 32 bytes decoded, 29 distinct
// byte values, not a placeholder. Tests that are about something else use it so
// the failure under test is the only problem reported.
const (
	testKeyID  = "k1"
	testKeyB64 = "Qw3eR5tY7uI9oP1aS2dF4gH6jK8lZ0xC7vB5nM3qW1e"
	testKeys   = testKeyID + "=" + testKeyB64
)

// env adapts a map to the lookup loadFrom takes. The whole reason loadFrom has
// that signature: no globals, no t.Setenv, safe under t.Parallel.
func env(m map[string]string) lookup {
	return func(k string) (string, bool) { v, ok := m[k]; return v, ok }
}

// wantValidationError fails the test unless err is a *ValidationError, and
// returns it so the caller can inspect Problems.
func wantValidationError(t *testing.T, err error) *ValidationError {
	t.Helper()
	ve, ok := errors.AsType[*ValidationError](err)
	if !ok {
		t.Fatalf("want *ValidationError, got %T: %v", err, err)
	}
	return ve
}

// hasProblem reports whether any problem contains substr.
func hasProblem(ve *ValidationError, substr string) bool {
	for _, problem := range ve.Problems {
		if strings.Contains(problem, substr) {
			return true
		}
	}
	return false
}

// TestLoadFromSkipsDependentChecks pins the peersOK guard: a check whose input
// already failed must not fire a second time.
//
// Both subtests are load-bearing. The negative assertion alone would pass just
// as happily if the cross-check were deleted outright, so the positive control
// is what makes it mean "suppressed because its input failed" rather than
// "absent".
func TestLoadFromSkipsDependentChecks(t *testing.T) {
	t.Parallel()

	base := func() map[string]string {
		return map[string]string{
			VarAppEnv:            string(EnvProd),
			VarInstanceID:        "inst-9", // deliberately absent from the peer list
			VarSessionKeys:       testKeys,
			VarSessionKeyCurrent: testKeyID,
			VarOriginAllow:       "https://ok.example",
		}
	}

	t.Run("guard active: peer list failed, cross-check stays quiet", func(t *testing.T) {
		t.Parallel()
		m := base()
		m[VarClusterPeers] = "inst-1=ws://a.example" // ws in prod: parsePeers fails

		_, _, err := loadFrom(env(m))
		ve := wantValidationError(t, err)

		if !hasProblem(ve, VarClusterPeers) {
			t.Errorf("want a %s problem, got %v", VarClusterPeers, ve.Problems)
		}
		if hasProblem(ve, "want exactly 1") {
			t.Errorf("cross-check fired on a peer list that failed to parse: %v", ve.Problems)
		}
		// Sharpest form of the same assertion. Drop it if an unrelated check
		// ever makes it brittle; the two above still carry the property.
		if len(ve.Problems) != 1 {
			t.Errorf("want exactly 1 problem, got %d: %v", len(ve.Problems), ve.Problems)
		}
	})

	t.Run("positive control: peer list parsed, cross-check fires", func(t *testing.T) {
		t.Parallel()
		m := base()
		m[VarClusterPeers] = "inst-1=wss://a.example" // parses; inst-9 still absent

		_, _, err := loadFrom(env(m))
		ve := wantValidationError(t, err)

		if !hasProblem(ve, "want exactly 1") {
			t.Errorf("want the instance/peer cross-check to fire, got %v", ve.Problems)
		}
	})
}

// TestParseEnvFailsClosed asserts both return values on every row.
//
// The failure path must return EnvProd, never EnvDev. A test checking only that
// err != nil would not notice that flipping, and the flip is what would hand an
// internet-facing instance development defaults.
func TestParseEnvFailsClosed(t *testing.T) {
	t.Parallel()

	tests := []struct {
		in      string
		wantEnv Env
		wantErr bool
	}{
		{"dev", EnvDev, false},
		{"prod", EnvProd, false},
		{"DEV", EnvDev, false},
		{" prod ", EnvProd, false},
		{"Dev ", EnvDev, false},
		{"", EnvProd, true},
		{"staging", EnvProd, true},
	}

	for _, tc := range tests {
		got, err := parseEnv(tc.in)
		if (err != nil) != tc.wantErr {
			t.Errorf("parseEnv(%q) error = %v, wantErr %v", tc.in, err, tc.wantErr)
		}
		// Checked on the error rows too: that is the whole point of the test.
		if got != tc.wantEnv {
			t.Errorf("parseEnv(%q) = %q, want %q", tc.in, got, tc.wantEnv)
		}
	}
}

// TestAbsorbFlattensWrappedValidationError pins the errors.As tree walk.
//
// A single-level type assertion passes the direct case and nothing else;
// single-level %w unwrapping passes the first two and fails the third. The
// doubly wrapped row is the only one that pins the walk.
//
// absorb never reads l.get, so a zero-value loader is enough.
func TestAbsorbFlattensWrappedValidationError(t *testing.T) {
	t.Parallel()

	problems := []string{"first", "second", "third"}
	newVE := func() *ValidationError { return &ValidationError{Problems: problems} }

	tests := []struct {
		name string
		err  error
		want []string
	}{
		{"direct", newVE(), []string{"TEST_VAR: first", "TEST_VAR: second", "TEST_VAR: third"}},
		{"wrapped", fmt.Errorf("outer: %w", newVE()), []string{"TEST_VAR: first", "TEST_VAR: second", "TEST_VAR: third"}},
		{"doubly wrapped", fmt.Errorf("a: %w", fmt.Errorf("b: %w", newVE())), []string{"TEST_VAR: first", "TEST_VAR: second", "TEST_VAR: third"}},
		{"plain error", errors.New("boom"), []string{"TEST_VAR: boom"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			l := &loader{}
			l.absorb("TEST_VAR", tc.err)

			if len(l.problems) != len(tc.want) {
				t.Fatalf("got %d problems, want %d: %v", len(l.problems), len(tc.want), l.problems)
			}
			for i, want := range tc.want {
				if l.problems[i] != want {
					t.Errorf("problem %d = %q, want %q", i, l.problems[i], want)
				}
			}
		})
	}
}

// TestLoadFromDevDefaults pins every development fallback, and that each one is
// recorded in Source.Defaults so a default taken is visible rather than silent.
func TestLoadFromDevDefaults(t *testing.T) {
	t.Parallel()

	m := map[string]string{
		VarAppEnv:            string(EnvDev),
		VarSessionKeys:       testKeys,
		VarSessionKeyCurrent: testKeyID,
	}

	cfg, src, err := loadFrom(env(m))
	if err != nil {
		t.Fatalf("dev minimal config failed: %v", err)
	}

	if cfg.Env != EnvDev {
		t.Errorf("Env = %q, want %q", cfg.Env, EnvDev)
	}
	if cfg.InstanceID != cluster.PeerID(defaultDevInstance) {
		t.Errorf("InstanceID = %q, want %q", cfg.InstanceID, defaultDevInstance)
	}
	if cfg.ListenAddr != defaultListenAddr {
		t.Errorf("ListenAddr = %q, want %q", cfg.ListenAddr, defaultListenAddr)
	}
	if cfg.LogLevel != slog.LevelDebug {
		t.Errorf("LogLevel = %v, want %v", cfg.LogLevel, slog.LevelDebug)
	}
	if cfg.LogFormat != logging.FormatText {
		t.Errorf("LogFormat = %q, want %q", cfg.LogFormat, logging.FormatText)
	}

	wantPeers := []cluster.Peer{{ID: "local", WSURL: "ws://localhost:8080"}}
	if !slices.Equal(cfg.ClusterPeers, wantPeers) {
		t.Errorf("ClusterPeers = %v, want %v", cfg.ClusterPeers, wantPeers)
	}
	if !slices.Equal(cfg.OriginAllow, []string{defaultDevOrigins}) {
		t.Errorf("OriginAllow = %v, want [%s]", cfg.OriginAllow, defaultDevOrigins)
	}

	// Self() must be usable without a guard: loadFrom proved the row exists.
	if self := cfg.Self(); self.ID != cfg.InstanceID {
		t.Errorf("Self().ID = %q, want %q", self.ID, cfg.InstanceID)
	}

	// As a set, not a slice: the order is loadFrom's call order, and pinning it
	// would turn any future reordering into a red test for no reason.
	wantDefaults := []string{
		VarListenAddr, VarLogLevel, VarLogFormat,
		VarInstanceID, VarClusterPeers, VarOriginAllow,
	}
	if !equalSet(src.Defaults, wantDefaults) {
		t.Errorf("Source.Defaults = %v, want the same set as %v", src.Defaults, wantDefaults)
	}
}

// TestLoadFromProdFull covers the fully specified production path, including
// that the peer list comes back sorted by id.
func TestLoadFromProdFull(t *testing.T) {
	t.Parallel()

	m := map[string]string{
		VarAppEnv:     string(EnvProd),
		VarInstanceID: "inst-2",
		// Deliberately out of order, to pin the sort.
		VarClusterPeers: "inst-3=wss://ordio.example/i/inst-3," +
			"inst-1=wss://ordio.example/i/inst-1," +
			"inst-2=wss://ordio.example/i/inst-2",
		VarSessionKeys:       testKeys,
		VarSessionKeyCurrent: testKeyID,
		VarOriginAllow:       "https://ordio.example",
		VarListenAddr:        "127.0.0.1:9000",
		VarLogLevel:          "warn",
		VarLogFormat:         "json",
	}

	cfg, src, err := loadFrom(env(m))
	if err != nil {
		t.Fatalf("prod config failed: %v", err)
	}

	wantPeers := []cluster.Peer{
		{ID: "inst-1", WSURL: "wss://ordio.example/i/inst-1"},
		{ID: "inst-2", WSURL: "wss://ordio.example/i/inst-2"},
		{ID: "inst-3", WSURL: "wss://ordio.example/i/inst-3"},
	}
	if !slices.Equal(cfg.ClusterPeers, wantPeers) {
		t.Errorf("ClusterPeers = %v, want %v (sorted by id)", cfg.ClusterPeers, wantPeers)
	}

	// The instance's own address has exactly one source of truth: its peer row.
	if self := cfg.Self(); self.WSURL != "wss://ordio.example/i/inst-2" {
		t.Errorf("Self() = %v, want the inst-2 row", self)
	}

	if cfg.ListenAddr != "127.0.0.1:9000" {
		t.Errorf("ListenAddr = %q", cfg.ListenAddr)
	}
	if cfg.LogLevel != slog.LevelWarn {
		t.Errorf("LogLevel = %v, want %v", cfg.LogLevel, slog.LevelWarn)
	}
	if cfg.LogFormat != logging.FormatJSON {
		t.Errorf("LogFormat = %q, want %q", cfg.LogFormat, logging.FormatJSON)
	}
	if len(src.Defaults) != 0 {
		t.Errorf("Source.Defaults = %v, want empty when every variable is set", src.Defaults)
	}
}

// TestLoadFromFailsClosedWhenAppEnvUnset pins the security-relevant default: an
// unset APP_ENV must apply production rules, not development ones. If it failed
// open, an internet-facing instance would silently accept the localhost origin
// allowlist and a plaintext peer URL.
func TestLoadFromFailsClosedWhenAppEnvUnset(t *testing.T) {
	t.Parallel()

	m := map[string]string{
		VarSessionKeys:       testKeys,
		VarSessionKeyCurrent: testKeyID,
	}

	_, _, err := loadFrom(env(m))
	ve := wantValidationError(t, err)

	for _, name := range []string{VarInstanceID, VarClusterPeers, VarOriginAllow} {
		if !hasProblem(ve, name+" is required") {
			t.Errorf("want %q reported as required under an unset %s, got %v",
				name, VarAppEnv, ve.Problems)
		}
	}
}

// TestLoadFromCollectsEveryProblem pins that validation accumulates instead of
// short-circuiting. Fixing a cluster one variable per redeploy is the loop this
// behaviour exists to avoid, so the count matters, not just the failure.
func TestLoadFromCollectsEveryProblem(t *testing.T) {
	t.Parallel()

	// Five independent faults. Development, so instance/peers/origins default
	// and cannot contribute problems of their own.
	m := map[string]string{
		VarAppEnv:     string(EnvDev),
		VarLogLevel:   "verbose",
		VarLogFormat:  "logfmt",
		VarListenAddr: "8080", // a bare port: LISTEN_ADDR wants host:port
		// VarSessionKeys and VarSessionKeyCurrent omitted: two more.
	}

	_, _, err := loadFrom(env(m))
	ve := wantValidationError(t, err)

	for _, name := range []string{
		VarLogLevel, VarLogFormat, VarListenAddr, VarSessionKeys, VarSessionKeyCurrent,
	} {
		if !hasProblem(ve, name) {
			t.Errorf("want a %s problem, got %v", name, ve.Problems)
		}
	}
	if len(ve.Problems) != 5 {
		t.Errorf("want 5 problems, got %d: %v", len(ve.Problems), ve.Problems)
	}
}

// TestLoadFromEmptyValueIsAbsent pins loader.value's rule: a present but empty
// variable counts as missing. "SESSION_KEYS=" left in a .env must fail the same
// way a missing one does, rather than reaching parseKeyset as a zero-length
// secret.
func TestLoadFromEmptyValueIsAbsent(t *testing.T) {
	t.Parallel()

	m := map[string]string{
		VarAppEnv:            string(EnvDev),
		VarSessionKeys:       "   ", // present, whitespace only
		VarSessionKeyCurrent: testKeyID,
	}

	_, _, err := loadFrom(env(m))
	ve := wantValidationError(t, err)

	if !hasProblem(ve, VarSessionKeys+" is required") {
		t.Errorf("want %s reported as required, got %v", VarSessionKeys, ve.Problems)
	}
	// It must not have reached the parser at all.
	if hasProblem(ve, "invalid format") {
		t.Errorf("empty value reached parseKeyset instead of failing as absent: %v", ve.Problems)
	}
}

func TestParseKeyset(t *testing.T) {
	t.Parallel()

	allSame := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x41}, minKeyBytes))
	second := "k2=" + testKeyB64

	tests := []struct {
		name    string
		keys    string
		current string
		wantErr string // "" means success
	}{
		{"single key", testKeys, testKeyID, ""},
		{"rotation pair", testKeys + "," + second, "k2", ""},
		{"padded standard alphabet", "k1=" + base64.StdEncoding.EncodeToString(bytes.Repeat([]byte("abcdefgh"), 4)), "k1", ""},
		{"trailing comma", testKeys + ",", testKeyID, ""},
		{"doubled comma", testKeys + ",," + second, testKeyID, ""},

		{"dot in id", "k.1=" + testKeyB64, "k.1", `must not contain "."`},
		{"uppercase id", "K1=" + testKeyB64, "K1", "must be lowercase"},
		{"id starts with dash", "-k=" + testKeyB64, "-k", "must be lowercase"},
		{"duplicate id", testKeys + "," + testKeys, testKeyID, "appears more than once"},
		{"placeholder", "k1=changeme", "k1", "placeholder"},
		{"not base64", "k1=!!!!", "k1", "not valid base64"},
		{"too short", "k1=" + base64.RawURLEncoding.EncodeToString([]byte("short")), "k1", "minimum is"},
		{"one byte repeated", "k1=" + allSame, "k1", "one byte value repeated"},
		{"current not in set", testKeys, "nope", "not among the parsed key ids"},
		{"no entry separator", "k1" + testKeyB64, testKeyID, "invalid format"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			ks, err := parseKeyset(tc.keys, tc.current)

			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("parseKeyset(%q, %q) = %v, want success", tc.keys, tc.current, err)
				}
				if ks.Current.ID != tc.current {
					t.Errorf("Current.ID = %q, want %q", ks.Current.ID, tc.current)
				}
				// Current must also be in Accepted: Verify selects by key id out
				// of that map, so leaving it out would make every token this
				// instance mints fail its own verification.
				if _, ok := ks.Accepted[tc.current]; !ok {
					t.Errorf("Accepted is missing the current key %q", tc.current)
				}
				return
			}

			ve := wantValidationError(t, err)
			if !hasProblem(ve, tc.wantErr) {
				t.Errorf("want a problem containing %q, got %v", tc.wantErr, ve.Problems)
			}
		})
	}
}

func TestParsePeers(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		raw        string
		requireTLS bool
		want       []cluster.Peer
		wantErr    string
	}{
		{
			name: "single peer keeps its path",
			raw:  "inst-2=wss://ordio.example/i/inst-2",
			want: []cluster.Peer{{ID: "inst-2", WSURL: "wss://ordio.example/i/inst-2"}},
		},
		{
			name: "trailing slash normalised, host lowercased",
			raw:  "inst-2=wss://Ordio.Example/i/inst-2/",
			want: []cluster.Peer{{ID: "inst-2", WSURL: "wss://ordio.example/i/inst-2"}},
		},
		{
			name: "sorted by id",
			raw:  "b=wss://h/b,a=wss://h/a",
			want: []cluster.Peer{{ID: "a", WSURL: "wss://h/a"}, {ID: "b", WSURL: "wss://h/b"}},
		},
		{
			name: "ws allowed in development",
			raw:  "local=ws://localhost:8080",
			want: []cluster.Peer{{ID: "local", WSURL: "ws://localhost:8080"}},
		},

		{name: "ws rejected in production", raw: "a=ws://h", requireTLS: true, wantErr: `scheme "ws" is not allowed`},
		{name: "duplicate id", raw: "a=wss://h/1,a=wss://h/2", wantErr: "appears more than once"},
		{name: "bad id grammar", raw: "A=wss://h", wantErr: "must be lowercase"},
		{name: "missing scheme", raw: "a=ordio.example", wantErr: "missing scheme"},
		{name: "http scheme", raw: "a=https://h", wantErr: `want "wss" or "ws"`},
		{name: "query string", raw: "a=wss://h/p?x=1", wantErr: "must not carry a query or fragment"},
		{name: "no entry separator", raw: "wss://h", wantErr: "invalid format"},
		{name: "empty input", raw: "", wantErr: "no peer defined"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := parsePeers(tc.raw, tc.requireTLS)

			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("parsePeers(%q, %v) = %v, want success", tc.raw, tc.requireTLS, err)
				}
				if !slices.Equal(got, tc.want) {
					t.Errorf("got %v, want %v", got, tc.want)
				}
				return
			}
			if err == nil {
				t.Fatalf("parsePeers(%q, %v) succeeded, want an error", tc.raw, tc.requireTLS)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("error = %v, want it to contain %q", err, tc.wantErr)
			}
		})
	}
}

func TestParseOrigins(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		raw        string
		requireTLS bool
		want       []string
		wantErr    string
	}{
		{name: "single", raw: "https://ordio.example", want: []string{"https://ordio.example"}},
		{name: "host lowercased", raw: "https://Ordio.Example", want: []string{"https://ordio.example"}},
		{name: "trailing slash normalised", raw: "https://ordio.example/", want: []string{"https://ordio.example"}},
		{name: "port preserved", raw: "http://localhost:5173", want: []string{"http://localhost:5173"}},
		{
			name: "deduplicated and sorted",
			raw:  "https://b.example,https://a.example,https://b.example/",
			want: []string{"https://a.example", "https://b.example"},
		},

		{name: "http rejected in production", raw: "http://h", requireTLS: true, wantErr: `scheme "http" is not allowed`},
		{name: "wildcard", raw: "*", wantErr: `"*" is not an origin`},
		{name: "real path", raw: "https://h/app", wantErr: "scheme and host only"},
		{name: "missing scheme", raw: "ordio.example", wantErr: "missing scheme"},
		{name: "ws scheme", raw: "wss://h", wantErr: `want "https" or "http"`},
		{name: "empty input", raw: "", wantErr: "no allowed origin"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := parseOrigins(tc.raw, tc.requireTLS)

			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("parseOrigins(%q, %v) = %v, want success", tc.raw, tc.requireTLS, err)
				}
				if !slices.Equal(got, tc.want) {
					t.Errorf("got %v, want %v", got, tc.want)
				}
				return
			}
			if err == nil {
				t.Fatalf("parseOrigins(%q, %v) succeeded, want an error", tc.raw, tc.requireTLS)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("error = %v, want it to contain %q", err, tc.wantErr)
			}
		})
	}
}

func TestValidateListenAddr(t *testing.T) {
	t.Parallel()

	tests := []struct {
		raw     string
		wantErr bool
	}{
		{":8080", false},
		{"127.0.0.1:8080", false},
		{"0.0.0.0:8080", false},
		{"8080", true},   // a bare port is not an address
		{":0", true},     // port 0 asks the kernel to choose; not what an operator means
		{":70000", true}, // out of range
		{":http", true},  // named ports rejected deliberately
		{"", true},
	}

	for _, tc := range tests {
		err := validateListenAddr(tc.raw)
		if (err != nil) != tc.wantErr {
			t.Errorf("validateListenAddr(%q) = %v, wantErr %v", tc.raw, err, tc.wantErr)
		}
	}
}

// TestValidationErrorMessage pins the rendering, including that the first
// problem gets the same bullet and indent as the rest.
func TestValidationErrorMessage(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		problems []string
		want     string
	}{
		{"empty", nil, "invalid configuration"},
		{"one", []string{"only"}, "invalid configuration: only"},
		{"many", []string{"a", "b", "c"}, "invalid configuration (3 problems):\n  - a\n  - b\n  - c"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := (&ValidationError{Problems: tc.problems}).Error()
			if got != tc.want {
				t.Errorf("Error() =\n%q\nwant\n%q", got, tc.want)
			}
		})
	}
}

// --- Load: the file and environment layer -----------------------------------
//
// These tests touch the process environment and working directory, so none of
// them may call t.Parallel. Everything above uses loadFrom with a map source
// precisely so it does not have to live under that restriction.

// clearAmbientEnv removes every variable this package reads from the real
// environment, restoring it when the test ends.
//
// t.Setenv cannot unset, and setting a variable to "" would be worse than
// leaving it: value() treats empty as absent, but Load builds Source.EnvKeys
// from os.LookupEnv, which reports an empty variable as present. Registering
// the restore with t.Setenv and then unsetting gets both halves right.
func clearAmbientEnv(t *testing.T) {
	t.Helper()
	for _, name := range allVars {
		if old, ok := os.LookupEnv(name); ok {
			t.Setenv(name, old)   // registers the restore
			_ = os.Unsetenv(name) // ...then actually clear it
		}
	}
}

// writeDotEnv writes a .env into the current directory, which t.Chdir has
// already pointed at a temp dir. Load resolves envFile against the process
// working directory, which is why the real file lives at backend-v2/.env.
func writeDotEnv(t *testing.T, lines ...string) {
	t.Helper()
	if err := os.WriteFile(envFile, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatalf("writing %s: %v", envFile, err)
	}
}

// TestLoadEnvironmentBeatsDotEnv pins the envThen rule: a stray .env must never
// override what compose or systemd provided.
func TestLoadEnvironmentBeatsDotEnv(t *testing.T) {
	t.Chdir(t.TempDir())
	clearAmbientEnv(t)

	writeDotEnv(t,
		VarAppEnv+"="+string(EnvDev),
		VarInstanceID+"=from-file",
		VarClusterPeers+"=from-file=ws://localhost:8080,from-env=ws://localhost:8081",
		VarSessionKeys+"="+testKeys,
		VarSessionKeyCurrent+"="+testKeyID,
	)
	t.Setenv(VarInstanceID, "from-env")

	cfg, src, err := Load()
	if err != nil {
		t.Fatalf("Load() failed: %v", err)
	}

	if cfg.InstanceID != "from-env" {
		t.Errorf("InstanceID = %q, want %q: the real environment must win", cfg.InstanceID, "from-env")
	}
	// Proves the winning value was actually used downstream, not just stored.
	if self := cfg.Self(); self.WSURL != "ws://localhost:8081" {
		t.Errorf("Self() = %v, want the from-env row", self)
	}

	if src.File != envFile {
		t.Errorf("Source.File = %q, want %q", src.File, envFile)
	}
	if !slices.Contains(src.FileKeys, VarInstanceID) {
		t.Errorf("Source.FileKeys = %v, want it to include %s", src.FileKeys, VarInstanceID)
	}
	if !slices.Contains(src.EnvKeys, VarInstanceID) {
		t.Errorf("Source.EnvKeys = %v, want it to include %s", src.EnvKeys, VarInstanceID)
	}
}

// TestLoadMissingDotEnvIsNotAnError covers the container path, where there is no
// .env and everything arrives through the environment.
func TestLoadMissingDotEnvIsNotAnError(t *testing.T) {
	t.Chdir(t.TempDir()) // deliberately empty: no .env here
	clearAmbientEnv(t)

	t.Setenv(VarAppEnv, string(EnvDev))
	t.Setenv(VarSessionKeys, testKeys)
	t.Setenv(VarSessionKeyCurrent, testKeyID)

	cfg, src, err := Load()
	if err != nil {
		t.Fatalf("Load() with no %s failed: %v", envFile, err)
	}

	if cfg.Env != EnvDev {
		t.Errorf("Env = %q, want %q", cfg.Env, EnvDev)
	}
	if src.File != "" {
		t.Errorf("Source.File = %q, want empty when there is no %s", src.File, envFile)
	}
	if len(src.FileKeys) != 0 {
		t.Errorf("Source.FileKeys = %v, want empty", src.FileKeys)
	}
	if !equalSet(src.EnvKeys, []string{VarAppEnv, VarSessionKeys, VarSessionKeyCurrent}) {
		t.Errorf("Source.EnvKeys = %v, want exactly the three variables that were set", src.EnvKeys)
	}
}

// TestLoadSourceCarriesNoValues is the blunt version of the rule the whole
// provenance design rests on: Source travels to a log line, so it may carry key
// names and never values.
func TestLoadSourceCarriesNoValues(t *testing.T) {
	t.Chdir(t.TempDir())
	clearAmbientEnv(t)

	writeDotEnv(t,
		VarAppEnv+"="+string(EnvDev),
		VarSessionKeys+"="+testKeys,
		VarSessionKeyCurrent+"="+testKeyID,
		VarOriginAllow+"=https://secret-host.example",
	)

	_, src, err := Load()
	if err != nil {
		t.Fatalf("Load() failed: %v", err)
	}

	rendered, err := json.Marshal(src)
	if err != nil {
		t.Fatalf("marshalling Source: %v", err)
	}
	for _, leaked := range []string{testKeyB64, "secret-host.example"} {
		if strings.Contains(string(rendered), leaked) {
			t.Errorf("Source leaked a configuration value %q: %s", leaked, rendered)
		}
	}

	// Key names, on the other hand, are the entire point.
	if !slices.Contains(src.FileKeys, VarSessionKeys) {
		t.Errorf("Source.FileKeys = %v, want it to name %s", src.FileKeys, VarSessionKeys)
	}
}

// equalSet compares two string slices ignoring order.
func equalSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	x, y := slices.Clone(a), slices.Clone(b)
	slices.Sort(x)
	slices.Sort(y)
	return slices.Equal(x, y)
}
