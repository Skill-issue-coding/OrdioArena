"use client"

import { motion } from "motion/react"

interface GetReadyScreenProps {
  remainingMs: number
}

export function GetReadyScreen({ remainingMs }: GetReadyScreenProps) {
  const seconds = Math.floor(remainingMs / 1000)
  const ms = Math.floor((remainingMs % 1000) / 10)

  return (
    <motion.div key="get-ready" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="flex flex-col items-center justify-center gap-4 pt-20">
      <p className="animate-pulse font-display text-4xl font-bold text-game-purple">Gör dig redo...</p>
      <p className="font-display text-2xl font-bold text-muted-foreground tabular-nums">
        {seconds}.{String(ms).padStart(2, "0")}
      </p>
    </motion.div>
  )
}
