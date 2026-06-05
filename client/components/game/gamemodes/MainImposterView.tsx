"use client";

import { AnimatePresence } from "framer-motion";
// import { useImpostorGame, usePhaseCountdown, usePhaseReady } from "@/hooks/gamecontext";
import { useImpostorGame } from "@/hooks/newgamecontext";
import { GetReadyScreen } from "@/components/game/GetReadyScreen";
import { RevealPhase } from "../impostor/RevealPhase";
import { DiscussionPhase } from "../impostor/DiscussionPhase";
import { InputPhase } from "../impostor/InputPhase";
import { VotePhase } from "../impostor/VotePhase";
import { IntermediatePhase } from "../impostor/IntermediatePhase";
import CountdownBar from "../CountdownBar";
import { usePhaseCountdown, usePhaseReady } from "@/hooks/timers";

export const MainImpostorView = () => {
  const game = useImpostorGame();

  const isReady = usePhaseReady();
  const remainingMs = usePhaseCountdown();

  if (!isReady) return <GetReadyScreen remainingMs={remainingMs} />;

  const phase = game.phase;
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
