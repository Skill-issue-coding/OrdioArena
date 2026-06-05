"use client";

import { Crown, Users } from "lucide-react";
import { User } from "@/lib/game/game";
import { useLobbyContext } from "@/hooks/lobbycontext";
import { useUserContext } from "@/hooks/usercontext";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useRef } from "react";
import { useEffect } from "react";

interface PlayerListProps {
  className?: string;
}

export function PlayerAvatar({ name, color, className }: { name: string; color: string; className?: string }) {
  //const initials = name.split(" ").map(n => n[0]).join("").toUpperCase();
  const split = name.split(" ");
  return (
    <div className={cn("flex items-center justify-center w-10 h-10 font-bold text-white border-2 rounded-full font-body border-card shrink-0", className)} style={{ backgroundColor: color, boxShadow: `0 3px 0 0 ${color}88` }}>
      {/*style={{ backgroundColor: p.color, boxShadow: `0 3px 0 0 ${p.color}88` }} */}
      {split.length >= 2 ? `${split[0][0]}${split[1][0]}` : name[0]}
    </div>
  );
}

function PlayerCard({ player }: { player: User }) {
  const { host } = useLobbyContext();
  const { user } = useUserContext();
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);

  const isHost = host === player.user_id;
  const currentPlayer = user?.user_id === player.user_id;

  useEffect(() => {
    if (textRef.current) {
      const containerWidth = textRef.current.parentElement?.clientWidth || 0;
      const textWidth = textRef.current.scrollWidth;
      setShouldAnimate(textWidth > containerWidth);
    }
  }, [player.username]);

  return (
    <div className="flex items-center px-4 py-3 border-2 rounded-lg group gap-4 transition-all bg-muted/50 border-border hover:border-primary font-display">
      <PlayerAvatar name={player.username} color={player.background} />
      <div className="flex-1 min-w-0">
        <div className="relative w-full overflow-hidden">
          <span ref={textRef} className={cn("inline-block text-base text-foreground font-bold whitespace-nowrap cursor-default", shouldAnimate && "group-hover:animate-[marquee_5s_linear_infinite]")}>
            {player.username}
            {currentPlayer && <span className="ml-2 text-xs text-muted-foreground shrink-0"> (Du)</span>}
          </span>
        </div>
      </div>
      {isHost && (
        <div className="flex items-center p-2 rounded-md bg-game-yellow/20">
          <Crown className="size-6 text-game-yellow shrink-0 stroke-3 " />
        </div>
      )}
    </div>
  );
}

function EmptySlot() {
  return (
    <div className="flex items-center px-4 py-3 border border-dashed rounded-lg gap-4 border-border/90 opacity-90 bg-muted/5">
      <div className="flex items-center justify-center w-10 h-10 border border-dashed rounded-full border-border/50 shrink-0 bg-muted/10 text-muted-foreground/30 animate-pulse">?</div>
      <div className="flex-1">
        <span className="flex text-sm italic text-muted-foreground/60 animate-pulse">
          Väntar på spelare
          <span className="flex w-6">
            <span className="animate-[loading_1.4s_infinite] ml-0.5">.</span>
            <span className="animate-[loading_1.4s_infinite_0.2s] ml-0.5">.</span>
            <span className="animate-[loading_1.4s_infinite_0.4s] ml-0.5">.</span>
          </span>
        </span>
      </div>
    </div>
  );
}

export function PlayerList({ className }: PlayerListProps) {
  const { users: all_players } = useLobbyContext();
  const { user } = useUserContext();
  const MAX_SLOTS = 12;
  const playerCount = Object.values(all_players ?? {}).length;
  const emptySlotsCount = Math.max(0, MAX_SLOTS - playerCount);
  const players = all_players ? Object.values(all_players).map((player) => (user && player.user_id === user.user_id ? user : player)) : [];

  return (
    <div className={cn("game-card flex flex-col p-6 border shadow-sm rounded-2xl bg-card border-border", className)}>
      <div className="flex flex-col flex-1 min-h-0 gap-4">
        <div className="flex items-center justify-between shrink-0">
          <h2 className="flex items-center text-sm font-bold tracking-wider uppercase font-display text-muted-foreground gap-2">
            <Users className="w-4 h-4" />
            Spelare
          </h2>
          <span className="font-display font-bold text-sm px-2.5 py-0.5 rounded-full bg-muted text-foreground tabular-nums">{playerCount}/12</span>
        </div>

        <div className="flex flex-col flex-1 overflow-y-auto gap-2 custom-scrollbar">
          {players.map((player) => (
            <PlayerCard key={player.user_id} player={player} />
          ))}
          {Array.from({ length: emptySlotsCount }).map((_, index) => (
            <EmptySlot key={`empty-${index}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
