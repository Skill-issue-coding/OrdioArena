import type { GameMode } from "@/hooks/game/types"
import type { User } from "@/hooks/user/types"
import type { AntiMatchSettings } from "@/hooks/game/antimatch/types"
import type { ImpostorSettings } from "@/hooks/game/impostor/types"

/** The lifecycle stage of a lobby, mirroring Go's GamePhase. */
export type LobbyPhase = "lobby" | "game_started"

export type LobbyState = {
  /** The human-readable room code (e.g. "AbCd-1234"). */
  code: string
  mode: GameMode
  phase: LobbyPhase
  /** user_id of the player with host privileges. */
  host: string
  /** All players currently in the lobby, keyed by user_id. */
  users: Record<string, User>
  settings: ImpostorSettings | AntiMatchSettings /**ContextoBattleSettings | SynonymDuelSettings */
}

export type ChatMessage = {
  /** The sender of the message. */
  sender: User
  /** The message itself. */
  message: string
  /** Server timestamp in Unix milliseconds. */
  date: number
}

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export type LobbyWSReceivedEvent =
  | {
      type: "connected_to_hub"
      /** Server-generated profile delivered once immediately after connection. */
      payload: { user: User }
    }
  | {
      /** Null-payload acknowledgements — use the preceding sync_gamestate for state. */
      type: "joined_lobby" | "left_lobby" | "join_error" | "game_started"
      payload: null
    }
  | {
      type: "sync_gamestate"
      payload: {
        lobbystate: LobbyState
        /** Optional toast shown only to the player whose action triggered the sync. */
        message?: string
      }
    }
  | { type: "chat_message"; payload: ChatMessage }
  | { type: "error" | "success"; payload: { message: string } }

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export type LobbyWSSendPayloadMap = {
  /** Create a new lobby. The caller is automatically registered as host. */
  create_lobby: null

  /** Join an existing lobby by its room code. */
  join_lobby: { lobby_code: string }

  /** Update display name and/or background color. Only non-empty fields are applied. */
  update_user: { username?: string; background?: string }

  /** Broadcast a chat message to every player in the lobby. */
  send_chatmessage: { message: string }

  /** Host-only: switch game mode and reset all settings to server defaults. */
  change_mode: { mode: GameMode }

  /** Host-only: update one named setting key for the currently active mode. */
  update_setting: { key: string; value: number }

  /** Leave the current lobby. */
  leave_lobby: null

  /** Host-only: start the game. */
  start_game: null

  /** Ask the server to broadcast the current lobby state. */
  sync_request: null
}
