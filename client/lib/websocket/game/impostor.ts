/**
 * @file impostor.ts (lib/websocket/game)
 * WebSocket event types for the Impostor game mode (server → client).
 * Mirrors Go payloads in server/game/payloads.go and events in server/events/game_events.go.
 */

import { GameTimers } from "@/lib/game/game";

type ImpostorRole = "normal" | "impostor";

type ImpostorCycle = {
  submissions: Record<string, string>;
  votes: Record<string, string | null>;
};

// ---------------------------------------------------------------------------
// Payload types (mirror Go structs — timers are flat fields, not nested)
// ---------------------------------------------------------------------------

/** impostor_game_started — sent privately to each player at game start. */
type ImpostorGameStartedPayload = GameTimers & {
  phase: string;
  active_players: Record<string, boolean>;
  current_round: number;
  role: ImpostorRole;
  word: string;
};

/** impostor_input_phase — broadcast when input phase begins or advances to next player. */
type ImpostorInputPhasePayload = GameTimers & {
  phase: "input";
  current_player: string;
};

/** impostor_submission_update — broadcast when a player submits a word. */
type ImpostorSubmissionUpdatePayload = {
  player_id: string;
  word: string;
};

/** impostor_discussion_phase — broadcast when discussion phase begins with all submissions. */
type ImpostorDiscussionPhasePayload = GameTimers & {
  phase: "discussion";
  submissions: Record<string, string>;
};

/** impostor_vote_phase — broadcast when vote phase begins. */
type ImpostorVotePhasePayload = GameTimers & {
  phase: "vote";
};

/** impostor_vote_update — broadcast immediately each time a player casts a vote. */
type ImpostorVoteUpdatePayload = {
  player_id: string;
  target: string | null;
};

/** impostor_intermediate — broadcast after vote result with updated active players. */
type ImpostorIntermediatePayload = GameTimers & {
  phase: "intermediate";
  voted_out?: string;
  message: string;
  active_players: Record<string, boolean>;
};

/** impostor_round_update — broadcast at new cycle start with full round history. */
type ImpostorRoundUpdatePayload = {
  rounds: ImpostorCycle[];
};

/** game_result (impostor) — broadcast when game ends. */
type ImpostorGameResultPayload = {
  cycles: ImpostorCycle[];
  winners: string[];
  roles: Record<string, ImpostorRole>;
  words: Record<string, string>;
  normal_word: string;
};

// ---------------------------------------------------------------------------
// Server → Client discriminated union
// ---------------------------------------------------------------------------

export type ImpostorWSReceivedEvent =
  | { type: "impostor_game_started"; payload: ImpostorGameStartedPayload }
  | { type: "impostor_input_phase"; payload: ImpostorInputPhasePayload }
  | { type: "impostor_submission_update"; payload: ImpostorSubmissionUpdatePayload }
  | { type: "impostor_discussion_phase"; payload: ImpostorDiscussionPhasePayload }
  | { type: "impostor_vote_phase"; payload: ImpostorVotePhasePayload }
  | { type: "impostor_vote_update"; payload: ImpostorVoteUpdatePayload }
  | { type: "impostor_intermediate"; payload: ImpostorIntermediatePayload }
  | { type: "impostor_round_update"; payload: ImpostorRoundUpdatePayload }
  | { type: "game_result"; payload: ImpostorGameResultPayload };
