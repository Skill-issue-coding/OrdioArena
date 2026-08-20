"use client"

import { AnimatePresence } from "motion/react"
import { GetReadyScreen } from "@/components/game/GetReadyScreen"
import { useAntiMatchGame } from "@/hooks/game/Hook"
import { usePhaseCountdown, usePhaseReady } from "@/hooks/game/timers/Timers"
import { InputPhase } from "./phases/InputPhase"
import { RoundResultPhase } from "./phases/RoundResultPhase"
import { CountDownBar } from "../CountDownBar"

export function AntiMatchView() {
  const game = useAntiMatchGame()

  const isReady = usePhaseReady()
  const remainingMs = usePhaseCountdown()

  if (!isReady) return <GetReadyScreen remainingMs={remainingMs} />

  const phase = game.phase

  return (
    <div className="w-full space-y-6">
      {phase === "input" && <CountDownBar />}
      <AnimatePresence mode="wait">
        {phase === "input" && <InputPhase />}
        {phase === "round_result" && <RoundResultPhase />}
        {/* {phase === "result" && <FinalScorePhase />} */}
      </AnimatePresence>
    </div>
  )
}
