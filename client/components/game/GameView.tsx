"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useLobbyContext } from "@/hooks/lobbycontext";
// import { useGameContext } from "@/hooks/gamecontext";

import { ContextoGameView } from "./gamemodes/ContextoGameView";
import { SynonymDuelView } from "./gamemodes/SynonymDuelView";
import { AntiMatchView } from "./gamemodes/AntiMatchView";
import { MainImpostorView } from "./gamemodes/MainImposterView";
import { useNewGameContext } from "@/hooks/newgamecontext";

export function GameView() {
  const { phase } = useLobbyContext();
  const { game } = useNewGameContext();
  const router = useRouter();

  useEffect(() => {
    if (phase !== "game_started") router.push("/");
  }, [phase, router]);

  return (
    <div className="w-full px-8 pt-5">
      {game.mode === "impostor" && <MainImpostorView />}
      {game.mode === "anti_match" && <AntiMatchView />}
      {/* {game.mode === "contexto_battle" && <ContextoGameView />} */}
      {/* {activeMode === "synonym_duel" && <SynonymDuelView />} */}
    </div>
  );
}
