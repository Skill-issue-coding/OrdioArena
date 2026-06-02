"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useLobbyContext } from "@/hooks/lobbycontext";
import { useGameContext } from "@/hooks/gamecontext";

import { ContextoGameView } from "./gamemodes/ContextoGameView";
import { SynonymDuelView } from "./gamemodes/SynonymDuelView";
import { AntiMatchView } from "./gamemodes/AntiMatchView";
import { MainImpostorView } from "./gamemodes/MainImposterView";
import { GameMode } from "@/lib/game/types";

// --- Fake data toggle ---
const FAKE_MODE: GameMode = "anti_match";

export function GameView() {
  const { mode } = useLobbyContext();
  const { gameState } = useGameContext();
  const router = useRouter();
  const activeMode = mode ?? gameState?.mode ?? null;

  useEffect(() => {
    if (!activeMode) router.push("/");
  }, [activeMode, router]);

  if (!activeMode) return null;

  return (
    <div className="w-full px-8 pt-5">
      {activeMode === "impostor" && <MainImpostorView />}
      {activeMode === "contexto_battle" && <ContextoGameView />}
      {activeMode === "synonym_duel" && <SynonymDuelView />}
      {activeMode === "anti_match" && <AntiMatchView />}
    </div>
  );
}
