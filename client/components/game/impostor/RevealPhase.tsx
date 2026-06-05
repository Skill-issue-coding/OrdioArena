"use client";

import PhaseTransition from "../PhaseTransition";
import { HatGlasses, Users } from "lucide-react";
// import { useImpostorGame } from "@/hooks/gamecontext";
import { useImpostorGame } from "@/hooks/newgamecontext";
import { cn } from "@/lib/utils";

export function RevealPhase() {
  const game = useImpostorGame();
  const isImpostor = game.role === "impostor";

  return (
    <PhaseTransition phaseKey="reveal">
      <div className="flex justify-center w-full mb-3">{isImpostor ? <HatGlasses className="stroke-[2.5] size-12" /> : <Users className="stroke-[2.5] size-12" />}</div>
      <p className={cn("text-sm mb-4 uppercase tracking-wider font-display font-bold whitespace-pre-line text-center", isImpostor ? "text-destructive animate-pulse" : "text-muted-foreground")}>
        {isImpostor ? "Du är impostern! \n Här är ditt ledtrådsord" : "Ditt hemliga ord"}
      </p>
      <div className={cn("game-card mb-6 py-10 border-2", isImpostor ? "border-destructive" : "border-game-green")}>
        <h2 className={cn("font-display text-6xl font-bold", isImpostor ? "text-destructive" : "text-game-green")}>{game.word}</h2>
      </div>
      <p className="mb-6 text-sm font-semibold text-center text-muted-foreground font-display">{isImpostor ? "Försök lista ut vad de andra pratar om utan att bli påkommen!" : "Kom ihåg ordet! Låt inte imposters få reda på det."}</p>
    </PhaseTransition>
  );
}
