"use client";

import { useState, useEffect } from "react";
import { PlayerAvatar } from "@/components/lobby/PlayerList";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { motion } from "framer-motion";
import { useGameContext } from "@/hooks/gamecontext";
import { useLobbyContext } from "@/hooks/lobbycontext";
import { useUserContext } from "@/hooks/usercontext";
import { useAntiMatchGame } from "@/hooks/gamecontext";

export function RoundResultPhase() {
  const [showFails, setShowFails] = useState(false);
  const { gameState } = useGameContext();
  const { users } = useLobbyContext();
  const { user } = useUserContext();
  const game = useAntiMatchGame();

  useEffect(() => {
    const timer = setTimeout(() => setShowFails(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  if (!game?.roundResultState || !users) return null;

  const { target_word, results, winner } = game.roundResultState;

  const sortedResults = Object.entries(results)
    .map(([userId, result]) => ({
      id: userId,
      name: users[userId]?.username || "Okänd",
      color: users[userId]?.background || "#ccc",
      word: result.word === "---" ? null : result.word,
      points: result.score,
      isDuplicate: result.is_duplicate,
      isWinner: userId === winner,
    }))
    .sort((a, b) => {
      // Duplicates and missing words go to the bottom
      if (a.isDuplicate && !b.isDuplicate) return 1;
      if (!a.isDuplicate && b.isDuplicate) return -1;
      if (!a.word && b.word) return 1;
      if (a.word && !b.word) return -1;
      // Otherwise sort by highest points
      return b.points - a.points;
    })
    // Assign rank based on sorted order
    .map((res, index) => ({ ...res, rank: index + 1 }));

  // Find duplicates to list them in the subheader
  const duplicateWords = Array.from(new Set(sortedResults.filter((r) => r.isDuplicate).map((d) => d.word)));
  const duplicateText =
    duplicateWords.length > 0 ? duplicateWords.map((w) => `"${w}"`).join(" · ") + " (Dubblett)" : "Alla ord är unika!";

  if (gameState?.mode !== "anti_match" || !gameState.phaseState || !users || !user) return null;

  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto mt-8 relative z-10">
      <div className="text-center mb-8">
        <h2 className="font-display text-3xl font-extrabold mb-2">Resultat: "{target_word}"</h2>
        <p className="font-body font-semibold text-muted-foreground">{duplicateText}</p>
      </div>

      <div className="w-full flex flex-col gap-3 mb-8">
        {sortedResults.map((r, i) => {
          const isFailed = r.isDuplicate || !r.word;

          return (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
              className={cn(
                "flex items-center gap-4 p-4 rounded-2xl border-2 transition-all duration-500",
                isFailed && showFails
                  ? "border-game-red bg-game-red/5"
                  : r.isWinner
                    ? "border-game-green bg-game-green/10"
                    : "border-border bg-card",
              )}>
              <div className="w-6 text-center font-display font-extrabold text-xl">{r.rank}</div>

              <PlayerAvatar
                name={r.name}
                color={r.color}
                className="w-10 h-10 border-2 font-display font-bold shrink-0"
              />

              <div className="flex-1 min-w-0">
                <div className="relative inline-block w-max">
                  <div className="font-display font-bold text-xs text-muted-foreground">{r.name}</div>
                  {isFailed && showFails && (
                    <motion.div
                      className="absolute top-1/2 left-[-5%] right-[-5%] h-0.5 bg-game-red origin-left rounded-full"
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.35, ease: "easeInOut" }}
                    />
                  )}
                </div>
                <div className="font-display font-extrabold text-xl truncate flex items-center gap-2">
                  {r.word ? `"${r.word}"` : "---"}
                  {r.isDuplicate && (
                    <span className="text-[10px] font-display font-extrabold text-game-red uppercase tracking-wider">
                      · Dubblett
                    </span>
                  )}
                </div>
              </div>

              <div
                className={cn(
                  "font-display font-extrabold text-xl w-12 text-right",
                  isFailed && showFails ? "text-game-red" : r.isWinner ? "text-game-green" : "",
                )}>
                {isFailed ? (
                  showFails ? (
                    <X className="stroke-[3px] ml-auto text-game-red" />
                  ) : (
                    `+${r.points}p`
                  )
                ) : (
                  `+${r.points}p`
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
