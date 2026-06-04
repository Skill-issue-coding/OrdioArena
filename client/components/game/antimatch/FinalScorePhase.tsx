"use client";

import { PlayerAvatar } from "@/components/lobby/PlayerList";
import { Button } from "@/components/ui/button";
import { House } from "lucide-react";
// import { useAntiMatchGame } from "@/hooks/gamecontext";
import { useLobbyContext } from "@/hooks/lobbycontext";
import { useUserContext } from "@/hooks/usercontext";
import { motion } from "framer-motion";
import { popIn } from "@/lib/animation-util";
import { useEffect } from "react";
import { useWebsocketContext } from "@/hooks/websocketcontext";
import Link from "next/link";
import { useNewGameContext } from "@/hooks/newgamecontext";
import { AntiMatchResult } from "@/lib/game/new-antimatch-types";
import { useRouter } from "next/router";

export function FinalScorePhase() {
  const { result } = useNewGameContext();
  const { users, code } = useLobbyContext();
  const { user } = useUserContext();
  const { sendEvent } = useWebsocketContext();

  useEffect(() => { if (result) sendEvent("sync_request", null); }, [result]);

  if (!result || !("total_scores" in result) || !users || !user) return null;

  const { total_scores } = result as AntiMatchResult;

  // Convert the scores map to a sorted leaderboard array
  const leaderboard = Object.entries(total_scores)
    .map(([id, score]) => ({
      id,
      name: users[id]?.username || "Okänd",
      color: users[id]?.background || "#ccc",
      totalPoints: score,
      isSelf: id === user.user_id,
    }))
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  const [first, second, third, ...rest] = leaderboard;
  const isWinner = first?.id === user.user_id;

  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto mt-4 relative z-10 py-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
        <p className="font-display text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Slutresultat</p>
        <h1 className="font-display text-5xl font-extrabold text-primary tracking-tight">{isWinner ? "Du vann! 🏆" : `${first.name} vann! 🏆`}</h1>
      </motion.div>

      <div className="flex items-end justify-center gap-2 w-full mb-8 h-64">
        {second && (
          <motion.div className="flex flex-col items-center w-1/3" {...popIn({ delay: 0.6 })}>
            <div className="flex flex-col items-center mb-3">
              <PlayerAvatar name={second.name} color={second.color} className="w-12 h-12 border-4 font-display font-bold" />
              <div className="font-display font-bold mt-1">{second.name}</div>
              <div className="font-body text-xs font-semibold text-muted-foreground">{second.totalPoints} p</div>
            </div>
            <div className="w-full h-32 bg-game-blue game-card rounded-xl flex justify-center items-center pt-4">
              <span className="font-display font-extrabold text-4xl text-white">2</span>
            </div>
          </motion.div>
        )}

        {first && (
          <motion.div className="flex flex-col items-center w-1/3" {...popIn({ delay: 1.0 })}>
            <div className="flex flex-col items-center mb-3">
              <PlayerAvatar name={first.name} color={first.color} className="w-14 h-14 border-4 font-display font-bold" />
              <div className="font-display font-extrabold mt-1">{first.name}</div>
              <div className="font-body text-xs font-semibold text-muted-foreground">{first.totalPoints} p</div>
            </div>
            <div className="w-full h-44 bg-game-yellow game-card rounded-xl flex justify-center items-center pt-4 z-10 -mx-2">
              <span className="font-display font-extrabold text-5xl text-white drop-shadow-sm">1</span>
            </div>
          </motion.div>
        )}

        {third && (
          <motion.div className="flex flex-col items-center w-1/3" {...popIn({ delay: 0.2 })}>
            <div className="flex flex-col items-center mb-3">
              <PlayerAvatar name={third.name} color={third.color} className="w-12 h-12 border-4 font-display font-bold" />
              <div className="font-display font-bold mt-1">{third.name}</div>
              <div className="font-body text-xs font-semibold text-muted-foreground">{third.totalPoints} p</div>
            </div>
            <div className="w-full h-24 bg-game-orange game-card rounded-xl flex justify-center items-center pt-3">
              <span className="font-display font-extrabold text-3xl text-white">3</span>
            </div>
          </motion.div>
        )}
      </div>

      {rest.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} className="w-full flex flex-col gap-2 mb-8 bg-card game-card rounded-2xl p-2 border-2 border-border shadow-sm">
          {rest.map((r) => (
            <div key={r.id} className="flex items-center gap-3 py-2 px-2">
              <div className="w-4 text-center font-display font-bold text-muted-foreground">{r.rank}</div>
              <PlayerAvatar name={r.name} color={r.color} />
              <div className="flex-1 font-display font-bold">{r.name}</div>
              <div className="font-display font-bold text-muted-foreground">{r.totalPoints} p</div>
            </div>
          ))}
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.8 }} className="flex flex-row gap-4 w-full">
        <Link href={`/lobby/${code}`} className="flex-1">
          <Button size="lg" className="w-full min-h-12 font-body transition-all">
            Tillbaka till lobbyn
            <House />
          </Button>
        </Link>
      </motion.div>
    </div>
  );
}
