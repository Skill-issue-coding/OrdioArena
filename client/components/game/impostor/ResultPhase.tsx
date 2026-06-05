"use client";

import PhaseTransition from "@/components/game/PhaseTransition";
import { Button } from "@/components/ui/button";
// import { useImpostorGame } from "@/hooks/gamecontext";
import { useNewGameContext, type ImpostorGameResultPayload } from "@/hooks/newgamecontext";
import { useLobbyContext } from "@/hooks/lobbycontext";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useUserContext } from "@/hooks/usercontext";
import { StatsDialog } from "./StatsDialog";
import { useEffect, useState } from "react";
import { useWebsocketContext } from "@/hooks/websocketcontext";
import { motion } from "framer-motion";

const tileVariants = {
  hidden: { opacity: 0, scale: 0.72, y: 18 },
  show: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 300, damping: 20 },
  },
};

const staggerGrid = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } },
};

function ImpostorTile({ username, background, word, badge, badgeColor }: { username: string; background: string; word: string; badge: string; badgeColor: string }) {
  return (
    <motion.div variants={tileVariants} className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-destructive/10 border border-destructive/30">
      <span className="flex items-center justify-center size-14 text-2xl font-bold text-white rounded-full font-display" style={{ backgroundColor: background }}>
        {username[0]}
      </span>
      <p className="font-bold font-display text-foreground text-sm">{username}</p>
      <p className="text-xs font-display text-destructive font-semibold">{word}</p>
      <span className={cn("text-[10px] font-display font-bold uppercase tracking-wide", badgeColor)}>{badge}</span>
    </motion.div>
  );
}

export function ResultPhase() {
  const { result: rawResult } = useNewGameContext();
  const { users, code } = useLobbyContext();
  const { user } = useUserContext();
  const { sendEvent } = useWebsocketContext();
  const [statsOpen, setStatsOpen] = useState(false);
  useEffect(() => {
    if (rawResult) sendEvent("sync_request", null);
  }, [rawResult]);
  if (!rawResult || !("winners" in rawResult) || !user || !users) return null;

  const result = rawResult as ImpostorGameResultPayload;
  const winners = result.winners;
  const playerRoles = result.roles;
  const words = result.words;
  const normalSecretWord = result.normal_word;
  const winningRole = winners.length > 0 ? playerRoles[winners[0]] : null;
  const impostorsWon = winningRole === "impostor";
  const winningTeamText = impostorsWon ? "Impostors vann!" : "Normala spelare vann!";
  const winningTeamColor = impostorsWon ? "text-destructive" : "text-game-green";
  const impostorIds = Object.entries(playerRoles)
    .filter(([, role]) => role === "impostor")
    .map(([id]) => id);
  const normalIds = Object.keys(users).filter((id) => playerRoles[id] !== "impostor");

  return (
    <PhaseTransition phaseKey="result">
      <div className="flex flex-col items-center w-full max-w-3xl gap-6">
        {/* Header */}
        <motion.div className="text-center" initial={{ opacity: 0, y: -28, scale: 0.92 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 320, damping: 24 }}>
          <h1 className={cn("text-5xl font-display font-bold mb-2", winningTeamColor)}>{winningTeamText}</h1>
          <p className="text-lg text-muted-foreground font-display">
            Det hemliga ordet var:{" "}
            <motion.span className="font-bold text-foreground" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.38, type: "spring", stiffness: 420, damping: 18 }}>
              {normalSecretWord}
            </motion.span>
          </p>
        </motion.div>

        {/* Impostors won → combined winner + reveal tile grid */}
        {impostorsWon && (
          <motion.div className="w-full game-card border-2 border-destructive/30" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, type: "spring", stiffness: 280, damping: 22 }}>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider font-display text-muted-foreground">{impostorIds.length === 1 ? "Impostorn vann" : "Impostorer vann"}</h2>
            <motion.div className="grid grid-cols-2 sm:grid-cols-4 gap-3" variants={staggerGrid} initial="hidden" animate="show">
              {winners.map((id) => {
                const p = users[id];
                if (!p) return null;
                return <ImpostorTile key={id} username={p.username} background={p.background} word={words[id]} badge="Vinnare" badgeColor="text-destructive" />;
              })}
            </motion.div>
          </motion.div>
        )}

        {/* Normals won → impostor reveal */}
        {!impostorsWon && (
          <motion.div className="w-full game-card" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, type: "spring", stiffness: 280, damping: 22 }}>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-sm font-bold uppercase tracking-wider font-display text-muted-foreground">{impostorIds.length === 1 ? "Impostorn avslöjad" : "Impostorer avslöjade"}</h2>
              <span className="text-xs font-display text-muted-foreground">
                vs <span className="font-semibold text-foreground">{normalSecretWord}</span>
              </span>
            </div>
            <motion.div className="grid grid-cols-2 sm:grid-cols-4 gap-3" variants={staggerGrid} initial="hidden" animate="show">
              {impostorIds.map((id) => {
                const p = users[id];
                return <ImpostorTile key={id} username={p.username} background={p.background} word={words[id]} badge="Impostor" badgeColor="text-muted-foreground" />;
              })}
            </motion.div>
          </motion.div>
        )}

        {/* Normal players compact grid */}
        <motion.div className="w-full game-card" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38, type: "spring", stiffness: 280, damping: 22 }}>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider font-display text-muted-foreground">Normala spelare</h2>
          <motion.div className="grid grid-cols-4 sm:grid-cols-6 gap-2" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04, delayChildren: 0.1 } } }} initial="hidden" animate="show">
            {normalIds.map((id) => {
              const p = users[id];
              const isWinner = winners.includes(id);
              return (
                <motion.div
                  key={id}
                  className={cn("flex flex-col items-center gap-1 p-2 rounded-xl bg-background border", isWinner ? "border-game-green/60" : "border-transparent")}
                  variants={{
                    hidden: { opacity: 0, scale: 0.68 },
                    show: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 360, damping: 22 } },
                  }}>
                  <span className="flex items-center justify-center size-9 text-sm font-bold text-white rounded-full font-display" style={{ backgroundColor: p.background }}>
                    {p.username[0]}
                  </span>
                  <span className="text-[11px] font-semibold font-display text-foreground truncate w-full text-center leading-tight">{p.username}</span>
                </motion.div>
              );
            })}
          </motion.div>
        </motion.div>

        {/* Buttons */}
        <motion.div className="flex w-full gap-4 pb-6" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.56, type: "spring", stiffness: 280, damping: 22 }}>
          <Link href={`/lobby/${code}`} className="flex-1">
            <Button size="lg" className="w-full text-lg font-bold font-display h-14">
              Tillbaka till Lobbyn
            </Button>
          </Link>
          <Button size="lg" variant="outline" onClick={() => setStatsOpen(true)} className="flex-1 text-lg font-bold border-2 font-display h-14">
            Statistik
          </Button>
        </motion.div>
        <StatsDialog open={statsOpen} onOpenChange={setStatsOpen} />
      </div>
    </PhaseTransition>
  );
}
