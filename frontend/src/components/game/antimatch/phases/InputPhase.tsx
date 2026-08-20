"use client"

import { useState } from "react"
import { Check, Send } from "lucide-react"
import { PlayerAvatar } from "@/components/lobby/PlayerList"
import { Button } from "@/components/ui/button"
import { isStringEmptyOrOnlySpaces } from "@/lib/utils"
import { motion } from "motion/react"
import { useAntiMatchGame } from "@/hooks/game/Hook"
import { useLobbyContext } from "@/hooks/lobby/Hook"
import { useUserContext } from "@/hooks/user/Hook"
import { useWebsocketContext } from "@/hooks/websocket/Hook"
import { ToastError } from "@/lib/ToastFunctions"
import { log } from "@/lib/logger"

export function InputPhase() {
  const [inputValue, setInputValue] = useState("")
  // const { gameState } = useGameContext();
  const game = useAntiMatchGame()
  const { users } = useLobbyContext()
  const { user } = useUserContext()
  const { sendEvent } = useWebsocketContext()

  if (!users || !user) return null

  const targetWord = game.word
  const hasSubmittedMap = game.rounds[game.current_round]?.has_submitted ?? {}
  const hasSubmitted = hasSubmittedMap[user.user_id] ?? false
  const currentRound = game.current_round + 1
  const totalRounds = game.total_rounds

  const sendWordSubmission = () => {
    if (hasSubmitted) {
      log.game.debug("antimatch submit ignored, already submitted", { round: currentRound })
      return
    }
    if (isStringEmptyOrOnlySpaces(inputValue) || inputValue.length > 128) {
      log.game.warn("antimatch submit rejected client-side", { round: currentRound, length: inputValue.length })
      ToastError("Skriv in ett ord")
      return
    }
    const word = inputValue.trim().toLowerCase()
    log.game.info("antimatch word submit", { round: currentRound, target: targetWord, word })
    sendEvent("game_submit_word", { word })
  }

  return (
    <div className="relative z-10 mx-auto mt-8 flex w-full max-w-2xl flex-col items-center">
      <div className="mb-8 text-center">
        <p className="mb-2 font-display text-sm font-bold tracking-widest text-muted-foreground uppercase">
          Runda {currentRound}/{totalRounds}
        </p>
        <h1 className="mb-4 font-display text-6xl font-extrabold tracking-tight text-game-green">{targetWord}</h1>
        <p className="font-body font-semibold text-muted-foreground">
          Var närmast, men <span className="font-bold text-foreground">unik</span>. Dubbletter ger 0 poäng.
        </p>
      </div>
      <div className="relative mb-10 h-28 w-full perspective-[1000px]">
        <motion.div
          className="relative h-full w-full transform-3d"
          initial={false}
          animate={{
            rotateX: hasSubmitted ? -180 : 0,
            scale: hasSubmitted ? [1, 1.08, 1] : 1,
          }}
          transition={{
            duration: 0.6,
            rotateX: { type: "spring", bounce: 0.3, duration: 0.6 },
            scale: { type: "tween", times: [0, 0.5, 1], ease: "easeInOut", duration: 0.6 },
          }}
        >
          <div className="game-card absolute inset-0 flex gap-2 backface-hidden">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  sendWordSubmission()
                }
              }}
              placeholder="Skriv ett relaterat ord..."
              autoFocus
              disabled={hasSubmitted}
              className="h-full w-full rounded-lg border-2 border-primary bg-muted px-4 text-center font-display text-xl font-bold shadow-sm transition-all placeholder:text-muted-foreground/50 focus:ring-4 focus:ring-primary/20 focus:outline-none disabled:opacity-50"
            />
            <Button onClick={sendWordSubmission} disabled={!inputValue.trim() || hasSubmitted} className="aspect-square h-full shrink-0 rounded-lg" aria-label="Skicka meddelande">
              <Send className="size-6" />
            </Button>
          </div>
          <div className="game-card absolute inset-0 flex transform-[rotateX(-180deg)] items-center justify-center border-game-green bg-game-green/10 backface-hidden">
            <div className="flex items-center gap-3">
              <Check className="h-8 w-8 text-game-green" strokeWidth={4} />
              <span className="font-display text-3xl font-extrabold text-game-green">{inputValue}</span>
            </div>
          </div>
        </motion.div>
      </div>
      <div className="flex items-center justify-center gap-4">
        {Object.values(users).map((p) => {
          const isSubmitted = hasSubmittedMap[p.user_id]
          const isSelf = p.user_id === user.user_id

          return (
            <div key={p.user_id} className="relative flex flex-col items-center">
              <div className={!isSubmitted && !isSelf ? "opacity-50 transition-opacity" : ""}>
                <PlayerAvatar name={p.username} color={p.background} className="h-10 w-10 border-3 font-display font-bold" />
              </div>
              {isSubmitted && (
                <div className="absolute -bottom-6 flex h-5 w-5 items-center justify-center rounded-full">
                  <Check className="h-4 w-4 text-game-green" strokeWidth={4} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
