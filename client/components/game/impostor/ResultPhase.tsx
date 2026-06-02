"use client";

import PhaseTransition from "@/components/game/PhaseTransition";
import { Button } from "@/components/ui/button";
import { useImpostorGame } from "@/hooks/gamecontext";
import { useLobbyContext } from "@/hooks/lobbycontext";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useUserContext } from "@/hooks/usercontext";
import { StatsDialog } from "./StatsDialog";
import { useEffect, useState } from "react";
import { useWebsocketContext } from "@/hooks/websocketcontext";

// Shared tile used in both the impostor-win winners section and the normals-win reveal.
function ImpostorTile({ username, background, word, badge, badgeColor }: { username: string; background: string; word: string; badge: string; badgeColor: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-destructive/10 border border-destructive/30">
      <span className="flex items-center justify-center size-14 text-2xl font-bold text-white rounded-full font-display" style={{ backgroundColor: background }}>
        {username[0]}
      </span>
      <p className="font-bold font-display text-foreground text-sm">{username}</p>
      <p className="text-xs font-display text-destructive font-semibold">{word}</p>
      <span className={cn("text-[10px] font-display font-bold uppercase tracking-wide", badgeColor)}>{badge}</span>
    </div>
  );
}

export function ResultPhase() {
  // return (
  //   <PhaseTransition phaseKey="result">
  //     <div className="flex flex-col items-center w-full max-w-3xl gap-6">
  //       {/* Header */}
  //       <div className="text-center">
  //         <h1 className={cn("text-5xl font-display font-bold mb-2 text-game-green")}>Hej på dig</h1>
  //       </div>
  //     </div>
  //   </PhaseTransition>
  // );
  const game = useImpostorGame();
  const { users, code } = useLobbyContext();
  const { user } = useUserContext();
  const { sendEvent } = useWebsocketContext();
  const [statsOpen, setStatsOpen] = useState(false);
  if (!game || !game.result || !user || !users) return null;
  const winners = game.result.winners;
  const playerRoles = game.result.roles;
  const words = game.result.words;
  const normalSecretWord = game.result.normal_word;
  const winningRole = winners.length > 0 ? playerRoles[winners[0]] : null;
  const impostorsWon = winningRole === "impostor";
  const winningTeamText = impostorsWon ? "Impostors vann!" : "Normala spelare vann!";
  const winningTeamColor = impostorsWon ? "text-destructive" : "text-game-green";
  const impostorIds = Object.entries(playerRoles)
    .filter(([, role]) => role === "impostor")
    .map(([id]) => id);
  const normalIds = Object.keys(users).filter((id) => playerRoles[id] !== "impostor");

  useEffect(() => sendEvent("sync_request", null), []);

  return (
    <PhaseTransition phaseKey="result">
      <div className="flex flex-col items-center w-full max-w-3xl gap-6">
        {/* Header */}
        <div className="text-center">
          <h1 className={cn("text-5xl font-display font-bold mb-2", winningTeamColor)}>{winningTeamText}</h1>
          <p className="text-lg text-muted-foreground font-display">
            Det hemliga ordet var: <span className="font-bold text-foreground">{normalSecretWord}</span>
          </p>
        </div>
        {/* Impostors won → combined winner + reveal tile grid (no separate reveal card) */}
        {impostorsWon && (
          <div className="w-full game-card border-2 border-destructive/30">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider font-display text-muted-foreground">{impostorIds.length === 1 ? "Impostorn vann" : "Impostorer vann"}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {winners.map((id) => {
                const p = users[id];
                if (!p) return null;
                return <ImpostorTile key={id} username={p.username} background={p.background} word={words[id]} badge="Vinnare" badgeColor="text-destructive" />;
              })}
            </div>
          </div>
        )}
        {/* Normals won → impostor reveal in same tile style */}
        {!impostorsWon && (
          <div className="w-full game-card">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-sm font-bold uppercase tracking-wider font-display text-muted-foreground">{impostorIds.length === 1 ? "Impostorn avslöjad" : "Impostorer avslöjade"}</h2>
              <span className="text-xs font-display text-muted-foreground">
                vs <span className="font-semibold text-foreground">{normalSecretWord}</span>
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {impostorIds.map((id) => {
                const p = users[id];
                return <ImpostorTile key={id} username={p.username} background={p.background} word={words[id]} badge="Impostor" badgeColor="text-muted-foreground" />;
              })}
            </div>
          </div>
        )}
        {/* Normal players compact grid */}
        <div className="w-full game-card">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider font-display text-muted-foreground">Normala spelare</h2>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            {normalIds.map((id) => {
              const p = users[id];
              const isWinner = winners.includes(id);
              return (
                <div key={id} className={cn("flex flex-col items-center gap-1 p-2 rounded-xl bg-background border", isWinner ? "border-game-green/60" : "border-transparent")}>
                  <span className="flex items-center justify-center size-9 text-sm font-bold text-white rounded-full font-display" style={{ backgroundColor: p.background }}>
                    {p.username[0]}
                  </span>
                  <span className="text-[11px] font-semibold font-display text-foreground truncate w-full text-center leading-tight">{p.username}</span>
                </div>
              );
            })}
          </div>
        </div>
        {/* Buttons */}
        <div className="flex w-full gap-4 pb-6">
          <Link href={`/lobby/${code}`} className="flex-1">
            <Button size="lg" className="w-full text-lg font-bold font-display h-14">
              Tillbaka till Lobbyn
            </Button>
          </Link>
          <Button size="lg" variant="outline" onClick={() => setStatsOpen(true)} className="flex-1 text-lg font-bold border-2 font-display h-14">
            Statistik
          </Button>
        </div>
        <StatsDialog open={statsOpen} onOpenChange={setStatsOpen} />
      </div>
    </PhaseTransition>
  );
}
