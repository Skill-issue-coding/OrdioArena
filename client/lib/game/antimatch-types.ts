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
};

export type AntiMatchRoundResult = {
  timers: GameTimers;
  player_round_submissions: Record<string, PlayerSubmissionScore>;
  players_eliminated: Record<string, null>;
  winner: string;
};
