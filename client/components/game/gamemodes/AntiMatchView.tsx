"use client";

import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useAntiMatchGame, usePhaseCountdown, usePhaseReady } from "@/hooks/gamecontext";
import { GetReadyScreen } from "@/components/game/GetReadyScreen";
import CountdownBar from "../CountdownBar";
import { RoundResultPhase } from "../antimatch/RoundResultPhase";
import { FinalScorePhase } from "../antimatch/FinalScorePhase";
import { InputPhase } from "../antimatch/InputPhase";
import { useRouter } from "next/navigation";
import { useLobbyContext } from "@/hooks/lobbycontext";

export function AntiMatchView() {
  const game = useAntiMatchGame();
  const { code } = useLobbyContext();
  const router = useRouter();

  const readyTime = game?.phaseState?.timers?.ready_time;

  const isReady = usePhaseReady(readyTime);
  const remainingMs = usePhaseCountdown(readyTime);

  useEffect(() => {
    if (game?.resultState) router.push(`/lobby/${code}/game/result`);
  }, [game?.resultState]);

  if (!game || !game.phaseState) return null;

  const currentPhase = game.phaseState.game_phase;

  const needsReadyScreen = !isReady && currentPhase === "input";

  if (needsReadyScreen) return <GetReadyScreen remainingMs={remainingMs} />;

  if (!isReady) return <GetReadyScreen remainingMs={remainingMs} />;

  //const phase = game.phaseState.game_phase;

  return (
    <div className="w-full space-y-6">
      {/*phase !== "show_word" && phase !== "final_score" && phase !== "round_result" && <CountdownBar />*/}
      {currentPhase === "input" && <CountdownBar />}
      <AnimatePresence mode="wait">
        {/*phase === "input" && <InputPhase />*/}
        {/*phase === "round_result" && <RoundResultPhase />*/}
        {/*phase === "final_score" && <FinalScorePhase />*/}
        {currentPhase === "input" && <InputPhase />}
        {currentPhase === "round_result" && <RoundResultPhase />}
        {/* {currentPhase === "result" && <FinalScorePhase />} */}
      </AnimatePresence>
    </div>
  );
}
