package session

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// testSecret is a fixed 32-byte key. Tests use it instead of LoadSessionSecret
// so they never depend on .env.local existing or on a randomly generated
// fallback: a signature test is only meaningful if the key is known.
var testSecret = []byte("0123456789abcdef0123456789abcdef")

// testClock is an arbitrary fixed instant. Mint and Parse both take `now`, so
// no test needs the wall clock, and an expiry test cannot become flaky by
// running near a second boundary.
var testClock = time.Date(2026, 3, 14, 15, 9, 26, 0, time.UTC)

// TestFull is the aggregate entry point. Each case runs as a real subtest via
// t.Run, so a failure in one does not abort the others, `go test -v` prints the
// name of each as it starts, and a single case can be selected with
// `-run 'TestFull/expiry'`.
func TestFull(t *testing.T) {
	t.Run("mint and parse", testMintAndParse)
	t.Run("expiry", testExpiry)
	t.Run("tampering", testTampering)
	t.Run("malformed", testMalformed)
	t.Run("load session secret", testLoadSessionSecret)
}

// testMintAndParse is the round trip: a freshly minted token must parse back to
// the exact id it was minted for.
func testMintAndParse(t *testing.T) {
	id := uuid.New()
	token := MintSessionToken(testSecret, id, testClock)
	t.Logf("id=%s", id)
	t.Logf("token=%s", token)

	parsed, err := ParseSessionToken(testSecret, token, testClock)
	if err != nil {
		t.Fatalf("parse of a fresh token failed: %v", err)
	}
	if parsed != id {
		t.Fatalf("round trip changed the id: minted %s, parsed %s", id, parsed)
	}

	// The three parts encode 16, 8 and 32 raw bytes. Unpadded base64url makes
	// those lengths fixed, so a wrong length here means an encoding mismatch
	// rather than a logic error.
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("expected 3 dot-separated parts, got %d", len(parts))
	}
	for i, want := range []int{22, 11, 43} {
		if len(parts[i]) != want {
			t.Errorf("part %d: expected %d chars, got %d (%q)", i, want, len(parts[i]), parts[i])
		}
	}
}

// testExpiry pins both sides of the boundary. exp itself is still valid; one
// second past it is not.
func testExpiry(t *testing.T) {
	id := uuid.New()
	token := MintSessionToken(testSecret, id, testClock)
	exp := testClock.Add(SESSION_TOKEN_TTL)

	cases := []struct {
		name    string
		at      time.Time
		wantErr error
	}{
		{"well before expiry", testClock.Add(time.Hour), nil},
		{"one second before expiry", exp.Add(-time.Second), nil},
		{"exactly at expiry", exp, nil},
		{"one second after expiry", exp.Add(time.Second), ErrTokenExpired},
		{"long after expiry", exp.Add(72 * time.Hour), ErrTokenExpired},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			parsed, err := ParseSessionToken(testSecret, token, c.at)

			if !errors.Is(err, c.wantErr) {
				t.Fatalf("parsing at %s: expected %v, got %v", c.at.Format(time.RFC3339), c.wantErr, err)
			}
			// A rejected token must not leak an id back to the caller.
			if c.wantErr != nil && parsed != uuid.Nil {
				t.Errorf("expected uuid.Nil on a rejected token, got %s", parsed)
			}
			if c.wantErr == nil && parsed != id {
				t.Errorf("expected %s, got %s", id, parsed)
			}
		})
	}
}

// testTampering covers the whole point of signing the token: any edit to the
// payload, and any wrong key, must be rejected as a bad signature. Crucially a
// tampered id part must NOT come back as a different valid uuid.
func testTampering(t *testing.T) {
	id := uuid.New()
	token := MintSessionToken(testSecret, id, testClock)
	parts := strings.Split(token, ".")

	t.Run("flipped signature byte", func(t *testing.T) {
		assertBadSignature(t, parts[0]+"."+parts[1]+"."+flipChar(parts[2], 0))
	})

	t.Run("flipped id byte", func(t *testing.T) {
		assertBadSignature(t, flipChar(parts[0], 0)+"."+parts[1]+"."+parts[2])
	})

	t.Run("flipped exp byte", func(t *testing.T) {
		// The interesting case: an attacker extending their own session.
		assertBadSignature(t, parts[0]+"."+flipChar(parts[1], 0)+"."+parts[2])
	})

	t.Run("wrong secret", func(t *testing.T) {
		other := []byte("ffffffffffffffffffffffffffffffff")
		parsed, err := ParseSessionToken(other, token, testClock)
		if !errors.Is(err, ErrTokenBadSignature) {
			t.Fatalf("expected ErrTokenBadSignature, got %v", err)
		}
		if parsed != uuid.Nil {
			t.Errorf("expected uuid.Nil, got %s", parsed)
		}
	})
}

