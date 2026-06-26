import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { AntiMatchGameState, AntiMatchResult } from "./antimatch/types"
import type { ImpostorGameState, ImpostorRole } from "./impostor/types"
import type { GameTimers } from "./timers/types"
import type { GameMode, GamePhase } from "./types"
import { useLobbyContext } from "../lobby/Hook"
import { useWebsocketContext } from "../websocket/Hook"
import { useNavigate } from "@tanstack/react-router"
import { toTimers } from "./timers/Timers"
import { log } from "@/lib/logger"

// Wire payload shape for impostor result (differs from legacy ImpostorGameResult type)
export type ImpostorGameResultPayload = {
  cycles: { submissions: Record<string, string>; votes: Record<string, string | null> }[]
  winners: string[]
  roles: Record<string, ImpostorRole>
  words: Record<string, string>
  normal_word: string
}

export type ActiveGame = {
  game: ImpostorGameState | AntiMatchGameState
  result: ImpostorGameResultPayload | AntiMatchResult | null
}

const defaultTimers: GameTimers = { start_time: 0, ready_time: 0, end_time: 0 }

const DefaultEmptyGame = (mode: GameMode): ImpostorGameState | AntiMatchGameState => {
  const base = { word: "", timers: defaultTimers, phase: "show_word" as GamePhase, active_players: {} as Record<string, boolean>, current_round: 0 }
  if (mode === "impostor") {
    return { ...base, mode: "impostor", role: "normal", current_player: "", rounds: [] }
  }
  return { ...base, mode: "anti_match", rounds: [], total_rounds: 0 }
}

export const NewGameContext = createContext<ActiveGame>({ game: DefaultEmptyGame("impostor"), result: null })

export function useGameContext(): ActiveGame {
  const ctx = useContext(NewGameContext)
  if (!ctx) throw new Error("useGameContext must be used within a NewGameContextProvider")
  return ctx
}

export function useImpostorGame(): ImpostorGameState {
  const { game } = useGameContext()
  if (game.mode !== "impostor") throw new Error("Invalid use of useImpostorGame, mode must be Impostor in order to useImpostorGame")
  return game
}

export function useAntiMatchGame(): AntiMatchGameState {
  const { game } = useGameContext()
  if (game.mode !== "anti_match") throw new Error("Invalid use of useAntiMatchGame, mode must be AntiMatch in order to useAntiMatchGame")
  return game
}

