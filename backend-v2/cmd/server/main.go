// Command server is the OrdioArena game backend.
//
// This file does wiring and nothing else: read config, build dependencies,
// mount the router, serve, drain on SIGTERM. If logic accumulates here it is
// untestable by construction, so it belongs in a package under internal/.
//
// Scaffold only. The real entry point lands in S0, issue #50.
package main

import (
	"log"

	"github.com/Skill-issue-coding/OrdioArena/backend/internal/config"
	"github.com/Skill-issue-coding/OrdioArena/backend/internal/logging"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func main() {
	cfg, src, err := config.Load()
	if err != nil {
		log.Fatalf("error when starting server, %v", err)
	}

	// Level and Format arrive already typed: config parsed and validated them
	// during Load, which is exactly what lets logging.New have no error return.
	// Re-parsing them here would be a round trip through their own strings.
	root := logging.New(logging.Options{
		Level:      cfg.LogLevel,
		Format:     cfg.LogFormat,
		InstanceID: string(cfg.InstanceID),
	})

	// Provenance is logged here rather than inside config, because Load runs
	// before this logger exists: the level and format it was built with are
	// themselves part of what Load returned.
	logging.WithDomain(root, logging.DomainConfig).Info("config loaded",
		logging.KeyConfigSource, src.File,
		logging.KeyConfigKeys, src.FileKeys)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	// TODO(S0, #50): config.Load → deps → httpx.Router → http.Server → graceful shutdown.
}
