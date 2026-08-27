// Command server is the OrdioArena game backend.
//
// This file does wiring and nothing else: read config, build dependencies,
// mount the router, serve, drain on SIGTERM. If logic accumulates here it is
// untestable by construction, so it belongs in a package under internal/.
//
// See docs/design/S0-skeleton-tooling-ci.md, issue #50.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Skill-issue-coding/OrdioArena/backend/internal/clock"
	"github.com/Skill-issue-coding/OrdioArena/backend/internal/config"
	"github.com/Skill-issue-coding/OrdioArena/backend/internal/httpx"
	"github.com/Skill-issue-coding/OrdioArena/backend/internal/logging"
)

const (
	// readHeaderTimeout bounds the header read only, not the whole request:
	// ReadTimeout would set a deadline on the connection that a WebSocket
	// upgrade inherits in S4. This is the slowloris defence without that cost.
	readHeaderTimeout = 5 * time.Second

	// idleTimeout governs keep-alive reuse between requests. Short values look
	// tidy and are expensive: every teardown makes the next request repay a
	// full handshake.
	idleTimeout = 120 * time.Second

	// shutdownTimeout bounds the drain. Exceeding it means in-flight requests
	// were cut, which run reports as a failed shutdown rather than swallowing.
	shutdownTimeout = 10 * time.Second
)

// main exists only to turn run's error into an exit status. Orchestrators read
// that status to decide whether a deploy failed, so a dead listener must not
// exit 0. os.Exit skips deferred functions, which is why every defer lives in
// run instead.
func main() {
	if err := run(); err != nil {
		// The structured logger may not exist yet, config.Load runs before it,
		// and its level and format are part of what Load returns.
		log.Printf("fatal: %v", err)
		os.Exit(1)
	}
}

// run wires the process and blocks until a signal or a listener failure. It
// returns errors rather than logging them, so one failure produces exactly one
// line, emitted by main at the boundary.
func run() error {
	cfg, src, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	// Level and Format arrive already typed: config parsed and validated them
	// during Load, which is exactly what lets logging.New have no error return.
	// Re-parsing them here would be a round trip through their own strings.
	root := logging.New(logging.Options{
		Level:      cfg.LogLevel,
		Format:     cfg.LogFormat,
		InstanceID: cfg.InstanceID,
	})

	// Provenance is logged here rather than inside config, because Load runs
	// before this logger exists: the level and format it was built with are
	// themselves part of what Load returned.
	logging.WithDomain(root, logging.DomainConfig).Info("config loaded",
		logging.KeyConfigSource, src.File,
		logging.KeyConfigKeys, src.FileKeys)

	hl := logging.WithDomain(root, logging.DomainHTTP)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()

	deps := httpx.NewDeps(root, clock.Real(), cfg.InstanceID)
	srv := &http.Server{
		Handler:           httpx.Router(deps),
		ReadHeaderTimeout: readHeaderTimeout,
		IdleTimeout:       idleTimeout,
		// No WriteTimeout: it would cap the lifetime of a WebSocket connection
		// in S4, and those are meant to outlive any single response.
	}

	// Bind before serving, so a taken port fails here rather than inside the
	// goroutine, and so "listening" reports the address actually bound.
	ln, err := net.Listen("tcp", cfg.ListenAddr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", cfg.ListenAddr, err)
	}

	hl.Info("listening", "addr", ln.Addr().String())

	// Buffered: the goroutine must never block on a send that main has stopped
	// waiting for.
	errCh := make(chan error, 1)
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		// The listener died on its own: there is nothing left to drain.
		return fmt.Errorf("http server: %w", err)
	case <-ctx.Done():
		// Restore default signal handling, so a second Ctrl-C kills immediately
		// instead of being swallowed by a drain that is taking too long.
		stop()
	}

	hl.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	// Stop accepting and drain in-flight requests first.
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}

	// S4 #67: only after Shutdown returns, cancel the root context so lobby
	// goroutines drain. Order matters: reversed, in-flight requests reach
	// lobbies that have already torn down.

	hl.Info("stopped")
	return nil
}
