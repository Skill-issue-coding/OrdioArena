import { useEffect, useRef, useState } from "react"
import { useGameContext } from "@/hooks/game/Hook"
import type { GameTimers } from "./types"

export const toTimers = (p: { start_time: number; ready_time: number; end_time: number }): GameTimers => ({
  start_time: p.start_time,
  ready_time: p.ready_time,
  end_time: p.end_time,
})

export function usePhaseCountdown(): number {
  const { game } = useGameContext()
  const readyTime = game.timers.ready_time
  const [remaining, setRemaining] = useState(() => Math.max(0, readyTime - Date.now()))
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (Date.now() >= readyTime) {
      setRemaining(0)
      return
    }
    const tick = () => {
      const ms = Math.max(0, readyTime - Date.now())
      setRemaining(ms)
      if (ms === 0 && intervalRef.current) clearInterval(intervalRef.current)
    }
    intervalRef.current = setInterval(tick, 50)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [readyTime])

  return remaining
}

export const usePhaseReady = (): boolean => usePhaseCountdown() === 0
