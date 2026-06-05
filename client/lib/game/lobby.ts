import { AntiMatchSettings, GameMode, ImpostorSettings } from "./game";
import { User } from "./user";

/** The lifecycle stage of a lobby, mirroring Go's GamePhase. */
export type LobbyPhase = "lobby" | "game_started";

export type LobbyState = {
  /** The human-readable room code (e.g. "AbCd-1234"). */
  code: string;
  mode: GameMode;
  phase: LobbyPhase;
  /** user_id of the player with host privileges. */
  host: string;
  /** All players currently in the lobby, keyed by user_id. */
  users: Record<string, User>;
  settings: ImpostorSettings | AntiMatchSettings; /**ContextoBattleSettings | SynonymDuelSettings */
};

export type ChatMessage = {
  /** The sender of the message. */
  sender: User;
  /** The message itself. */
  message: string;
  /** Server timestamp in Unix milliseconds. */
  date: number;
};
