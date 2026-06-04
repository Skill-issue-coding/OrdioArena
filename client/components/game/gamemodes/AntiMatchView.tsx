"use client";

import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useAntiMatchGame, usePhaseCountdown, usePhaseReady } from "@/hooks/gamecontext";
import { GetReadyScreen } from "@/components/game/GetReadyScreen";
import CountdownBar from "../CountdownBar";
import { RoundResultPhase } from "../antimatch/RoundResultPhase";
import { FinalScorePhase } from "../antimatch/FinalScorePhase";
import { InputPhase } from "../antimatch/InputPhase";

type PhaseType = "input" | "round_result" | "final_score" | "show_word";

export function AntiMatchView() {
  const [phase, setPhase] = useState<PhaseType>("input");
  const game = useAntiMatchGame();

  const readyTime = game?.phaseState?.timers?.ready_time;
  const isReady = usePhaseReady(readyTime);
  const remainingMs = usePhaseCountdown(readyTime);

  console.log(game);

  // TODO: Later, handle the result phase
  // if (game?.result) return <FinalScorePhase />;

  if (!isReady) return <GetReadyScreen remainingMs={remainingMs} />;

  if (!game || !game.phaseState) return null;

  //const phase = game.phaseState.game_phase;

  return (
    <div className="w-full space-y-6">
      {phase !== "show_word" && phase !== "final_score" && phase !== "round_result" && <CountdownBar />}
      <AnimatePresence mode="wait">
        {phase === "input" && <InputPhase />}
        {phase === "round_result" && <RoundResultPhase />}
        {phase === "final_score" && <FinalScorePhase />}
      </AnimatePresence>
    </div>
  );
}
