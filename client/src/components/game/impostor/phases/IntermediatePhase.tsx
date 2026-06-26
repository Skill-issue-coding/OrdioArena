"use client"

import PhaseTransition from "@/components/game/PhaseTransition"
import { useImpostorGame } from "@/hooks/game/Hook"
import { useLobbyContext } from "@/hooks/lobby/Hook"
import { useUserContext } from "@/hooks/user/Hook"
import { popIn } from "@/lib/animation-utils"
import { motion } from "motion/react"

export function IntermediatePhase() {
  const game = useImpostorGame()
  const { users } = useLobbyContext()
  const { user } = useUserContext()

  if (!user || !users) return null
  const votedOut = game.intermediate_voted_out
  const isEliminated = votedOut !== undefined
  const message = votedOut === undefined ? (game.intermediate_message ?? "") : votedOut === user.user_id ? `Du röstades ut` : `${users[votedOut].username} röstades ut.`

  return (
    <PhaseTransition phaseKey="Intermediate">
      <div className="flex w-full max-w-3xl flex-col items-center gap-8">
        <div className="text-center">
          <h1 className="mb-2 font-display text-5xl font-bold">{message}</h1>
        </div>

        {isEliminated && votedOut !== undefined && (
          <motion.div key={votedOut} className="flex flex-col items-center gap-2 rounded-lg p-3" {...popIn({ delay: 0.15, ease: "easeOut", duration: 0.5 })}>
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full font-display text-2xl font-bold text-white" style={{ backgroundColor: users[votedOut].background }}>
              {users[votedOut].username[0]}
            </span>
            <span className="w-full truncate text-center font-display text-xl font-bold">{users[votedOut].username}</span>
          </motion.div>
        )}
      </div>
    </PhaseTransition>
  )
}
