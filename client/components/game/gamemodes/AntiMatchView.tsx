"use client";

import { useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { GetReadyScreen } from "@/components/game/GetReadyScreen";
import CountdownBar from "../CountdownBar";
import { RoundResultPhase } from "../antimatch/RoundResultPhase";
import { FinalScorePhase } from "../antimatch/FinalScorePhase";
import { InputPhase } from "../antimatch/InputPhase";
import { useRouter } from "next/navigation";
import { useLobbyContext } from "@/hooks/lobbycontext";
import { useAntiMatchGame, useNewGameContext } from "@/hooks/newgamecontext";
import { usePhaseCountdown, usePhaseReady } from "@/hooks/timers";

export function AntiMatchView() {
  const game = useAntiMatchGame();
  const { result } = useNewGameContext();
  const { code } = useLobbyContext();
  const router = useRouter();

  const isReady = usePhaseReady();
  const remainingMs = usePhaseCountdown();

  useEffect(() => {
    if (result) router.push(`/lobby/${code}/game/result`);
  }, [result]);

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