// testMalformed feeds structurally broken input. None of it may panic: these
// strings arrive straight from a client, so a panic here is a remote crash.
func testMalformed(t *testing.T) {
	id := uuid.New()
	valid := strings.Split(MintSessionToken(testSecret, id, testClock), ".")

	cases := []struct {
		name string
		tok  string
	}{
		{"empty", ""},
		{"no separators", "abc"},
		{"two parts", "a.b"},
		{"four parts", "a.b.c.d"},
		{"empty parts", ".."},
		{"non-base64 signature", valid[0] + "." + valid[1] + ".!!!notbase64!!!"},
		{"non-base64 id", "!!!." + valid[1] + "." + valid[2]},
		{"truncated exp", valid[0] + ".AAAA." + valid[2]},
		{"oversized exp", valid[0] + ".AAAAAAAAAAAAAAAA." + valid[2]},
		{"truncated id", "AAAA." + valid[1] + "." + valid[2]},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// A panic in any of these fails the subtest rather than the run.
			parsed, err := ParseSessionToken(testSecret, c.tok, testClock)
			if err == nil {
				t.Fatalf("expected an error for %q, got id %s", c.tok, parsed)
			}
			if parsed != uuid.Nil {
				t.Errorf("expected uuid.Nil alongside the error, got %s", parsed)
			}
			t.Logf("rejected as: %v", err)
		})
	}
}

// testLoadSessionSecret exercises the env-var path. t.Setenv restores the
// previous value automatically when the subtest ends, so these cannot leak into
// each other or into the rest of the package.
func testLoadSessionSecret(t *testing.T) {
	t.Run("unset generates an ephemeral secret", func(t *testing.T) {
		t.Setenv(sessionSecretEnv, "")

		secret, err := LoadSessionSecret()
		if err != nil {
			t.Fatalf("unset secret should fall back, not fail: %v", err)
		}
		if len(secret) != MIN_SECRET_BYTES {
			t.Fatalf("expected %d bytes, got %d", MIN_SECRET_BYTES, len(secret))
		}

		// Two calls must not produce the same key, or the "random" fallback
		// is not random.
		again, err := LoadSessionSecret()
		if err != nil {
			t.Fatalf("second call failed: %v", err)
		}
		if string(secret) == string(again) {
			t.Error("two ephemeral secrets were identical, fallback is not random")
		}
	})

	t.Run("valid secret is decoded", func(t *testing.T) {
		// 32 bytes, base64-encoded, as `openssl rand -base64 32` would emit.
		t.Setenv(sessionSecretEnv, "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")

		secret, err := LoadSessionSecret()
		if err != nil {
			t.Fatalf("valid secret rejected: %v", err)
		}
		if string(secret) != string(testSecret) {
			t.Fatalf("decoded to %q, expected %q", secret, testSecret)
		}
	})

	t.Run("short secret is refused", func(t *testing.T) {
		t.Setenv(sessionSecretEnv, "c2hvcnQ=") // "short", 5 bytes

		if _, err := LoadSessionSecret(); err == nil {
			t.Fatal("expected a short secret to be refused, got nil error")
		}
	})

	t.Run("non-base64 secret is refused", func(t *testing.T) {
		t.Setenv(sessionSecretEnv, "!!!notbase64!!!")

		if _, err := LoadSessionSecret(); err == nil {
			t.Fatal("expected a non-base64 secret to be refused, got nil error")
		}
	})
}

// assertBadSignature is the shared expectation for every tampered token: a
// signature error, and no id handed back.
func assertBadSignature(t *testing.T, token string) {
	t.Helper()

	parsed, err := ParseSessionToken(testSecret, token, testClock)
	if !errors.Is(err, ErrTokenBadSignature) {
		t.Fatalf("expected ErrTokenBadSignature, got %v (id %s)", err, parsed)
	}
	if parsed != uuid.Nil {
		t.Errorf("a tampered token returned an id: %s", parsed)
	}
}

// flipChar changes one character to a different valid base64url character, so
// the result stays decodable and only the signature check can reject it.
func flipChar(s string, i int) string {
	b := []byte(s)
	if b[i] == 'A' {
		b[i] = 'B'
	} else {
		b[i] = 'A'
	}
	return string(b)
}
