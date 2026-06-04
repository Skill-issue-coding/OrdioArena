"use client";

import { FinalScorePhase } from "@/components/game/antimatch/FinalScorePhase";
import { AnimatePresence } from "framer-motion";
import { useLobbyContext } from "@/hooks/lobbycontext";
import { ResultPhase } from "@/components/game/impostor/ResultPhase";

export default function ResultPage() {
  const { mode } = useLobbyContext();
  if (mode === "anti_match")
    return (
      <div className="w-full px-8 pt-5">
        <div className="w-full space-y-6">
          <AnimatePresence mode="wait">
            <FinalScorePhase key="result" />
          </AnimatePresence>
        </div>
      </div>
    );
  else
    return (
      <div className="w-full px-8 pt-5">
        <div className="w-full space-y-6">
          <AnimatePresence mode="wait">
            <ResultPhase key="result" />
          </AnimatePresence>
        </div>
      </div>
    );
}
