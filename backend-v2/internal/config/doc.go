// Package config loads and validates process configuration from the environment.
//
// Loaded exactly once, in main, then passed by value and never mutated. Nothing
// outside this package reads os.Getenv: a cluster whose instances disagree about
// their configuration is close to undebuggable, so the only way to be
// misconfigured is to fail startup loudly.
//
// Required variables have no defaults. A missing or malformed one is a startup
// error naming the variable, never a silent fallback.
//
// Scaffold only. See docs/design/S0-skeleton-tooling-ci.md, issue #50.
package config
