package session

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"os"
	"server/logging"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	// SESSION_TOKEN_TTL bounds how long a bearer token in localStorage stays
	// usable. A fresh token is minted on every successful connect, so an active
	// player never sees it; it only caps how long an abandoned one is worth
	// stealing.
	SESSION_TOKEN_TTL = 12 * time.Hour

	// MIN_SECRET_BYTES matches the SHA-256 digest size. A key shorter than the
	// digest is the practical weak point of HMAC, so this is a floor, not a
	// recommendation.
	MIN_SECRET_BYTES = 32

	sessionSecretEnv = "OA_SESSION_SECRET"
)

// Parse failures are separated so the caller can log why a token was rejected.
// The caller must treat all of them identically towards the user (mint a fresh
// identity, never an error on screen), but they mean very different things in
// the logs: expiry is routine, a bad signature is either a stale secret after a
// restart or someone forging tokens.
//
// Lower-cased per Go convention, these are wrapped into other messages.
var (
	ErrTokenMalformed    = errors.New("token is not of valid form")
	ErrTokenExpired      = errors.New("token has expired")
	ErrTokenBadSignature = errors.New("invalid token signature")

	// ErrSecretTooShort is a startup error, not a parse error: it means the
	// configured OA_SESSION_SECRET is weaker than the digest it keys.
	ErrSecretTooShort = errors.New("session secret is shorter than the required minimum")
)

// generateRandomBytes returns MIN_SECRET_BYTES of cryptographically secure
// randomness. crypto/rand, never math/rand: a predictable fallback secret is
// worse than having no fallback at all, because it looks like it works.
func generateRandomBytes() ([]byte, error) {
	b := make([]byte, MIN_SECRET_BYTES)
	_, err := rand.Read(b)
	if err != nil {
		return nil, err
	}

	return b, nil
}

// LoadSessionSecret reads the HMAC key from the environment once at startup.
// Call it from NewGameHub and keep the result on the hub: the mint/parse
// functions take the key as a parameter so they stay pure and testable, and so
// there is no package-level mutable state shared across goroutines.
//
// An unset variable is not an error. It yields an ephemeral per-process key and
// a warning, which keeps `go run .` working for a fresh clone at the cost of
// invalidating every session on restart. A configured but malformed or
// too-short key IS an error, and the caller should refuse to boot on it.
//
// If this ever runs on more than one instance, every instance must be given the
// same secret, otherwise a reconnect routed elsewhere silently mints a new
// identity. See "Deployment constraints" in the root CLAUDE.md.
func LoadSessionSecret() ([]byte, error) {
	raw := os.Getenv(sessionSecretEnv)
	if raw == "" {
		secret, err := generateRandomBytes()
		if err != nil {
			return nil, err
		}

		logging.Hub.Warn("no OA_SESSION_SECRET set, generated an ephemeral one; " +
			"sessions will not survive a restart")
		return secret, nil
	}

	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, err
	}

	if len(decoded) < MIN_SECRET_BYTES {
		// Refuse to boot rather than warn and continue. A key weaker than the
		// SHA-256 digest it feeds is the practical failure mode for HMAC, and
		// silently accepting one would sign every session with it.
		return nil, ErrSecretTooShort
	}

	return decoded, nil
}

// mac is the single place the signature is computed, so mint and parse cannot
// drift apart in algorithm or input framing.
func mac(secret, payload []byte) []byte {
	h := hmac.New(sha256.New, secret)
	h.Write(payload)
	return h.Sum(nil)
}

// MintSessionToken produces an opaque, signed, expiring identity token:
//
//	base64url(id) "." base64url(exp) "." base64url(hmacSHA256(secret, payload))
//
// It deliberately carries no profile data. Username and avatar are already held
// client-side and re-sent as update_user on every connect, so putting them here
// would make them redundant and immediately stale on rename. The only field
// that needs a server signature is the id, because without one any client could
// assert another player's id and take their seat, host rights or role reveal.
//
// now is a parameter rather than a call to time.Now so expiry is testable and
// so a caller can mint relative to a known instant. All three parts are fixed
// width (16, 8 and 32 bytes), which is what lets the parser reject anything
// else outright.
func MintSessionToken(secret []byte, id uuid.UUID, now time.Time) string {
	idPart := base64.RawURLEncoding.EncodeToString(id[:])

	exp := now.Add(SESSION_TOKEN_TTL).Unix()
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, uint64(exp))
	expPart := base64.RawURLEncoding.EncodeToString(buf)

	payload := idPart + "." + expPart
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac(secret, []byte(payload)))
}

// ParseSessionToken verifies a token and returns the id it carries.
//
// The signature is checked BEFORE anything is decoded out of the payload. That
// ordering is the security property of this function, not a stylistic choice:
// tok arrives verbatim from a client, and nothing in it may be trusted or even
// interpreted until the MAC proves we produced it. Comparison is hmac.Equal
// (constant time) because a timing side channel on a MAC is a forgery oracle.
//
// Every failure returns uuid.Nil so a caller that forgets to check the error
// cannot end up holding a half-trusted id. All errors mean the same thing to
// the caller (mint a fresh identity, never show the user an error) but are
// distinguished for the logs.
func ParseSessionToken(secret []byte, tok string, now time.Time) (uuid.UUID, error) {
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		return uuid.Nil, ErrTokenMalformed
	}

	payload := parts[0] + "." + parts[1]

	provided, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return uuid.Nil, ErrTokenMalformed
	}

	if !hmac.Equal(provided, mac(secret, []byte(payload))) {
		return uuid.Nil, ErrTokenBadSignature
	}

	// The signature checks out, so the payload is ours and can be decoded.
	//
	// The length checks are not redundant with the signature check above: the
	// decoded lengths are what make the indexing below safe, and they must not
	// depend on the order the checks happen to be written in. In particular
	// binary.BigEndian.Uint64 panics on a slice shorter than 8 bytes, which
	// with client-supplied input would be a remote crash.
	idBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || len(idBytes) != 16 {
		return uuid.Nil, ErrTokenMalformed
	}

	expBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || len(expBytes) != 8 {
		return uuid.Nil, ErrTokenMalformed
	}

	if now.Unix() > int64(binary.BigEndian.Uint64(expBytes)) {
		return uuid.Nil, ErrTokenExpired
	}

	id, err := uuid.FromBytes(idBytes)
	if err != nil {
		return uuid.Nil, ErrTokenMalformed
	}

	return id, nil
}
