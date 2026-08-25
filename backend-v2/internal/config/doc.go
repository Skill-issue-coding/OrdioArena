// Package config loads and validates process configuration from the environment.
//
// Loaded exactly once while booting up in main.go, then passed by value and never
// mutated. Nothing outside this package reads os.Getenv.
//
// Defaults exist, but SESSION_KEYS and SESSION_KEY_CURRENT have no default in any
// environment and refuse to boot when absent. The rest fall back only (when APP_ENV
// is set to dev)
//
// Validation collects rather than short-circuits. A bad configuration comes back
// as one *ValidationError listing every problem found.
//
// Load returns provenance as data because it runs before the logger is even initialized.
// Once the logger is built, the main function takes this returned Source and logs it.
// For security, the Source only ever contains configuration keys, never the actual values.
//
// See docs/design/S0-skeleton-tooling-ci.md, issue #50.
package config
