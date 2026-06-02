"use client";

import { ArrowLeft, Play, BookOpenText, Loader2, UserRoundX } from "lucide-react";
import Link from "next/link";
import { PlayerList } from "@/components/lobby/PlayerList";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { snapIn } from "@/lib/animation-util";
import { useState, useEffect } from "react";
import { useUserContext } from "@/hooks/usercontext";
import { useLobbyContext } from "@/hooks/lobbycontext";
import { useWebsocketContext } from "@/hooks/websocketcontext";
import { cn } from "@/lib/utils";
import { GAME_MODES } from "@/lib/game/gameModes";
import { ToastError } from "@/lib/toast-functions";
import RoomCodeDisplay from "./CodeDisplay";
import { GameModeSelector, GameSettings } from "./GameSettings";

export default function LobbyView({ code }: { code: string }) {
  const { user } = useUserContext();
  const { host, users, mode } = useLobbyContext();
  const { sendEvent, connectionStatus } = useWebsocketContext();
  const [hasAttemptedJoin, setHasAttemptedJoin] = useState(false);

  useEffect(() => {
    if (!code || typeof code !== "string") return;

    if (connectionStatus === "connected" && user && !host && !hasAttemptedJoin) {
      setHasAttemptedJoin(true);
      sendEvent("join_lobby", { lobby_code: code });
    }
  }, [connectionStatus, user, host, code, hasAttemptedJoin, sendEvent]);

  if (!user || !host) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6">
        <Loader2 className="w-10 h-10 mb-4 animate-spin text-game-purple" />
        <p className="flex mb-6 font-semibold font-display text-muted-foreground">
          Ansluter till rummet
          <span className="flex w-6">
            <span className="animate-[loading_1.4s_infinite] ml-0.5">.</span>
            <span className="animate-[loading_1.4s_infinite_0.2s] ml-0.5">.</span>
            <span className="animate-[loading_1.4s_infinite_0.4s] ml-0.5">.</span>
          </span>
        </p>
        <Link href="/">
          <Button variant="outline" className="font-bold font-body">
            Avbryt
          </Button>
        </Link>
      </div>
    );
  }

  const hostUser = users && host ? users[host] : null;
  const hostName = hostUser?.username;
  const handleLeave = () => sendEvent("leave_lobby", null);

  const isHost = host === user.user_id;

  const handleStartGame = () => {
    if (!isHost) {
      ToastError("Endast hosten kan starta spelet.");
      return;
    }
    sendEvent("start_game", null);
  };

  const playerCount = Object.keys(users ?? {}).length;
  const currentModeConfig = GAME_MODES.find((m) => m.id === mode) || GAME_MODES[0];
  const enoughPlayers = playerCount >= currentModeConfig.min_players;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6">
      <div className="w-full max-w-4xl animate-slide-up">
        <motion.div className="relative flex items-center justify-between mb-6" {...snapIn({ delay: 0.08, strength: 1.2, y: 10 })}>
          <div className="flex justify-start flex-1">
            <Link href="/" className="flex items-center" onClick={handleLeave}>
              <button className="flex items-center cursor-pointer gap-2 transition-colors text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-4 h-4" />
                <span className="text-sm">Tillbaka</span>
              </button>
            </Link>
          </div>

          <h1 className="text-4xl font-bold font-display text-game-purple max-[565px]:whitespace-break-spaces max-[565px]:text-center max-[565px]:text-2xl max-[565px]:px-2 whitespace-nowrap">{hostName?.slice(-1) === "s" ? `${hostName} rum` : `${hostName}s rum`}</h1>
          <div className="flex-1" />
        </motion.div>
        <div>
          <div className="flex flex-col md:grid md:grid-cols-5 gap-6">
            <motion.div className="h-full md:col-span-3" {...snapIn({ delay: 0.16, x: -12, y: 12 })}>
              <div className="flex-1 h-full p-6 border game-card shadow-sm rounded-2xl bg-card border-border">
                <div className="flex flex-col gap-4">
                  <RoomCodeDisplay />
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold tracking-wider uppercase font-display text-muted-foreground">Spelläge</p>
                  </div>
                  <GameModeSelector />
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold tracking-wider uppercase font-display text-muted-foreground">Spelinställningar</p>
                  </div>
                  <GameSettings />
                </div>
              </div>
            </motion.div>
            <motion.div className="h-full md:col-span-2" {...snapIn({ delay: 0.2, x: 12, y: 12 })}>
              <PlayerList className="h-full max-h-150" />
            </motion.div>
          </div>
          <motion.div className="flex flex-col mt-6 sm:flex-row gap-6" {...snapIn({ delay: 0.24, y: 14, rotate: 1.5 })}>
            <Button variant="glass" size="lg" className="flex-1 gap-2 min-h-12 font-body">
              Snabb Guide
              <BookOpenText />
            </Button>

            <Button size="lg" disabled={!isHost || !enoughPlayers} onClick={handleStartGame} className={cn("gap-2 flex-1 min-h-12 font-body transition-all", (!isHost || !enoughPlayers) && "opacity-50 cursor-not-allowed", isHost && !enoughPlayers && "opacity-50 cursor-not-allowed")}>
              {isHost && enoughPlayers ? (
                <>
                  Starta
                  <Play className="w-4 h-4" />
                </>
              ) : isHost ? (
                <>
                  För få spelare för att starta
                  <UserRoundX className="w-4 h-4" />
                </>
              ) : !enoughPlayers ? (
                <>
                  Väntar på fler spelare...
                  <Loader2 className="w-4 h-4 animate-spin" />
                </>
              ) : (
                <>
                  Väntar på host...
                  <Loader2 className="w-4 h-4 animate-spin" />
                </>
              )}
            </Button>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
