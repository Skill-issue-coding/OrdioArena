// Package game holds the mode-independent engine: the Game interface, GameBase,
// the phase chain and the mode registry.
//
// Game.Run is the only reader and writer of game state. Input arrives on a
// channel and is handled inside that goroutine's select; phase transitions
// happen there and nowhere else.
//
// Snapshot(playerID) is a required method, not an optional one. A mode that
// cannot describe its own state to a reconnecting player does not satisfy the
// interface and does not compile. This is the single decision the rewrite exists
// for: retrofitting resync onto finished modes is exactly where the previous
// codebase stalled.
//
// Modes register themselves in the registry, mode id to settings schema plus
// constructor. Adding a mode is one file and zero switch statements, which is
// what the previous design charged four edits for, once per mode.
//
// All phase deadlines come from the injected clock.Clock, so phase logic is
// testable without sleeping. Phase events carry start, ready and end timestamps
// as Unix milliseconds; clients render countdowns from those and never decide
// when a phase ends.
//
// Scaffold only. See docs/design/S6-game-engine-registry.md, issues #81-#86.
package game
