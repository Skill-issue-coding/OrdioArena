"use client"

import { PlayerAvatar } from "@/components/lobby/PlayerList"
import { Button } from "@/components/ui/button"
import type { AntiMatchResult } from "@/hooks/game/antimatch/types"
import { useGameContext } from "@/hooks/game/Hook"
import { useLobbyContext } from "@/hooks/lobby/Hook"
import { useUserContext } from "@/hooks/user/Hook"
import { useWebsocketContext } from "@/hooks/websocket/Hook"
import { popIn } from "@/lib/animation-utils"
import { Link } from "@tanstack/react-router"
import { House } from "lucide-react"
import { motion } from "motion/react"
import { useEffect } from "react"

export function FinalScorePhase() {
  const { result } = useGameContext()
  const { users, code } = useLobbyContext()
  const { user } = useUserContext()
  const { sendEvent } = useWebsocketContext()

  useEffect(() => {
    if (result) sendEvent("sync_request", null)
  }, [result])

  if (!result || !("total_scores" in result) || !users || !user) return null

  const { total_scores } = result as AntiMatchResult

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
    .map((p, i) => ({ ...p, rank: i + 1 }))

  const [first, second, third, ...rest] = leaderboard
  const isWinner = first?.id === user.user_id

  const hrefLink = `/lobby/${code}`

  return (
    <div className="relative z-10 mx-auto mt-4 flex w-full max-w-2xl flex-col items-center py-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-12 text-center">
        <p className="mb-2 font-display text-xs font-bold tracking-widest text-muted-foreground uppercase">Slutresultat</p>
        <h1 className="font-display text-5xl font-extrabold tracking-tight text-primary">{isWinner ? "Du vann! 🏆" : `${first.name} vann! 🏆`}</h1>
      </motion.div>

      <div className="mb-8 flex h-64 w-full items-end justify-center gap-2">
        {second && (
          <motion.div className="flex w-1/3 flex-col items-center" {...popIn({ delay: 0.6 })}>
            <div className="mb-3 flex flex-col items-center">
              <PlayerAvatar name={second.name} color={second.color} className="h-12 w-12 border-4 font-display font-bold" />
              <div className="mt-1 font-display font-bold">{second.name}</div>
              <div className="font-body text-xs font-semibold text-muted-foreground">{second.totalPoints} p</div>
            </div>
            <div className="game-card flex h-32 w-full items-center justify-center rounded-xl bg-game-blue pt-4">
              <span className="font-display text-4xl font-extrabold text-white">2</span>
            </div>
          </motion.div>
        )}

        {first && (
          <motion.div className="flex w-1/3 flex-col items-center" {...popIn({ delay: 1.0 })}>
            <div className="mb-3 flex flex-col items-center">
              <PlayerAvatar name={first.name} color={first.color} className="h-14 w-14 border-4 font-display font-bold" />
              <div className="mt-1 font-display font-extrabold">{first.name}</div>
              <div className="font-body text-xs font-semibold text-muted-foreground">{first.totalPoints} p</div>
            </div>
            <div className="game-card z-10 -mx-2 flex h-44 w-full items-center justify-center rounded-xl bg-game-yellow pt-4">
              <span className="font-display text-5xl font-extrabold text-white drop-shadow-sm">1</span>
            </div>
          </motion.div>
        )}

        {third && (
          <motion.div className="flex w-1/3 flex-col items-center" {...popIn({ delay: 0.2 })}>
            <div className="mb-3 flex flex-col items-center">
              <PlayerAvatar name={third.name} color={third.color} className="h-12 w-12 border-4 font-display font-bold" />
              <div className="mt-1 font-display font-bold">{third.name}</div>
              <div className="font-body text-xs font-semibold text-muted-foreground">{third.totalPoints} p</div>
            </div>
            <div className="game-card flex h-24 w-full items-center justify-center rounded-xl bg-game-orange pt-3">
              <span className="font-display text-3xl font-extrabold text-white">3</span>
            </div>
          </motion.div>
        )}
      </div>

      {rest.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} className="game-card mb-8 flex w-full flex-col gap-2 rounded-2xl border-2 border-border bg-card p-2 shadow-sm">
          {rest.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-2 py-2">
              <div className="w-4 text-center font-display font-bold text-muted-foreground">{r.rank}</div>
              <PlayerAvatar name={r.name} color={r.color} />
              <div className="flex-1 font-display font-bold">{r.name}</div>
              <div className="font-display font-bold text-muted-foreground">{r.totalPoints} p</div>
            </div>
          ))}
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.8 }} className="flex w-full flex-row gap-4">
        <Link to={hrefLink} className="flex-1">
          <Button size="lg" className="min-h-12 w-full font-body transition-all">
            Tillbaka till lobbyn
            <House />
          </Button>
        </Link>
      </motion.div>
    </div>
  )
}
