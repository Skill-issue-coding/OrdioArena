import type { GameTimers } from "@/hooks/game/timers/types"

type AntiMatchPlayerResult = {
  word: string
  score: number
  is_duplicate: boolean
  total_score: number
}

type AntiMatchInputPhasePayload = GameTimers & {
  phase: "input"
  target_word: string
  current_round: number
  total_rounds: number
}

type AntiMatchSubmissionUpdatePayload = {
  player_id: string
  has_submitted: boolean
}

type AntiMatchRoundResultPayload = GameTimers & {
  phase: "round_result"
  target_word: string
  results: Record<string, AntiMatchPlayerResult>
  winner?: string
  current_round: number
  total_rounds: number
}

type AntiMatchGameResultPayload = {
  total_scores: Record<string, number>
}

export type AntiMatchWSReceivedEvent =
  | { type: "antimatch_input_phase"; payload: AntiMatchInputPhasePayload }
  | { type: "antimatch_submission_update"; payload: AntiMatchSubmissionUpdatePayload }
  | { type: "antimatch_round_result"; payload: AntiMatchRoundResultPayload }
  | { type: "game_result"; payload: AntiMatchGameResultPayload }
