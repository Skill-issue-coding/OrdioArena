// Package session owns connections, the hub, lobbies and seats.
//
// Goroutine topology, and the invariant the whole package rests on:
//
//	readPump ─┐                                        ┌─▶ Game.Run
//	          ├─▶ Conn ──▶ Hub.Run ──▶ Lobby.Run ──────┤   (owns game state)
//	writePump ┘            (owns       (owns ALL
//	                        conns)      lobby state)
//
// Each layer owns its state in exactly one goroutine and is reached only through
// channels. Lobby.Run is the only writer of lobby state, never mutate it from a
// timer callback, an HTTP handler or a spawned helper. Send on a channel and
// handle it inside the owning select.
//
// Every cross-goroutine send is non-blocking: a select with a default that drops
// and counts, so one slow client can never stall a lobby or a game.
//
// The lobby owns seats, not sockets. A seat outlives its connection, which is
// the entire mechanism behind reconnect. Each new connection for a seat bumps
// its epoch, and inbound events carrying a stale epoch are dropped, so a second
// tab fences the first rather than racing it, and the connection type owns no
// shared state at all.
//
// Scaffold only. See docs/design/S4-websocket-seats-reconnect.md and
// docs/design/S5-lobby-domain.md, issues #67-#80.
package session
