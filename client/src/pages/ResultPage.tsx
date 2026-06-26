import { FinalScorePhase } from "@/components/game/antimatch/phases/FinalScorePhase"
import { ResultPhase } from "@/components/game/impostor/phases/ResultPhase"
import { useGameContext } from "@/hooks/game/Hook"
import { AnimatePresence } from "motion/react"

export function ResultPage() {
  const { result } = useGameContext()

  if (!result) return null

  const isAntiMatch = "total_scores" in result
  return (
    <div className="w-full px-8 pt-5">
      <div className="w-full space-y-6">
        <AnimatePresence mode="wait">{isAntiMatch ? <FinalScorePhase key="result" /> : <ResultPhase key="result" />}</AnimatePresence>
      </div>
    </div>
  )
}
