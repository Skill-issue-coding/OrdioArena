"use client";

import { FinalScorePhase } from "@/components/game/antimatch/FinalScorePhase";
import { AnimatePresence } from "framer-motion";
import { ResultPhase } from "@/components/game/impostor/ResultPhase";
import { useNewGameContext } from "@/hooks/newgamecontext";

export default function ResultPage() {
  const { result } = useNewGameContext();

  if (!result) return null;

  const isAntiMatch = "total_scores" in result;
  return (
    <div className="w-full px-8 pt-5">
      <div className="w-full space-y-6">
        <AnimatePresence mode="wait">
          {isAntiMatch ? <FinalScorePhase key="result" /> : <ResultPhase key="result" />}
        </AnimatePresence>
      </div>
    </div>
  );
}
