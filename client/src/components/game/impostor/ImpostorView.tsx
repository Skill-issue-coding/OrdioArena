"use client"

import { AnimatePresence } from "motion/react"
import { GetReadyScreen } from "@/components/game/GetReadyScreen"
import { useImpostorGame } from "@/hooks/game/Hook"
import { usePhaseCountdown, usePhaseReady } from "@/hooks/game/timers/Timers"
import { CountDownBar } from "@/components/game/CountDownBar"
import { DiscussionPhase } from "./phases/DiscussionPhase"
import { InputPhase } from "./phases/InputPhase"
import { IntermediatePhase } from "./phases/IntermediatePhase"
import { RevealPhase } from "./phases/RevealPhase"
import { VotePhase } from "./phases/VotePhase"

export const MainImpostorView = () => {
  const game = useImpostorGame()

  const isReady = usePhaseReady()
  const remainingMs = usePhaseCountdown()

  if (!isReady) return <GetReadyScreen remainingMs={remainingMs} />

  const phase = game.phase
  const show_countdown = phase !== "show_word" && phase !== "intermediate"

  return (
    <div className="w-full space-y-6">
      {show_countdown && <CountDownBar />}
      <AnimatePresence mode="wait">
        {phase === "show_word" && <RevealPhase key="reveal" />}
        {phase === "input" && <InputPhase key="input" />}
        {phase === "discussion" && <DiscussionPhase key="discussion" />}
        {phase === "vote" && <VotePhase key="vote" />}
        {phase === "intermediate" && <IntermediatePhase key="intermediate" />}
      </AnimatePresence>
    </div>
  )
}
