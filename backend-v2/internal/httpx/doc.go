// Package httpx holds the HTTP surface: router, middleware and handlers.
//
// Handlers run on their own goroutine per request, owned by net/http, and
// therefore own no lobby or game state. Anything they need from a lobby is
// requested over a channel and answered by the goroutine that owns it. The one
// exception is the lobby registry map, which handlers touch directly under a
// mutex because they run outside the hub goroutine; that exception is
// documented at the declaration so it does not spread by example.
//
// Scaffold only. See docs/design/S0-skeleton-tooling-ci.md, issue #50.
package httpx
