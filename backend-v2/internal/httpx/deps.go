package httpx

import (
	"log/slog"
	"time"

	"github.com/Skill-issue-coding/OrdioArena/backend/internal/clock"
	"github.com/Skill-issue-coding/OrdioArena/backend/internal/cluster"
)

// Deps bundles what handlers need and nothing they do not. Fields are unexported so
// NewDeps is the only way to build one, making a zero started, which would surface
// as an absurd uptime rather than a crash, unrepresentable instead of merely forbidden.
type Deps struct {
	log      *slog.Logger
	clk      clock.Clock
	instance cluster.PeerID
	revision string
	started  time.Time
}

// NewDeps assembles the bundle, deriving started and revision itself rather than
// trusting a caller to look them up correctly.
func NewDeps(log *slog.Logger, c clock.Clock, inst cluster.PeerID) Deps {
	return Deps{log: log, clk: c, instance: inst, revision: Revision(), started: c.Now()}
}
