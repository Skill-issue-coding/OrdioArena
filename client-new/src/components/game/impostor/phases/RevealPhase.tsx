"use client"

import { HatGlasses, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import PhaseTransition from "@/components/game/PhaseTransition"
import { useImpostorGame } from "@/hooks/game/Hook"

export function RevealPhase() {
  const game = useImpostorGame()
  const isImpostor = game.role === "impostor"

  return (
    <PhaseTransition phaseKey="reveal">
      <div className="mb-3 flex w-full justify-center">{isImpostor ? <HatGlasses className="size-12 stroke-[2.5]" /> : <Users className="size-12 stroke-[2.5]" />}</div>
      <p className={cn("mb-4 text-center font-display text-sm font-bold tracking-wider whitespace-pre-line uppercase", isImpostor ? "animate-pulse text-destructive" : "text-muted-foreground")}>
        {isImpostor ? "Du är impostern! \n Här är ditt ledtrådsord" : "Ditt hemliga ord"}
      </p>
      <div className={cn("game-card mb-6 border-2 py-10", isImpostor ? "border-destructive" : "border-game-green")}>
        <h2 className={cn("font-display text-6xl font-bold", isImpostor ? "text-destructive" : "text-game-green")}>{game.word}</h2>
      </div>
      <p className="mb-6 text-center font-display text-sm font-semibold text-muted-foreground">{isImpostor ? "Försök lista ut vad de andra pratar om utan att bli påkommen!" : "Kom ihåg ordet! Låt inte imposters få reda på det."}</p>
    </PhaseTransition>
  )
}
