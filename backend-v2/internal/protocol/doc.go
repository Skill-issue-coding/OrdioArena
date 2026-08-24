// Package protocol is the single source of truth for the WebSocket event
// contract, in both directions.
//
// Event types, payload structs and the registry that binds them live here, and
// the TypeScript client types are generated from this package. CI regenerates
// and fails on any diff, so the two can no longer drift, the previous codebase
// maintained the protocol by hand in three places, where a mismatch failed
// silently at runtime rather than at build time.
//
// An unknown inbound event type is logged and dropped, never fatal: during a
// rolling deploy a newer client talking to an older instance is normal.
//
// Scaffold only. See docs/design/S1-protocol-contract.md, issues #55-#58.
package protocol
