import type { GameTimers } from "@/hooks/game/timers/types"

type ImpostorRole = "normal" | "impostor"

type ImpostorCycle = {
  submissions: Record<string, string>
  votes: Record<string, string | null>
}

type ImpostorGameStartedPayload = GameTimers & {
  phase: string
  active_players: Record<string, boolean>
  current_round: number
  role: ImpostorRole
  word: string
}

type ImpostorInputPhasePayload = GameTimers & {
  phase: "input"
  current_player: string
}

type ImpostorSubmissionUpdatePayload = {
  player_id: string
  word: string
}

type ImpostorDiscussionPhasePayload = GameTimers & {
  phase: "discussion"
  submissions: Record<string, string>
}

type ImpostorVotePhasePayload = GameTimers & {
  phase: "vote"
}

type ImpostorVoteUpdatePayload = {
  player_id: string
  target: string | null
}

type ImpostorIntermediatePayload = GameTimers & {
  phase: "intermediate"
  voted_out?: string
  message: string
  active_players: Record<string, boolean>
}

type ImpostorRoundUpdatePayload = {
  rounds: ImpostorCycle[]
}

type ImpostorGameResultPayload = {
  cycles: ImpostorCycle[]
  winners: string[]
  roles: Record<string, ImpostorRole>
  words: Record<string, string>
  normal_word: string
}

export type ImpostorWSReceivedEvent =
  | { type: "impostor_game_started"; payload: ImpostorGameStartedPayload }
  | { type: "impostor_input_phase"; payload: ImpostorInputPhasePayload }
  | { type: "impostor_submission_update"; payload: ImpostorSubmissionUpdatePayload }
  | { type: "impostor_discussion_phase"; payload: ImpostorDiscussionPhasePayload }
  | { type: "impostor_vote_phase"; payload: ImpostorVotePhasePayload }
  | { type: "impostor_vote_update"; payload: ImpostorVoteUpdatePayload }
  | { type: "impostor_intermediate"; payload: ImpostorIntermediatePayload }
  | { type: "impostor_round_update"; payload: ImpostorRoundUpdatePayload }
  | { type: "game_result"; payload: ImpostorGameResultPayload }
