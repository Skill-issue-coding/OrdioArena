/**
 * @file types.ts (lib/websocket)
 * Master WebSocket type composition.
 *
 * Imports per-domain event unions and merges them into the top-level
 * WSReceivedEvent and WSSendPayloadMap consumed by WebSocketProvider,
 * subscribe(), and sendEvent().
 *
 * Domain breakdown:
 *   lobby.ts         — connection handshake, lobby management, chat
 *   game/impostor.ts — Impostor mode server → client events (including canonical
 *                      lifecycle events game_round_started / new_game_phase / game_result
 *                      with Impostor-specific payload shapes)
 *   game/shared.ts   — client → server input actions (game_submit_word, etc.)
 *
 * Adding a new game mode: create game/<mode>.ts, define its WSReceivedEvent
 * union (reusing the canonical event names with mode-specific payloads), and
 * add it to the WSReceivedEvent union below.
 */

export type { LobbyWSReceivedEvent, LobbyWSSendPayloadMap } from "./lobby";
export type { ImpostorWSReceivedEvent } from "./game/impostor";
export type { GameWSSendPayloadMap } from "./game/shared";
export type { AntiMatchWSReceivedEvent } from "./game/antimatch";

import type { LobbyWSReceivedEvent, LobbyWSSendPayloadMap } from "./lobby";
import type { ImpostorWSReceivedEvent } from "./game/impostor";
import type { GameWSSendPayloadMap } from "./game/shared";
import type { AntiMatchWSReceivedEvent } from "./game/antimatch";

// ---------------------------------------------------------------------------
// Server → Client master union
// ---------------------------------------------------------------------------

/**
 * Union of every event the Go server can send to the frontend.
 * Discriminate on `type` to narrow to the correct payload shape.
 * When lobbyState.mode is known, narrow further to the mode-specific union.
 */
export type WSReceivedEvent = LobbyWSReceivedEvent | ImpostorWSReceivedEvent | AntiMatchWSReceivedEvent;

/** All event type strings the server can send. */
export type WSReceivedEventType = WSReceivedEvent["type"];

/** Maps each received event type string to its payload shape. */
export type WSReceivedPayloadMap = {
  [E in WSReceivedEvent as E["type"]]: E["payload"];
};

// ---------------------------------------------------------------------------
// Client → Server master map
// ---------------------------------------------------------------------------

/**
 * Maps every outbound event type string to its payload shape.
 * Extend LobbyWSSendPayloadMap or GameWSSendPayloadMap to add new C→S events.
 */
export type WSSendPayloadMap = LobbyWSSendPayloadMap & GameWSSendPayloadMap;

/** All event type strings the client can send. */
export type WSSendEventType = keyof WSSendPayloadMap;

/**
 * A fully typed outbound WebSocket event object, ready to be JSON.stringify'd
 * and sent over the socket.
 */
export type WSSendEvent = {
  [K in WSSendEventType]: { type: K; payload: WSSendPayloadMap[K] };
}[WSSendEventType];
