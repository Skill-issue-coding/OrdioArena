package config

import (
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"slices"

	"github.com/Skill-issue-coding/OrdioArena/backend/internal/cluster"
	"github.com/Skill-issue-coding/OrdioArena/backend/internal/logging"
	"github.com/Skill-issue-coding/OrdioArena/backend/internal/token"
	"github.com/joho/godotenv"
)

// envFile is the dotenv path Load reads (local development only).
const envFile = ".env"

// Environment variable names.
const (
	VarAppEnv            = "APP_ENV"
	VarInstanceID        = "INSTANCE_ID"
	VarClusterPeers      = "CLUSTER_PEERS"
	VarSessionKeys       = "SESSION_KEYS"
	VarSessionKeyCurrent = "SESSION_KEY_CURRENT"
	VarOriginAllow       = "ORIGIN_ALLOW"
	VarListenAddr        = "LISTEN_ADDR"
	VarLogLevel          = "LOG_LEVEL"
	VarLogFormat         = "LOG_FORMAT"
)

// allVars is every variable this package reads. Load walks the array.
var allVars = []string{
	VarAppEnv,
	VarInstanceID,
	VarClusterPeers,
	VarSessionKeys,
	VarSessionKeyCurrent,
	VarOriginAllow,
	VarListenAddr,
	VarLogLevel,
	VarLogFormat,
}

// Dev-only fallbacks. Applied only when Env == EnvDev, always recorded in
// Source.Defaults so they show up in the boot log.
const (
	defaultListenAddr  = ":8080"
	defaultDevInstance = "local"
	defaultDevPeers    = "local=ws://localhost:8080"
	defaultDevOrigins  = "http://localhost:5173"
)

// Env selects the defaults and the strictness of validation.
type Env string

const (
	EnvDev  Env = "dev"
	EnvProd Env = "prod"
)

// Config is the frozen result of Load. It is passed by value and never mutated;
// nothing outside this package reads os.Getenv.
type Config struct {
	Env          Env
	InstanceID   cluster.PeerID
	ClusterPeers []cluster.Peer
	SessionKeys  token.Keyset
	OriginAllow  []string
	ListenAddr   string
	LogLevel     slog.Level
	LogFormat    logging.Format
}

// Self returns this instance's own peer entry.
func (c Config) Self() cluster.Peer {
	for _, p := range c.ClusterPeers {
		if p.ID == c.InstanceID {
			return p
		}
	}
	panic(fmt.Sprintf("config: instance %q missing from peer list; loadFrom must reject this", c.InstanceID))
}

// lookup resolves one key. Real environment always wins over the dotenv file,
// so a stray .env can never override what compose or systemd provided.
type lookup func(key string) (string, bool)

func envThen(file map[string]string) lookup {
	return func(k string) (string, bool) {
		if v, ok := os.LookupEnv(k); ok {
			return v, true
		}
		v, ok := file[k]
		return v, ok
	}
}

// Load reads .env when it exists, then the environment. A missing .env is the
// normal case in a container and is not an error.
func Load() (Config, Source, error) {
	var src Source

	file, err := godotenv.Read(envFile)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		file = nil // container path: environment only
	case err != nil:
		return Config{}, Source{}, fmt.Errorf("reading %s: %w", envFile, err)
	default:
		src.File = envFile
		src.FileKeys = make([]string, 0, len(file))
		for k := range file {
			src.FileKeys = append(src.FileKeys, k)
		}
		slices.Sort(src.FileKeys)
	}

	for _, name := range allVars {
		if _, ok := os.LookupEnv(name); ok {
			src.EnvKeys = append(src.EnvKeys, name)
		}
	}

	cfg, loaded, err := loadFrom(envThen(file))

	// loadFrom sees only an abstract lookup, so it can fill Defaults but not
	// the file/environment split. Stitch the two halves together here.
	loaded.File = src.File
	loaded.FileKeys = src.FileKeys
	loaded.EnvKeys = src.EnvKeys

	return cfg, loaded, err
}

