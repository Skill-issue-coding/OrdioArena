"use client";

import { AnimatePresence } from "framer-motion";
import { useImpostorGame, usePhaseCountdown, usePhaseReady } from "@/hooks/gamecontext";
import { GetReadyScreen } from "@/components/game/GetReadyScreen";
import { RevealPhase } from "../impostor/RevealPhase";
import { DiscussionPhase } from "../impostor/DiscussionPhase";
import { InputPhase } from "../impostor/InputPhase";
import { VotePhase } from "../impostor/VotePhase";
import { ResultPhase } from "../impostor/ResultPhase";
import { IntermediatePhase } from "../impostor/IntermediatePhase";
import CountdownBar from "../CountdownBar";

export const MainImpostorView = () => {
  const game = useImpostorGame();

  const readyTime = game?.phaseState?.timers?.ready_time;
  const isReady = usePhaseReady(readyTime);
  const remainingMs = usePhaseCountdown(readyTime);

  // gamecontext preserves `result` across phase resets and builds gameState whenever
  // result is non-null, so this check is always stable regardless of render ordering.
  if (game?.result) {
    return (
      <div className="w-full space-y-6">
        <AnimatePresence mode="wait">
          <ResultPhase key="result" />
        </AnimatePresence>
      </div>
    );
  }

  if (!isReady) return <GetReadyScreen remainingMs={remainingMs} />;
  if (!game || !game.phaseState) return null;

  const phase = game.voteResult ? "intermediate" : game.phaseState.game_phase;
  const show_countdown = phase !== "show_word" && phase !== "intermediate";

  return (
    <div className="w-full space-y-6">
      {show_countdown && <CountdownBar />}
      <AnimatePresence mode="wait">
        {phase === "show_word" && <RevealPhase key="reveal" />}
        {phase === "input" && <InputPhase key="input" />}
        {phase === "discussion" && <DiscussionPhase key="discussion" />}
        {phase === "vote" && <VotePhase key="vote" />}
        {phase === "intermediate" && <IntermediatePhase key="intermediate" />}
      </AnimatePresence>
    </div>
  );
};
