export type GameMode = "impostor" | "anti_match" | "contexto_battle" | "synonym_duel";

/**
 * The complete shared lobby state broadcast via sync_gamestate.
 * All fields are safe to display to any player — private per-player data
 * (e.g. the Impostor's secret word) is never included here.
 */

export type ImpostorSettings = {
  input_duration: number;
  discussion_duration: number;
  impostor_count: number;
  vote_duration: number;
};

export type ContextoBattleSettings = {
  round_duration: number;
  word_type: number;
  rounds: number;
};

export type SynonymDuelSettings = {
  round_duration: number;
  word_type: number;
  rounds: number;
};

export type AntiMatchSettings = {
  input_duration: number;
  rounds: number;
};

export type ModeSettings = { mode: "impostor"; settings: ImpostorSettings } | { mode: "contexto_battle"; settings: ContextoBattleSettings } | { mode: "synonym_duel"; settings: SynonymDuelSettings } | { mode: "anti_match"; settings: AntiMatchSettings };

export type LocalStorageProfile = {
  username?: string;
  background?: string;
};

/** Server-side timestamps for a timed phase. Mirrors Go's GameTimers. */
export type GameTimers = {
  /** Phase start time in Unix milliseconds. */
  start_time: number;
  /** When the actual phase begins (start_time + SYNC_DELAY). Show "get ready" overlay until this timestamp. */
  ready_time: number;
  /** Phase end time in Unix milliseconds. */
  end_time: number;
};

export type GamePhase = "show_word" | "input" | "discussion" | "vote" | "round_result" | "intermediate" | "game_result";

export type BaseGameState = {
  mode: GameMode;
  word: string;
  timers: GameTimers;
  phase: GamePhase;
};