// loadFrom is where validation lives. Tests call it with a map source directly:
// no globals, no t.Setenv, safe under t.Parallel().
func loadFrom(get lookup) (Config, Source, error) {
	cfg := Config{}
	l := &loader{get: get}

	env, err := parseEnv(l.optional(VarAppEnv, string(EnvProd)))
	if err != nil {
		l.absorb(VarAppEnv, err)
		env = EnvProd // fail closed while collecting the remaining problems
	}
	l.dev = env == EnvDev
	cfg.Env = env

	// Listen address. Never environment-dependent: the bind address is the same
	// in a container as it is locally, only the address it is reached at differs.
	cfg.ListenAddr = l.optional(VarListenAddr, defaultListenAddr)
	if err := validateListenAddr(cfg.ListenAddr); err != nil {
		l.absorb(VarListenAddr, err)
	}

	// Logging. Parsed here so logging.New stays infallible.
	if lvl, err := logging.ParseLevel(l.optional(VarLogLevel, devOr(l.dev, "debug", "info"))); err != nil {
		l.absorb(VarLogLevel, err)
	} else {
		cfg.LogLevel = lvl
	}
	if f, err := logging.ParseFormat(l.optional(VarLogFormat, devOr(l.dev, "text", "json"))); err != nil {
		l.absorb(VarLogFormat, err)
	} else {
		cfg.LogFormat = f
	}

	// Identity and membership. The peer list is complete: it includes this
	// instance, because owner() maxes over the whole set and an instance absent
	// from that set could never own a code.
	instance := l.devOptional(VarInstanceID, defaultDevInstance)
	cfg.InstanceID = cluster.PeerID(instance)

	peersRaw := l.devOptional(VarClusterPeers, defaultDevPeers)
	peersOK := false
	if peersRaw != "" {
		peers, err := parsePeers(peersRaw, !l.dev)
		if err != nil {
			l.absorb(VarClusterPeers, err)
		} else {
			cfg.ClusterPeers, peersOK = peers, true
		}
	}

	// Cross-field: Self() depends on this holding. Skipped when either input
	// already failed, so a malformed peer list reports once rather than twice.
	if peersOK && instance != "" {
		n := 0
		ids := make([]string, 0, len(cfg.ClusterPeers))
		for _, p := range cfg.ClusterPeers {
			ids = append(ids, string(p.ID))
			if p.ID == cfg.InstanceID {
				n++
			}
		}
		if n != 1 {
			l.problem("%s is %q, which appears %d times in %s (want exactly 1); peers are %v",
				VarInstanceID, instance, n, VarClusterPeers, ids)
		}
	}

	// Signing keys. No default in either environment, and no generate-at-boot
	// fallback: a generated secret appears to work on one instance and breaks
	// reconnect on N, which is the worst of both.
	keysRaw := l.required(VarSessionKeys)
	currentRaw := l.required(VarSessionKeyCurrent)
	if keysRaw != "" && currentRaw != "" {
		ks, err := parseKeyset(keysRaw, currentRaw)
		if err != nil {
			l.absorb(VarSessionKeys, err)
		} else {
			cfg.SessionKeys = ks
		}
	}

	// Origin allowlist. Production refuses to boot on an empty list rather than
	// falling back to "allow everything", which is the hole the current server
	// still has.
	if originsRaw := l.devOptional(VarOriginAllow, defaultDevOrigins); originsRaw != "" {
		origins, err := parseOrigins(originsRaw, !l.dev)
		if err != nil {
			l.absorb(VarOriginAllow, err)
		} else {
			cfg.OriginAllow = origins
		}
	}

	if len(l.problems) > 0 {
		return Config{}, l.source(), &ValidationError{Problems: l.problems}
	}
	return cfg, l.source(), nil
}

// devOr picks between a development and a production value.
func devOr(dev bool, devVal, prodVal string) string {
	if dev {
		return devVal
	}
	return prodVal
}
