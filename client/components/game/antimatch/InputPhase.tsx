"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import { Check, Send } from "lucide-react";
import { PlayerAvatar } from "@/components/lobby/PlayerList";
import { Button } from "@/components/ui/button";
import { useGameContext } from "@/hooks/gamecontext";
import { useLobbyContext } from "@/hooks/lobbycontext";
import { useUserContext } from "@/hooks/usercontext";
import { useWebsocketContext } from "@/hooks/websocketcontext";
import { isStringEmptyOrOnlySpaces } from "@/lib/utils";
import { ToastError } from "@/lib/toast-functions";
import { motion } from "framer-motion";

export function InputPhase() {
  const [inputValue, setInputValue] = useState("");
  const { gameState } = useGameContext();
  const { users } = useLobbyContext();
  const { user } = useUserContext();
  const { sendEvent } = useWebsocketContext();

  if (gameState?.mode !== "anti_match" || !gameState.phaseState || !users || !user) return null;

  const targetWord = gameState.phaseState.target_word;
  const submissions = gameState.phaseState.submissions ?? {};
  const hasSubmitted = submissions[user.user_id] ?? false;

  const sendWordSubmission = () => {
    if (hasSubmitted) return;
    if (isStringEmptyOrOnlySpaces(inputValue) || inputValue.length > 128) {
      ToastError("Skriv in ett ord");
      return;
    }
    sendEvent("game_submit_word", { word: inputValue.trim().toLowerCase() });
  };

  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto mt-8 relative z-10">
      <div className="text-center mb-8">
        <p className="font-display text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Målord</p>
        <h1 className="font-display text-6xl font-extrabold text-game-green tracking-tight mb-4">{targetWord}</h1>
        <p className="font-body font-semibold text-muted-foreground">
          Var närmast — men <span className="text-foreground font-bold">unik</span>. Dubbletter ger 0 poäng.
        </p>
      </div>
      <div className="w-full mb-10 h-28 relative perspective-[1000px]">
        <motion.div
          className="w-full h-full relative transform-3d"
          initial={false}
          animate={{
            rotateX: hasSubmitted ? -180 : 0,
            scale: hasSubmitted ? [1, 1.08, 1] : 1,
          }}
          transition={{
            duration: 0.6,
            rotateX: { type: "spring", bounce: 0.3, duration: 0.6 },
            scale: { type: "tween", times: [0, 0.5, 1], ease: "easeInOut", duration: 0.6 },
          }}>
          <div className="absolute inset-0 backface-hidden flex gap-2 game-card">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  sendWordSubmission();
                }
              }}
              placeholder="Skriv ett relaterat ord..."
              autoFocus
              disabled={hasSubmitted}
              className="w-full h-full text-center font-display font-bold text-xl px-4 border-2 border-primary rounded-lg bg-muted shadow-sm focus:outline-none focus:ring-4 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/50 disabled:opacity-50"
            />
            <Button onClick={sendWordSubmission} disabled={!inputValue.trim() || hasSubmitted} className="h-full aspect-square shrink-0 rounded-lg" aria-label="Skicka meddelande">
              <Send className="size-6" />
            </Button>
          </div>
          <div className="absolute inset-0 backface-hidden transform-[rotateX(-180deg)] flex items-center justify-center game-card border-game-green bg-game-green/10">
            <div className="flex items-center gap-3">
              <Check className="w-8 h-8 text-game-green" strokeWidth={4} />
              <span className="font-display font-extrabold text-3xl text-game-green">{inputValue}</span>
            </div>
          </div>
        </motion.div>
      </div>
      <div className="flex items-center justify-center gap-4">
        {Object.values(users).map((p) => {
          const isSubmitted = submissions[p.user_id];
          const isSelf = p.user_id === user.user_id;

          return (
            <div key={p.user_id} className="relative flex flex-col items-center">
              <div className={!isSubmitted && !isSelf ? "opacity-50 transition-opacity" : ""}>
                <PlayerAvatar name={p.username} color={p.background} className="w-10 h-10 border-3 font-display font-bold" />
              </div>
              {isSubmitted && (
                <div className="absolute -bottom-6 w-5 h-5 rounded-full flex items-center justify-center">
                  <Check className="w-4 h-4 text-game-green" strokeWidth={4} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
