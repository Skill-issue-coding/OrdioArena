// Package clock is the only source of time in the backend.
//
// Every deadline, timer and timestamp goes through a Clock rather than the time
// package directly. This exists from the first commit because phase deadlines
// arrive in S6: with timers reaching time.After, every phase test becomes a
// time.Sleep, and the suite is slow and flaky for the life of the project.
//
// The real implementation wraps time. The fake holds a virtual now plus a heap
// of pending timers, and Advance fires everything due in order, so a test can
// step an hour instantly and deterministically. The fake must be safe to call
// from a test goroutine while the code under test runs, since that is exactly
// how a phase test works.
//
// A Clock is injected through the dependency struct. Never a package global: a
// global clock cannot differ between two parallel tests.
//
// Scaffold only. See docs/design/S0-skeleton-tooling-ci.md, issue #51.
package clock
