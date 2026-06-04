/**
 * @file antimatch.ts (lib/websocket/game)
 * WebSocket event types for the Anti-Match game mode (server → client).
 */

import {
  AntiMatchPhaseUpdate,
  AntiMatchRoundResult,
  // AntiMatchGameResult (You will import this later when you build the final score screen)
} from "@/lib/game/antimatch-types";

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export type AntiMatchWSReceivedEvent =
  | {
      /** Broadcast when the phase transitions (e.g., to the input phase) */
      type: "new_game_phase";
      payload: AntiMatchPhaseUpdate;
    }
  | {
      /** Broadcast when a round ends, revealing scores, duplicates, and the winner */
      type: "game_round_result";
      payload: AntiMatchRoundResult;
    };
// TODO: add the "game_result" event here later!
