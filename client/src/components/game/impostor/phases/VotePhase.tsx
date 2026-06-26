"use client"

import PhaseTransition from "@/components/game/PhaseTransition"
import { cn, deriveTally } from "@/lib/utils"
import { useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import type { User } from "@/hooks/user/types"
import { useUserContext } from "@/hooks/user/Hook"
import { useLobbyContext } from "@/hooks/lobby/Hook"
import { useWebsocketContext } from "@/hooks/websocket/Hook"
import { useImpostorGame } from "@/hooks/game/Hook"
import { log } from "@/lib/logger"

const AVATAR_CAP = 5

function VoterStrip({ voters, users, emptyLabel, center }: { voters: string[]; users: Record<string, User>; emptyLabel?: string; center?: boolean }) {
  const shown = voters.slice(0, AVATAR_CAP)
  const extra = voters.length - shown.length

  return (
    <div className={cn("mt-0.5 flex min-h-5 w-full flex-wrap items-center gap-0.5", center && "justify-center")}>
      {voters.length === 0 ? (
        emptyLabel ? (
          <span className="font-display text-xs leading-5 text-muted-foreground">{emptyLabel}</span>
        ) : null
      ) : (
        <>
          <AnimatePresence initial={false}>
            {shown.map((voterId) => {
              const voter = users[voterId]
              return (
                <motion.span
                  key={voterId}
                  title={voter?.username}
                  className="flex h-5 w-5 items-center justify-center rounded-full border border-card font-display text-[10px] font-bold text-white"
                  style={{ backgroundColor: voter?.background }}
                  initial={{ opacity: 0, scale: 0, x: -6 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0 }}
                  transition={{ type: "spring", stiffness: 480, damping: 24 }}
                >
                  {voter?.username[0]}
                </motion.span>
              )
            })}
          </AnimatePresence>
          {extra > 0 && <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-muted font-display text-[10px] font-bold text-muted-foreground">+{extra}</span>}
        </>
      )}
    </div>
  )
}

const cardListVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
}

const cardItemVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 320, damping: 24 },
  },
}

