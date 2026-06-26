"use client"

import { useState, useEffect } from "react"
import { PlayerAvatar } from "@/components/lobby/PlayerList"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"
import { motion } from "motion/react"
import { useLobbyContext } from "@/hooks/lobby/Hook"
import { useAntiMatchGame } from "@/hooks/game/Hook"

export function RoundResultPhase() {
  const [showFails, setShowFails] = useState(false)
  const { users } = useLobbyContext()
  const game = useAntiMatchGame()

  useEffect(() => {
    const timer = setTimeout(() => setShowFails(true), 1200)
    return () => clearTimeout(timer)
  }, [])

  const round = game.rounds[game.current_round]
  if (!round || !users) return null

  const target_word = game.word
  const { submissions, winner } = round

  const sortedResults = Object.entries(submissions)
    .map(([userId, result]) => ({
      id: userId,
      name: users[userId]?.username || "Okänd",
      color: users[userId]?.background || "#ccc",
      word: result.word === "-" ? null : result.word,
      points: result.word_score,
      isDuplicate: result.is_duplicate,
      isWinner: userId === winner,
    }))
    .sort((a, b) => {
      // Duplicates and missing words go to the bottom
      if (a.isDuplicate && !b.isDuplicate) return 1
      if (!a.isDuplicate && b.isDuplicate) return -1
      if (!a.word && b.word) return 1
      if (a.word && !b.word) return -1
      // Otherwise sort by highest points
      return b.points - a.points
    })
    // Assign rank based on sorted order
    .map((res, index) => ({ ...res, rank: index + 1 }))

  // Find duplicates to list them in the subheader
  const duplicateWords = Array.from(new Set(sortedResults.filter((r) => r.isDuplicate).map((d) => d.word)))
  const duplicateText = duplicateWords.length > 0 ? duplicateWords.map((w) => `"${w}"`).join(" · ") + " (Dubblett)" : "Alla ord är unika!"

  return (
    <div className="relative z-10 mx-auto mt-8 flex w-full max-w-2xl flex-col items-center">
      <div className="mb-8 text-center">
        <h2 className="mb-2 font-display text-3xl font-extrabold">Resultat: "{target_word}"</h2>
        <p className="font-body font-semibold text-muted-foreground">{duplicateText}</p>
      </div>

      <div className="mb-8 flex w-full flex-col gap-3">
        {sortedResults.map((r, i) => {
          const isFailed = r.isDuplicate || !r.word

          return (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
              className={cn("flex items-center gap-4 rounded-2xl border-2 p-4 transition-all duration-500", isFailed && showFails ? "border-game-red bg-game-red/5" : r.isWinner ? "border-game-green bg-game-green/10" : "border-border bg-card")}
            >
              <div className="w-6 text-center font-display text-xl font-extrabold">{r.rank}</div>

              <PlayerAvatar name={r.name} color={r.color} className="h-10 w-10 shrink-0 border-2 font-display font-bold" />

              <div className="min-w-0 flex-1">
                <div className="relative inline-block w-max">
                  <div className="font-display text-xs font-bold text-muted-foreground">{r.name}</div>
                  {isFailed && showFails && (
                    <motion.div className="absolute top-1/2 right-[-5%] left-[-5%] h-0.5 origin-left rounded-full bg-game-red" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.35, ease: "easeInOut" }} />
                  )}
                </div>
                <div className="flex items-center gap-2 truncate font-display text-xl font-extrabold">
                  {r.word ? `"${r.word}"` : "---"}
                  {r.isDuplicate && <span className="font-display text-[10px] font-extrabold tracking-wider text-game-red uppercase">· Dubblett</span>}
                </div>
              </div>

              <div className={cn("w-12 text-right font-display text-xl font-extrabold", isFailed && showFails ? "text-game-red" : r.isWinner ? "text-game-green" : "")}>
                {isFailed ? showFails ? <X className="ml-auto stroke-[3px] text-game-red" /> : `+${r.points}p` : `+${r.points}p`}
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
