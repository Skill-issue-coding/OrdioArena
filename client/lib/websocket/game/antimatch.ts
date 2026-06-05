/**
 * @file antimatch.ts (lib/websocket/game)
 * WebSocket event types for the Anti-Match game mode (server → client).
 * Mirrors Go payloads in server/game/payloads.go and events in server/events/game_events.go.
 */

import {
  AntiMatchInputPhasePayload,
  AntiMatchSubmissionUpdatePayload,
  AntiMatchRoundResultPayload,
  AntiMatchGameResultPayload,
} from "@/lib/game/antimatch-types";

// ---------------------------------------------------------------------------
// Server → Client discriminated union
// ---------------------------------------------------------------------------

export type AntiMatchWSReceivedEvent =
  | { type: "antimatch_input_phase"; payload: AntiMatchInputPhasePayload }
  | { type: "antimatch_submission_update"; payload: AntiMatchSubmissionUpdatePayload }
  | { type: "antimatch_round_result"; payload: AntiMatchRoundResultPayload }
  | { type: "game_result"; payload: AntiMatchGameResultPayload };
