"use client";

import { useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { GetReadyScreen } from "@/components/game/GetReadyScreen";
import CountdownBar from "../CountdownBar";
import { RoundResultPhase } from "../antimatch/RoundResultPhase";
import { InputPhase } from "../antimatch/InputPhase";
import { useAntiMatchGame } from "@/hooks/newgamecontext";
import { usePhaseCountdown, usePhaseReady } from "@/hooks/timers";

export function AntiMatchView() {
  const game = useAntiMatchGame();

  const isReady = usePhaseReady();
  const remainingMs = usePhaseCountdown();

  if (!isReady) return <GetReadyScreen remainingMs={remainingMs} />;

  const phase = game.phase;

  return (
    <div className="w-full space-y-6">
      {phase === "input" && <CountdownBar />}
      <AnimatePresence mode="wait">
        {phase === "input" && <InputPhase />}
        {phase === "round_result" && <RoundResultPhase />}
        {/* {phase === "result" && <FinalScorePhase />} */}
      </AnimatePresence>
    </div>
  );
}
