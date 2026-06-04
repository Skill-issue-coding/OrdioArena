import { GameTimers } from "./types";

export type AntiMatchPhaseType = "input" | "round_result" | "result";

export type PlayerSubmissionScore = {
  word: string;
  score: number;
};

export type AntiMatchPhaseUpdate = {
  timers: GameTimers;
  game_phase: AntiMatchPhaseType;
  target_word: string;
  submissions?: Record<string, boolean>;
  current_round: number;
  total_rounds: number;
};

export type AntiMatchPlayerResult = {
  word: string;
  score: number;
  is_duplicate: boolean;
  total_score: number;
};

export type AntiMatchRoundResult = {
  timers: GameTimers;
  game_phase: AntiMatchPhaseType;
  target_word: string;
  results: Record<string, AntiMatchPlayerResult>;
  winner?: string;
  current_round: number;
  total_rounds: number;
};
