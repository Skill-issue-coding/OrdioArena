package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"maps"
	"net/url"
	"regexp"
	"slices"
	"strings"

	"github.com/Skill-issue-coding/OrdioArena/backend/internal/cluster"
	"github.com/Skill-issue-coding/OrdioArena/backend/internal/token"
)

// identRe is the grammar shared by peer ids and key ids.
var identRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

// minKeyBytes is what makes the boot fingerprint a fingerprint rather than a
// disclosure: logging.Fingerprint of a short secret is brute-forceable.
const minKeyBytes = 32

// placeholderKeys are values that decode but are plainly not secrets.
var placeholderKeys = map[string]bool{
	"changeme": true, "change-me": true, "secret": true,
	"password": true, "test": true, "example": true, "placeholder": true,
}

// parseKeyset parses SESSION_KEYS and SESSION_KEY_CURRENT into a keyset that
// signs with one key and verifies with all of them.
//
// INPUT: SESSION_KEYS=k2=Qw3eR5tY7uI9oP1aS2dF4gH6jK8lZ0xC7vB5nM3qW1e,k1=kJ8vQ2mR7tZxA1cB4nD6pL9sE3wY0uH5iO2gT8fV1aX
// INPUT: SESSION_KEY_CURRENT=k2
func parseKeyset(rawKeys, rawCurrent string) (token.Keyset, error) {
	var (
		accepted = make(map[string]token.Key)
		problems []string
	)

	for i, entry := range strings.Split(rawKeys, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue // tolerate a trailing or doubled comma; formatting, not content
		}

		// Cut, never Split: base64 padding is "=" as well.
		id, b64, ok := strings.Cut(entry, "=")
		if !ok {
			// There is no id yet and the entry cannot be printed, so its
			// position in the list is all the operator can be given.
			problems = append(problems, fmt.Sprintf(`entry %d: invalid format, want "id=base64key"`, i+1))
			continue
		}
		if strings.Contains(id, ".") {
			problems = append(problems, fmt.Sprintf(`key id %q must not contain "." — the token format is v1.<key-id>.<claims>.<signature>`, id))
			continue
		}
		if !identRe.MatchString(id) {
			problems = append(problems, fmt.Sprintf(`key id %q must be lowercase, start with a letter or digit, and hold only letters, digits, "_" and "-"`, id))
			continue
		}
		if _, exists := accepted[id]; exists {
			problems = append(problems, fmt.Sprintf("key id %q appears more than once", id))
			continue
		}
		if placeholderKeys[strings.ToLower(b64)] {
			problems = append(problems, fmt.Sprintf("key %q is a placeholder, not a secret", id))
			continue
		}
		decoded, err := decodeKey(b64)
		if err != nil {
			problems = append(problems, fmt.Sprintf("key %q is not valid base64: %v", id, err))
			continue
		}
		if len(decoded) < minKeyBytes {
			problems = append(problems, fmt.Sprintf("key %q is %d bytes, minimum is %d", id, len(decoded), minKeyBytes))
			continue
		}
		if allSame(decoded) {
			problems = append(problems, fmt.Sprintf("key %q is one byte value repeated, not a secret", id))
			continue
		}
		accepted[id] = token.Key{ID: id, Bytes: decoded}
	}

	// Ids only. accepted holds token.Key values whose Bytes are the signing
	// secrets, so printing the map itself would put every secret in a boot error.
	current, ok := accepted[strings.TrimSpace(rawCurrent)]
	if !ok {
		ids := slices.Sorted(maps.Keys(accepted))
		problems = append(problems, fmt.Sprintf("%s names %q, which is not among the parsed key ids %v",
			VarSessionKeyCurrent, rawCurrent, ids))
	}

	if len(problems) > 0 {
		return token.Keyset{}, &ValidationError{Problems: problems}
	}
	return token.Keyset{Current: current, Accepted: accepted}, nil
}

// parseEnv resolves what environment is running: dev or prod.
//
// INPUT: APP_ENV=dev
func parseEnv(s string) (Env, error) {
	switch e := Env(strings.ToLower(strings.TrimSpace(s))); e {
	case EnvDev, EnvProd:
		return e, nil
	default:
		return EnvProd, fmt.Errorf("unknown environment %q, want %q or %q", s, EnvDev, EnvProd)
	}
}

// INPUT: CLUSTER_PEERS=inst-1=wss://ordio.example/i/inst-1,inst-2=wss://ordio.example/i/inst-2
func parsePeers(raw string, requireTLS bool) ([]cluster.Peer, error) {
	var (
		problems []string
		peers    []cluster.Peer
		seen     = make(map[cluster.PeerID]bool)
	)

	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}

		// Cut, never Split: a URL can carry "=" inside a query string.
		id, rawURL, ok := strings.Cut(entry, "=")
		if !ok {
			problems = append(problems, fmt.Sprintf(`%q: invalid format, want "id=url"`, entry))
			continue
		}
		if !identRe.MatchString(id) {
			problems = append(problems, fmt.Sprintf(`peer id %q must be lowercase, start with a letter or digit, and hold only letters, digits, "_" and "-"`, id))
			continue
		}
		if seen[cluster.PeerID(id)] {
			// Not merely untidy: owner() draws once per entry, so a duplicated
			// id gets two chances to win a code and skews ownership.
			problems = append(problems, fmt.Sprintf("peer id %q appears more than once", id))
			continue
		}
		wsURL, err := canonicalPeerURL(rawURL, requireTLS)
		if err != nil {
			problems = append(problems, fmt.Sprintf("peer %q: %v", id, err))
			continue
		}

		seen[cluster.PeerID(id)] = true
		peers = append(peers, cluster.Peer{ID: cluster.PeerID(id), WSURL: wsURL})
	}

	if len(problems) > 0 {
		return nil, &ValidationError{Problems: problems}
	}
	if len(peers) == 0 {
		return nil, errors.New("no peer defined; the list must name every instance, including this one")
	}

	// Cosmetic, not semantic: rendezvous hashing takes the max over the set with
	// a deterministic tie-break, so order cannot shift ownership. Sorting makes
	// two instances' boot logs diffable, which is how a split peer list is found.
	slices.SortFunc(peers, func(a, b cluster.Peer) int {
		return strings.Compare(string(a.ID), string(b.ID))
	})

	return peers, nil
}

