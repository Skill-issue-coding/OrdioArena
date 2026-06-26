import type { BaseGameState } from "../types"

export type ImpostorSettings = {
  input_duration: number
  discussion_duration: number
  impostor_count: number
  vote_duration: number
}

export type ImpostorRole = "normal" | "impostor"

export type ImpostorRound = {
  submissions: Record<string, string>
  votes: Record<string, string | null>
  vote_result?: { voted_out: string | null; message: string }
}

export type ImpostorGameResult = {
  winners: string[]
  impostors: { userId: string; word: string }[]
  impostor_words: Record<string, string>
  normal_word: string
}

export type ImpostorGameState = Omit<BaseGameState, "mode"> & {
  mode: "impostor"
  role: ImpostorRole
  active_players: Record<string, boolean>
  current_player: string
  rounds: ImpostorRound[]
  current_round: number
  intermediate_voted_out?: string
  intermediate_message?: string
}

/**
 * Live vote snapshot broadcast each time any player casts a vote.
 * Mirrors Go's ImpostorVoteUpdatePayload.
 */
export type ImpostorVoteUpdate = {
  /** Current votes keyed by voter UUID; null value = skip vote. */
  votes: Record<string, string | null>
}
