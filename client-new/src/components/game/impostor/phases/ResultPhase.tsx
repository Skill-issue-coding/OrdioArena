"use client"

import PhaseTransition from "@/components/game/PhaseTransition"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useEffect, useState } from "react"
import { motion } from "motion/react"
import { useGameContext, type ImpostorGameResultPayload } from "@/hooks/game/Hook"
import { useLobbyContext } from "@/hooks/lobby/Hook"
import { useUserContext } from "@/hooks/user/Hook"
import { useWebsocketContext } from "@/hooks/websocket/Hook"
import { Link } from "@tanstack/react-router"
import { StatsDialog } from "./StatsDialog"

const tileVariants = {
  hidden: { opacity: 0, scale: 0.72, y: 18 },
  show: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 300, damping: 20 },
  },
}

const staggerGrid = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } },
}

function ImpostorTile({ username, background, word, badge, badgeColor }: { username: string; background: string; word: string; badge: string; badgeColor: string }) {
  return (
    <motion.div variants={tileVariants} className="flex flex-col items-center gap-1.5 rounded-2xl border border-destructive/30 bg-destructive/10 p-3">
      <span className="flex size-14 items-center justify-center rounded-full font-display text-2xl font-bold text-white" style={{ backgroundColor: background }}>
        {username[0]}
      </span>
      <p className="font-display text-sm font-bold text-foreground">{username}</p>
      <p className="font-display text-xs font-semibold text-destructive">{word}</p>
      <span className={cn("font-display text-[10px] font-bold tracking-wide uppercase", badgeColor)}>{badge}</span>
    </motion.div>
  )
}

export function ResultPhase() {
  const { result: rawResult } = useGameContext()
  const { users, code } = useLobbyContext()
  const { user } = useUserContext()
  const { sendEvent } = useWebsocketContext()
  const [statsOpen, setStatsOpen] = useState(false)
  useEffect(() => {
    if (rawResult) sendEvent("sync_request", null)
  }, [rawResult])
  if (!rawResult || !("winners" in rawResult) || !user || !users) return null

  const result = rawResult as ImpostorGameResultPayload
  const winners = result.winners
  const playerRoles = result.roles
  const words = result.words
  const normalSecretWord = result.normal_word
  const winningRole = winners.length > 0 ? playerRoles[winners[0]] : null
  const impostorsWon = winningRole === "impostor"
  const winningTeamText = impostorsWon ? "Impostors vann!" : "Normala spelare vann!"
  const winningTeamColor = impostorsWon ? "text-destructive" : "text-game-green"
  const impostorIds = Object.entries(playerRoles)
    .filter(([, role]) => role === "impostor")
    .map(([id]) => id)
  const normalIds = Object.keys(users).filter((id) => playerRoles[id] !== "impostor")

  const hrefLink = `/lobby/${code}`

  return (
    <PhaseTransition phaseKey="result">
      <div className="flex w-full max-w-3xl flex-col items-center gap-6">
        {/* Header */}
        <motion.div className="text-center" initial={{ opacity: 0, y: -28, scale: 0.92 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 320, damping: 24 }}>
          <h1 className={cn("mb-2 font-display text-5xl font-bold", winningTeamColor)}>{winningTeamText}</h1>
          <p className="font-display text-lg text-muted-foreground">
            Det hemliga ordet var:{" "}
            <motion.span className="font-bold text-foreground" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.38, type: "spring", stiffness: 420, damping: 18 }}>
              {normalSecretWord}
            </motion.span>
          </p>
        </motion.div>

        {/* Impostors won → combined winner + reveal tile grid */}
        {impostorsWon && (
          <motion.div className="game-card w-full border-2 border-destructive/30" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, type: "spring", stiffness: 280, damping: 22 }}>
            <h2 className="mb-3 font-display text-sm font-bold tracking-wider text-muted-foreground uppercase">{impostorIds.length === 1 ? "Impostorn vann" : "Impostorer vann"}</h2>
            <motion.div className="grid grid-cols-2 gap-3 sm:grid-cols-4" variants={staggerGrid} initial="hidden" animate="show">
              {winners.map((id) => {
                const p = users[id]
                if (!p) return null
                return <ImpostorTile key={id} username={p.username} background={p.background} word={words[id]} badge="Vinnare" badgeColor="text-destructive" />
              })}
            </motion.div>
          </motion.div>
        )}

        {/* Normals won → impostor reveal */}
        {!impostorsWon && (
          <motion.div className="game-card w-full" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, type: "spring", stiffness: 280, damping: 22 }}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-display text-sm font-bold tracking-wider text-muted-foreground uppercase">{impostorIds.length === 1 ? "Impostorn avslöjad" : "Impostorer avslöjade"}</h2>
              <span className="font-display text-xs text-muted-foreground">
                vs <span className="font-semibold text-foreground">{normalSecretWord}</span>
              </span>
            </div>
            <motion.div className="grid grid-cols-2 gap-3 sm:grid-cols-4" variants={staggerGrid} initial="hidden" animate="show">
              {impostorIds.map((id) => {
                const p = users[id]
                return <ImpostorTile key={id} username={p.username} background={p.background} word={words[id]} badge="Impostor" badgeColor="text-muted-foreground" />
              })}
            </motion.div>
          </motion.div>
        )}

        {/* Normal players compact grid */}
        <motion.div className="game-card w-full" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38, type: "spring", stiffness: 280, damping: 22 }}>
          <h2 className="mb-3 font-display text-sm font-bold tracking-wider text-muted-foreground uppercase">Normala spelare</h2>
          <motion.div className="grid grid-cols-4 gap-2 sm:grid-cols-6" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04, delayChildren: 0.1 } } }} initial="hidden" animate="show">
            {normalIds.map((id) => {
              const p = users[id]
              const isWinner = winners.includes(id)
              return (
                <motion.div
                  key={id}
                  className={cn("flex flex-col items-center gap-1 rounded-xl border bg-background p-2", isWinner ? "border-game-green/60" : "border-transparent")}
                  variants={{
                    hidden: { opacity: 0, scale: 0.68 },
                    show: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 360, damping: 22 } },
                  }}
                >
                  <span className="flex size-9 items-center justify-center rounded-full font-display text-sm font-bold text-white" style={{ backgroundColor: p.background }}>
                    {p.username[0]}
                  </span>
                  <span className="w-full truncate text-center font-display text-[11px] leading-tight font-semibold text-foreground">{p.username}</span>
                </motion.div>
              )
            })}
          </motion.div>
        </motion.div>

        {/* Buttons */}
        <motion.div className="flex w-full gap-4 pb-6" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.56, type: "spring", stiffness: 280, damping: 22 }}>
          <Link to={hrefLink} className="flex-1">
            <Button size="lg" className="h-14 w-full font-display text-lg font-bold">
              Tillbaka till Lobbyn
            </Button>
          </Link>
          <Button size="lg" variant="outline" onClick={() => setStatsOpen(true)} className="h-14 flex-1 border-2 font-display text-lg font-bold">
            Statistik
          </Button>
        </motion.div>
        <StatsDialog open={statsOpen} onOpenChange={setStatsOpen} />
      </div>
    </PhaseTransition>
  )
}