export function GameContextProvider({ children }: { children: ReactNode }) {
  const { mode, code } = useLobbyContext()
  const { subscribe } = useWebsocketContext()
  const navigate = useNavigate()

  const [gameState, setGameState] = useState<ActiveGame["game"]>(DefaultEmptyGame(mode ?? "impostor"))
  const [gameResult, setGameResult] = useState<ActiveGame["result"]>(null)

  useEffect(() => {
    setGameState(DefaultEmptyGame(mode ?? "impostor"))

    const unsubs: (() => void)[] = []

    if (mode === "impostor") {
      unsubs.push(
        subscribe("impostor_game_started", (p) => {
          log.game.info("impostor game started", { round: p.current_round, phase: p.phase })
          setGameState({
            mode: "impostor",
            word: p.word,
            role: p.role,
            timers: toTimers(p),
            phase: p.phase as GamePhase,
            active_players: p.active_players,
            current_round: p.current_round,
            current_player: "",
            rounds: [{ submissions: {}, votes: {} }],
          })
          navigate({ to: `/lobby/${code}/game` })
        })
      )

      unsubs.push(
        subscribe("impostor_input_phase", (p) => {
          setGameState((prev) => ({ ...prev, timers: toTimers(p), phase: p.phase, current_player: p.current_player }))
        })
      )

      unsubs.push(
        subscribe("impostor_submission_update", (p) => {
          setGameState((prev) => {
            if (prev.mode !== "impostor") return prev
            return {
              ...prev,
              rounds: prev.rounds.map((r, i) => (i === prev.current_round ? { ...r, submissions: { ...r.submissions, [p.player_id]: p.word } } : r)),
            }
          })
        })
      )

      unsubs.push(
        subscribe("impostor_discussion_phase", (p) => {
          setGameState((prev) => {
            if (prev.mode !== "impostor") return prev
            return {
              ...prev,
              timers: toTimers(p),
              phase: p.phase,
              rounds: prev.rounds.map((r, i) => (i === prev.current_round ? { ...r, submissions: p.submissions } : r)),
            }
          })
        })
      )

      unsubs.push(
        subscribe("impostor_vote_phase", (p) => {
          setGameState((prev) => ({ ...prev, timers: toTimers(p), phase: p.phase }))
        })
      )

      unsubs.push(
        subscribe("impostor_vote_update", (p) => {
          setGameState((prev) => {
            if (prev.mode !== "impostor") return prev
            return {
              ...prev,
              rounds: prev.rounds.map((r, i) => (i === prev.current_round ? { ...r, votes: { ...r.votes, [p.player_id]: p.target } } : r)),
            }
          })
        })
      )

      unsubs.push(
        subscribe("impostor_intermediate", (p) => {
          setGameState((prev) => ({
            ...prev,
            timers: toTimers(p),
            phase: p.phase,
            active_players: p.active_players,
            intermediate_voted_out: p.voted_out ?? undefined,
            intermediate_message: p.message,
          }))
        })
      )

      // Full cycle history snapshot — sent at start of each new cycle.
      // Sets current_round to the last index (new empty cycle appended by server).
      unsubs.push(
        subscribe("impostor_round_update", (p) => {
          setGameState((prev) => {
            if (prev.mode !== "impostor") return prev
            return { ...prev, rounds: p.rounds, current_round: p.rounds.length - 1 }
          })
        })
      )
    }

    if (mode === "anti_match") {
      unsubs.push(
        subscribe("antimatch_input_phase", (p) => {
          log.game.info("antimatch input phase", { round: p.current_round, totalRounds: p.total_rounds, target: p.target_word })
          setGameState((prev) => {
            if (prev.mode !== "anti_match") return prev
            const roundIdx = p.current_round - 1 // server sends 1-indexed
            const rounds = [...prev.rounds]
            while (rounds.length <= roundIdx) rounds.push({ has_submitted: {}, submissions: {} })
            return {
              ...prev,
              timers: toTimers(p),
              phase: p.phase as GamePhase,
              word: p.target_word,
              current_round: roundIdx,
              total_rounds: p.total_rounds,
              rounds,
            }
          })
        })
      )

      unsubs.push(
        subscribe("antimatch_submission_update", (p) => {
          setGameState((prev) => {
            if (prev.mode !== "anti_match") return prev
            return {
              ...prev,
              rounds: prev.rounds.map((r, i) => (i === prev.current_round ? { ...r, has_submitted: { ...r.has_submitted, [p.player_id]: p.has_submitted } } : r)),
            }
          })
        })
      )

      unsubs.push(
        subscribe("antimatch_round_result", (p) => {
          log.game.info("antimatch round result", { round: p.current_round, winner: p.winner })
          setGameState((prev) => {
            if (prev.mode !== "anti_match") return prev
            const roundIdx = p.current_round - 1
            const rounds = [...prev.rounds]
            while (rounds.length <= roundIdx) rounds.push({ has_submitted: {}, submissions: {} })
            rounds[roundIdx] = {
              ...rounds[roundIdx],
              winner: p.winner,
              submissions: Object.fromEntries(Object.entries(p.results).map(([id, r]) => [id, { word: r.word, word_score: r.score, is_duplicate: r.is_duplicate }])),
            }
            return { ...prev, timers: toTimers(p), phase: p.phase as GamePhase, rounds }
          })
        })
      )
    }

    unsubs.push(
      subscribe("game_result", (p) => {
        log.game.info("game result received", { mode })
        setGameResult(p as unknown as ActiveGame["result"])
        navigate({ to: `/lobby/${code}/game/result` })
      })
    )

    unsubs.push(
      subscribe("game_started", () => {
        log.game.info("game started", { mode })
        setGameResult(null)
        setGameState(DefaultEmptyGame(mode ?? "impostor"))
        if (mode !== "impostor") navigate({ to: `/lobby/${code}/game` })
      })
    )

    return () => unsubs.forEach((u) => u())
  }, [subscribe, mode, navigate])

  return <NewGameContext.Provider value={{ game: gameState, result: gameResult }}>{children}</NewGameContext.Provider>
}
