import { GameTimers } from "./game";

// ---------------------------------------------------------------------------
// Payload types (mirror Go structs — timers are flat fields, not nested)
// ---------------------------------------------------------------------------

/** antimatch_input_phase — broadcast when an input phase begins. */
export type AntiMatchInputPhasePayload = GameTimers & {
  phase: "input";
  target_word: string;
  current_round: number;
  total_rounds: number;
};

/** antimatch_submission_update — broadcast when a player submits a word. */
export type AntiMatchSubmissionUpdatePayload = {
  player_id: string;
  has_submitted: boolean;
};

export type AntiMatchPlayerResult = {
  word: string;
  score: number;
  is_duplicate: boolean;
  total_score: number;
};

/** antimatch_round_result — broadcast when a round ends with scores. */
export type AntiMatchRoundResultPayload = GameTimers & {
  phase: "round_result";
  target_word: string;
  results: Record<string, AntiMatchPlayerResult>;
  winner?: string;
  current_round: number;
  total_rounds: number;
};

/** game_result (antimatch) — broadcast when the game ends. */
export type AntiMatchGameResultPayload = {
  total_scores: Record<string, number>;
};
