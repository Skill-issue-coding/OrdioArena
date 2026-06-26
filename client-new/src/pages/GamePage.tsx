import { useEffect } from "react"
import { useNavigate } from "@tanstack/react-router"

import { useGameContext } from "@/hooks/game/Hook"
import { useLobbyContext } from "@/hooks/lobby/Hook"
import { MainImpostorView } from "@/components/game/impostor/ImpostorView"
import { AntiMatchView } from "@/components/game/antimatch/AntiMatchView"
// import { ContextoGameView } from "./contexto/ContextoGameView"
// import { SynonymDuelView } from "./gamemodes/SynonymDuelView"

export function GamePage() {
  const { phase } = useLobbyContext()
  const { game } = useGameContext()
  const router = useNavigate()

  useEffect(() => {
    if (phase !== "game_started") router({ to: "/" })
  }, [phase, router])

  if (!game.timers.start_time) return null

  return (
    <div className="w-full px-8 pt-5">
      {game.mode === "impostor" && <MainImpostorView />}
      {game.mode === "anti_match" && <AntiMatchView />}
      {/* {game.mode === "contexto_battle" && <ContextoGameView />} */}
      {/* {activeMode === "synonym_duel" && <SynonymDuelView />} */}
    </div>
  )
}
