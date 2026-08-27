// Package httpx holds the HTTP surface: router, middleware and handlers.
//
// Handlers run on their own goroutine per request, owned by net/http, and
// therefore own no lobby or game state. Anything they need from a lobby is
// requested over a channel and answered by the goroutine that owns it; anything
// they need about lobby placement is computed from the code by cluster, never
// read from a shared map. That leaves this package with no mutable state of its
// own, which is why nothing in it takes a lock.
//
// The whole route surface is declared in Router, in one tree: invariant 3 (no
// lobby is ever created from a client-supplied code) is only auditable if it
// fits on a screen.
//
// See docs/design/S0-skeleton-tooling-ci.md, issue #50.
package httpx
