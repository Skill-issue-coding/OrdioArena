"use client";

import { useState, useEffect } from "react";
import { PlayerAvatar } from "@/components/lobby/PlayerList";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { motion } from "framer-motion";
import { popIn } from "@/lib/animation-util";

// Mock Data
const MOCK_TARGET = "kärlek";
const MOCK_RESULTS = [
  { id: "2", name: "Oskar", color: "#4fd1c5", word: "romantik", points: 98, isDuplicate: false, rank: 1 },
  { id: "4", name: "Saga", color: "#10b981", word: "hjärta", points: 0, isDuplicate: true, rank: 4 },
  { id: "1", name: "Du", color: "#8b5cf6", word: null, points: 0, isDuplicate: false, rank: 3 },
  { id: "3", name: "Astrid", color: "#fbd38d", word: "rosor", points: 91, isDuplicate: false, rank: 2 },
  { id: "5", name: "Nils", color: "#f6ad55", word: "hjärta", points: 0, isDuplicate: true, rank: 5 },
];

export function RoundResultPhase() {
  const [results, setResults] = useState(MOCK_RESULTS);
  const [showFails, setShowFails] = useState(false);

  useEffect(() => {
    // 1. Calculate when the final popIn animation settles
    // Max delay is ~1.65s + ~0.55s animation duration = ~2.2s (2200ms)
    const ANIMATION_COMPLETE_MS = 2200;

    // 2. Show X, strikethrough, and red background (0.25s after animations finish)
    const failTimer = setTimeout(() => {
      setShowFails(true);
    }, ANIMATION_COMPLETE_MS + 150);

    // 3. Reorder the list (0.4s after the fail indicators are shown)
    const sortTimer = setTimeout(
      () => {
        setResults((prev) => {
          return [...prev].sort((a, b) => {
            const aFailed = a.isDuplicate || a.word === null;
            const bFailed = b.isDuplicate || b.word === null;

            if (aFailed && !bFailed) return 1;
            if (!aFailed && bFailed) return -1;

            // Preserve the original rank order if they share the same fail state
            return a.rank - b.rank;
          });
        });
      },
      ANIMATION_COMPLETE_MS + 150 + 50,
    );

    return () => {
      clearTimeout(failTimer);
      clearTimeout(sortTimer);
    };
  }, []);

  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto mt-8 relative z-10">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="text-center mb-8">
        <h2 className="font-display text-3xl font-extrabold mb-2">Resultat till: "{MOCK_TARGET}"</h2>
        <p className="font-body font-semibold text-muted-foreground">"hjärta" x2</p>
      </motion.div>

      <div className="w-full flex flex-col gap-3 mb-8">
        {results.map((r, idx) => {
          const isWinner = r.rank === 1;
          const isFailed = r.isDuplicate || r.word === null;

          // Calculate the original entrance delay relative to the original mock array
          // so the initial render is identical, regardless of how they are sorted later.
          const originalIdx = MOCK_RESULTS.findIndex((mock) => mock.id === r.id);
          const delay = (originalIdx === 0 ? 0.4 : 0) + 0.25 * (MOCK_RESULTS.length - originalIdx);
          const duration = idx === 0 ? 0.1 : 0.25;
          const strength = idx === 0 ? 1.15 : 1;

          const pop = popIn({ delay, duration, strength });

          return (
            <motion.div
              layout // This makes the div automatically glide to its new position when the array sorts
              key={r.id}
              initial={pop.initial}
              animate={pop.animate}
              transition={{
                ...pop.transition,
                layout: { type: "spring", stiffness: 350, damping: 30 }, // Fast but smooth layout transition
              }}
              className={cn(
                "flex items-center gap-4 p-3 rounded-xl border-2 transition-colors duration-500 bg-card relative",
                // Background logic updated: only turn red if it failed AND showFails is true
                isFailed && showFails ? "border-game-red bg-linear-to-r from-game-red/20 to-game-red/10" : isWinner ? "border-game-green bg-linear-to-r from-game-green/20 to-game-green/10 shadow-lg shadow-game-green/10 z-10" : "border-border",
              )}>
              <div className="w-6 text-center font-display font-extrabold text-xl">{r.rank}</div>

              {/* Avatar + Animated Overlay Wrapper */}
              <div className="relative">
                <PlayerAvatar name={r.name} color={r.color} className="w-9 h-9 border-3 font-display font-bold" />

                {isFailed && showFails && (
                  <motion.div initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }} className="absolute inset-0 rounded-full flex items-center justify-center shadow-sm">
                    <svg viewBox="0 0 24 24" className="size-16 text-game-red" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                      <motion.path d="M16 8L8 16" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.25, ease: "easeOut" }} />
                      <motion.path d="M8 8L16 16" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.25, delay: 0.1, ease: "easeOut" }} />
                    </svg>
                  </motion.div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="relative inline-block w-max">
                  <div className="font-display font-bold text-xs text-muted-foreground">{r.name}</div>
                  {/* Animated Strikethrough for Username */}
                  {isFailed && showFails && <motion.div className="absolute top-1/2 left-[-5%] right-[-5%] h-0.5 bg-game-red origin-left rounded-full" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.35, ease: "easeInOut" }} />}
                </div>
                <div className="font-display font-extrabold text-xl truncate flex items-center gap-2">
                  "{r.word}"{r.isDuplicate && <span className="text-[10px] font-display font-extrabold text-game-red uppercase tracking-wider">· Dubblett</span>}
                </div>
              </div>

              <div className={cn("font-display font-extrabold text-xl", isFailed && showFails ? "text-game-red" : isWinner ? "text-game-green" : "")}>
                {r.isDuplicate ? (
                  // Only show the X if showFails is active, otherwise show points/nothing temporarily
                  showFails ? (
                    <X className="stroke-3" />
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
