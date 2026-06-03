import { GameTimers } from "./types";

export type AntiMatchPhaseType = "input" | "round_result" | "result";

export type AntiMatchPhaseUpdate = {
  timers: GameTimers;
  game_phase: AntiMatchPhaseType;
  target_word: string;
  submissions?: Record<string, boolean>;
};
