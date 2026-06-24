import type { GameTimers } from "./timers/types"

export type GameMode = "impostor" | "anti_match" | "contexto_battle" | "synonym_duel"

export type GamePhase = "show_word" | "input" | "discussion" | "vote" | "round_result" | "intermediate" | "game_result"

export type BaseGameState = {
  mode: GameMode
  word: string
  timers: GameTimers
  phase: GamePhase
}
