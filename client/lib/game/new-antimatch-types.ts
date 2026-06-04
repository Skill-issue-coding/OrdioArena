import { BaseGameState } from "./game";

type AntiMatchSubmission = {
  word: string;
  word_score: number;
  is_duplicate: boolean;
};

type AntiMatchRound = {
  has_submitted: Record<string, boolean>;
  submissions: Record<string, AntiMatchSubmission>;
  winner?: string;
};

export type AntiMatchResult = {
  total_scores: Record<string, number>;
};

export type AntiMatchGameState = Omit<BaseGameState, "mode"> & {
  mode: "anti_match";
  rounds: AntiMatchRound[];
  active_players: Record<string, boolean>;
  current_round: number;
  total_rounds: number;
};