export function VotePhase() {
  const { user } = useUserContext()
  const { users } = useLobbyContext()
  const { sendEvent } = useWebsocketContext()
  const game = useImpostorGame()

  // Optimistic local vote — immediately reflects the user's click before the
  // server echoes it back via impostor_vote_update.
  const [myVote, setMyVote] = useState<string | null | undefined>(undefined)

  const serverVotes = game.rounds[game.current_round]?.votes ?? {}
  const allVotes = useMemo(() => ({ ...serverVotes, ...(myVote !== undefined && user ? { [user.user_id]: myVote } : {}) }), [serverVotes, myVote, user])

  const { votersByTarget, skipVoters, counts, skipCount, maxVotes, leader } = useMemo(() => deriveTally(allVotes), [allVotes])

  if (!users || !user) return null

  const activePlayers = game.active_players
  const myId = user.user_id
  const isCurrentUserActive = activePlayers[myId] ?? false

  const handleVote = (target: string | null) => {
    if (target === myVote || !isCurrentUserActive) {
      log.game.debug("vote ignored", { sameAsCurrent: target === myVote, active: isCurrentUserActive })
      return
    }
    log.game.info("impostor vote", { round: game.current_round, target: target ?? "skip" })
    sendEvent("game_submit_vote", { target })
    setMyVote(target)
  }

  const denom = Math.max(maxVotes, skipCount, 1)

  return (
    <PhaseTransition phaseKey="vote">
      <div className="w-full max-w-4xl">
        {/* Header */}
        <div className="mb-6 text-center">
          <h2 className="font-display text-2xl font-bold text-foreground">Rösta</h2>
          <p className="font-display text-sm font-semibold text-muted-foreground">Vem är en imposter?</p>
        </div>

        {/* Player grid — stagger in on mount */}
        <motion.div className="mb-3 grid w-full grid-cols-2 gap-3" variants={cardListVariants} initial="hidden" animate="show">
          {Object.entries(users).map(([playerId, player]) => {
            const isActive = activePlayers[playerId] ?? false
            const isSelected = myVote === playerId
            const isCurrentUser = playerId === myId
            const voters = votersByTarget[playerId] ?? []
            const isLeading = leader === playerId
            const share = Math.round(((counts[playerId] ?? 0) / denom) * 100)

            return (
              <motion.button
                key={playerId}
                variants={cardItemVariants}
                disabled={!isActive || isCurrentUser}
                onClick={() => handleVote(playerId)}
                className={cn(
                  "game-card relative flex items-center gap-3 overflow-hidden text-left transition-all",
                  isActive && !isCurrentUser && "cursor-pointer hover:border-muted-foreground",
                  isSelected && !isLeading && "border-game-green bg-game-green/40!",
                  isLeading && "animate-pulse border-game-red bg-game-red/40!",
                  (!isActive || isCurrentUser) && "cursor-not-allowed opacity-40"
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold text-white" style={{ backgroundColor: player.background }}>
                  {player.username[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-sm font-semibold text-foreground">{player.username}</p>
                  {!isActive ? <p className="font-display text-xs text-muted-foreground">Eliminerad</p> : <VoterStrip voters={voters} users={users} emptyLabel="Inga röster än" />}
                </div>
                {isActive && (
                  <div className="flex min-w-8 shrink-0 flex-col items-center text-center">
                    {/* key change → re-mount → stamp-down entrance feels weighty/tense */}
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.span
                        key={voters.length}
                        className={cn("font-display text-xl leading-none font-bold tabular-nums", voters.length === 0 ? "text-muted-foreground/40" : "text-foreground")}
                        initial={{ opacity: 0, y: -10, scale: 1.25 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.75 }}
                        transition={{ type: "spring", stiffness: 520, damping: 26 }}
                      >
                        {voters.length}
                      </motion.span>
                    </AnimatePresence>
                    <span className="mt-0.5 font-display text-[10px] leading-none text-muted-foreground">{voters.length === 1 ? "röst" : "röster"}</span>
                  </div>
                )}
                {isActive && <span className="absolute bottom-0 left-0 h-1 rounded-b-xl bg-primary/40 transition-all duration-500" style={{ width: `${share}%` }} />}
              </motion.button>
            )
          })}
        </motion.div>

        {/* Skip button */}
        <motion.button
          onClick={() => handleVote(null)}
          className={cn(
            "game-card relative mb-6 flex w-full cursor-pointer items-center gap-3 overflow-hidden transition-all hover:border-muted-foreground",
            myVote === null && leader !== null && "border-game-green bg-game-green/40!",
            leader === null && "animate-pulse border-game-red bg-game-red/40!"
          )}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, type: "spring", stiffness: 300, damping: 24 }}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-display text-sm font-semibold text-foreground">Skippa röst</p>
            <VoterStrip voters={skipVoters} users={users} emptyLabel="Inga röster än" center />
          </div>
          <div className="flex min-w-8 shrink-0 flex-col items-center text-center">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={skipVoters.length}
                className={cn("font-display text-xl leading-none font-bold tabular-nums", skipVoters.length === 0 ? "text-muted-foreground/40" : "text-foreground")}
                initial={{ opacity: 0, y: -10, scale: 1.25 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.75 }}
                transition={{ type: "spring", stiffness: 520, damping: 26 }}
              >
                {skipVoters.length}
              </motion.span>
            </AnimatePresence>
            <span className="mt-0.5 font-display text-[10px] leading-none text-muted-foreground">{skipVoters.length === 1 ? "röst" : "röster"}</span>
          </div>
          <span className="absolute bottom-0 left-0 h-1 rounded-b-xl bg-primary/40 transition-all duration-500" style={{ width: `${Math.round((skipCount / denom) * 100)}%` }} />
        </motion.button>
      </div>
    </PhaseTransition>
  )
}
