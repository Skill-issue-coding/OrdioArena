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

	lvl, err := logging.ParseLevel(cfg.LogLevel) // config already validated
	f, err := logging.ParseFormat(cfg.LogFormat)
	root := logging.New(logging.Options{
		Level:      lvl,
		Format:     f,
		InstanceID: cfg.InstanceID,
	})

	root.Info("config loaded",
		logging.KeyConfigSource, src.File,
		logging.KeyConfigKeys, src.FileKeys)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	// TODO(S0, #50): config.Load → deps → httpx.Router → http.Server → graceful shutdown.
}