// parseOrigins parses ORIGIN_ALLOW into a canonical, deduplicated allowlist.
//
// INPUT: ORIGIN_ALLOW=https://ordio.example,https://www.ordio.example
func parseOrigins(raw string, requireTLS bool) ([]string, error) {
	var (
		allowedOrigins []string
		problems       []string
		seen           = make(map[string]bool)
	)

	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue // tolerate a trailing or doubled comma; formatting, not content
		}

		origin, err := canonicalOrigin(entry, requireTLS)
		if err != nil {
			problems = append(problems, fmt.Sprintf("%q: %v", entry, err))
			continue
		}
		if seen[origin] {
			continue
		}
		seen[origin] = true
		allowedOrigins = append(allowedOrigins, origin)
	}

	if len(problems) > 0 {
		return nil, &ValidationError{Problems: problems}
	}
	if len(allowedOrigins) == 0 {
		return nil, errors.New("no allowed origin defined; an instance that allows no origin can serve no browser")
	}

	slices.Sort(allowedOrigins)
	return allowedOrigins, nil
}

// canonicalOrigin validates one origin and returns it in exactly the form a
// browser puts in the Origin header: scheme, "://", lowercased host and port.
//
// The WebSocket upgrade guard compares with ==, so any other shape would
// silently never match and present as "the allowlist does not work". Matching
// is exact for the same reason it is not a prefix: "https://ordio.example"
// would otherwise admit "https://ordio.example.evil.com".
//
// Note the schemes. An Origin header carries the origin of the *page*, which is
// http or https even when the request it accompanies is a WebSocket upgrade.
// A ws:// origin is not a thing any browser sends.
//
// INPUT: one entry from ORIGIN_ALLOW, e.g. https://ordio.example
func canonicalOrigin(raw string, requireTLS bool) (string, error) {
	if raw == "*" {
		return "", errors.New(`"*" is not an origin; list every allowed origin explicitly`)
	}

	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("not a URL: %v", err)
	}

	switch u.Scheme {
	case "https":
	case "http":
		if requireTLS {
			return "", errors.New(`scheme "http" is not allowed in production, use "https"`)
		}
	case "":
		return "", errors.New(`missing scheme, want for example "https://ordioarena.example"`)
	default:
		return "", fmt.Errorf("scheme %q, want %q or %q", u.Scheme, "https", "http")
	}

	if u.Host == "" {
		return "", errors.New("missing host")
	}
	if u.User != nil {
		return "", errors.New("must not carry credentials")
	}
	// A bare trailing slash is the commonest paste and normalises away cleanly;
	// anything more is a real path and means the value was copied from a page
	// URL rather than written as an origin.
	if strings.Trim(u.Path, "/") != "" || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("must be scheme and host only, with no path, query or fragment")
	}

	return u.Scheme + "://" + strings.ToLower(u.Host), nil
}

func canonicalPeerURL(raw string, requireTLS bool) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("not a URL: %v", err)
	}

	switch u.Scheme {
	case "wss":
	case "ws":
		if requireTLS {
			return "", errors.New(`scheme "ws" is not allowed in production, use "wss"`)
		}
	case "":
		return "", errors.New(`missing scheme, want for example "wss://ordio.example/i/inst-2"`)
	default:
		return "", fmt.Errorf("scheme %q, want %q or %q", u.Scheme, "wss", "ws")
	}

	if u.Host == "" {
		return "", errors.New("missing host")
	}
	if u.User != nil {
		return "", errors.New("must not carry credentials")
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("must not carry a query or fragment")
	}

	// The path stays. Unlike an origin, a peer address carries the instance's
	// path prefix ("/i/inst-2"), which is how one hostname and one certificate
	// serve the whole cluster. Only the trailing slash is normalised away.
	u.Path = strings.TrimRight(u.Path, "/")
	u.Host = strings.ToLower(u.Host)

	return u.String(), nil
}

// decodeKey decodes one key value, accepting both base64 alphabets with or
// without padding. The alphabets differ only on "+/" versus "-_", so this takes
// `openssl rand -base64 32` pasted raw as well as a URL-safe variant.
//
// INPUT: one key value from SESSION_KEYS, e.g. Qw3eR5tY7uI9oP1aS2dF4gH6jK8lZ0xC7vB5nM3qW1e
func decodeKey(s string) ([]byte, error) {
	s = strings.TrimRight(s, "=")
	if b, err := base64.RawURLEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	return base64.RawStdEncoding.DecodeString(s)
}

// allSame reports whether every byte of b is identical, which is what catches
// the all-zero and all-0xFF keys a "temporary" secret tends to be.
//
// INPUT: the decoded bytes of one SESSION_KEYS value
func allSame(b []byte) bool {
	if len(b) == 0 {
		return false // just safe guard so we can loop
	}

	for _, c := range b[1:] {
		if c != b[0] {
			return false
		}
	}
	return true
}
