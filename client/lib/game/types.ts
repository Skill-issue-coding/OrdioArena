/**
 * @file types.ts (lib/game)
 * Domain types that mirror the Go server's session package structs.
 * These are the shapes of data received in WebSocket payloads and stored
 * in React state — keep them in sync with the Go types manually or via
 * a code-generation step.
 */

/** The lifecycle stage of a lobby, mirroring Go's GamePhase. */
export type GamePhase = "lobby" | "game_started";

/**
 * The active game mode, mirroring Go's GameMode.
 * - impostor:       Who is the Impostor? word-deduction mode.
 * - contexto_battle: Competitive Contexto guessing under a timer.
 * - synonym_duel:   King-of-the-Hill synonym elimination.
 * - anti_match:     Anti-Hivemind unique-word scoring.
 */
export type GameMode = "impostor" | "contexto_battle" | "synonym_duel" | "anti_match";

/**
 * A player's identity and cosmetic profile.
 * Mirrors Go's UserProfile struct. The server generates username and
 * background at connection time; the player can update them via update_user.
 */
export type User = {
  /** UUID assigned by the server at connection time. */
  user_id: string;
  /** Display name shown to all players in the lobby. */
  username: string;
  /** Hex color string used as the player's avatar background. */
  background: string;
};

/**
 * The complete shared lobby state broadcast via sync_gamestate.
 * All fields are safe to display to any player — private per-player data
 * (e.g. the Impostor's secret word) is never included here.
 */
export type LobbyState = {
  /** The human-readable room code (e.g. "AbCd-1234"). */
  code: string;
  mode: GameMode;
  phase: GamePhase;
  /** user_id of the player with host privileges. */
  host: string;
  /** All players currently in the lobby, keyed by user_id. */
  users: Record<string, User>;
  settings: ImpostorSettings | ContextoBattleSettings | SynonymDuelSettings | AntiMatchSettings;
};

export type ChatMessage = {
  /** The sender of the message. */
  sender: User;
  /** The message itself. */
  message: string;
  /** Server timestamp in Unix milliseconds. */
  date: number;
};

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

export type ModeSettings =
  | { mode: "impostor"; settings: ImpostorSettings }
  | { mode: "contexto_battle"; settings: ContextoBattleSettings }
  | { mode: "synonym_duel"; settings: SynonymDuelSettings }
  | { mode: "anti_match"; settings: AntiMatchSettings };

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
