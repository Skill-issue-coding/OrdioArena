// Package clock is the sole source of time in the backend.
//
// All time operations use a Clock interface to avoid slow, flaky tests
// involving time.Sleep. The real Clock wraps the time package. The fake Clock
// manages a virtual time and pending timers, allowing instant, deterministic
// time advancement in tests. It is safe for concurrent use.
//
// Clocks are injected as dependencies, never as package globals, to support
// parallel testing.
//
// Test guidelines for Advance:
//   - Step incrementally (e.g., Advance(8s) then Advance(30s)). Jumping too far
//     might skip timers registered by subsequent handlers.
//   - Advance only synchronizes receipt, not handler completion. Assert on
//     delivery, not on state set by handlers after receipt.
//
// Advance panics on unreceived timers to prevent deadlocks. Use AdvanceNoWait
// to observe mid-flight states. Fake is included in standard builds for cross-
// package testing but must never be used in production.
//
// See docs/design/S0-skeleton-tooling-ci.md, issue #51.
package clock
