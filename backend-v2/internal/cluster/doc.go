// Package cluster decides which instance owns which lobby.
//
// Ownership is computed, not stored: rendezvous (highest-random-weight) hashing
// over a static peer list, so every instance derives the same owner for the same
// room code with no registry, no Redis and no coordination.
//
// Two consequences that the rest of the backend depends on:
//
// Code collisions need no coordination, because two identical codes always hash
// to the same instance, "is this code taken" is answered from local memory by
// the only instance that could know.
//
// A misdirected connection is refused, never served. An instance that receives a
// socket for a code it does not own responds 421 and closes. No code path
// anywhere creates a lobby from a client-supplied code, and that single rule is
// what turns a routing bug into an error screen instead of a split-brain room.
//
// The hash function must be stable across processes. Never maphash, whose seed
// is per-process by design.
//
// Scaffold only. See docs/design/S2-cluster-routing.md, issues #59-#63.
package cluster
