"use client"

import { ChevronDown, Send } from "lucide-react"
import PhaseTransition from "@/components/game/PhaseTransition"
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { AnimatePresence, motion } from "motion/react"
import { useLobbyContext } from "@/hooks/lobby/Hook"
import { useImpostorGame } from "@/hooks/game/Hook"
import { useUserContext } from "@/hooks/user/Hook"
import { useWebsocketContext } from "@/hooks/websocket/Hook"
import { snapIn } from "@/lib/animation-utils"
import { log } from "@/lib/logger"

export function DiscussionPhase() {
  const { chatMessages, users } = useLobbyContext()
  const game = useImpostorGame()
  const { user } = useUserContext()
  const { sendEvent } = useWebsocketContext()

  const [draft, setDraft] = useState<string>("")

  const scrollRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [readCount, setReadCount] = useState(0)
  const unreadBelow = Math.max(0, chatMessages.length - readCount)

  // Scroll to bottom on mount.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    setReadCount(chatMessages.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Auto-scroll when a new message arrives and the user is already at the bottom.
  useEffect(() => {
    if (isAtBottomRef.current) {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
      setReadCount(chatMessages.length)
    }
  }, [chatMessages.length])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8
    isAtBottomRef.current = atBottom
    if (atBottom !== isAtBottom) setIsAtBottom(atBottom)
    if (atBottom) setReadCount(chatMessages.length)
  }

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    setReadCount(chatMessages.length)
    isAtBottomRef.current = true
    setIsAtBottom(true)
  }

  const handleSend = () => {
    if (!draft.trim()) return
    log.game.debug("discussion chat send", { round: game.current_round, length: draft.length })
    sendEvent("send_chatmessage", { message: draft })
    setDraft("")
    setIsAtBottom(true)
  }

  if (!users || !user) return null

  const submittedWords = game.rounds[game.current_round]?.submissions ?? {}
  const activePlayers = game.active_players
  const isCurrentUserActive = activePlayers[user.user_id] ?? false

  return (
    <PhaseTransition phaseKey="discuss">
      <div className="mb-6 text-center">
        <h2 className="font-display text-2xl font-bold text-foreground">Diskutera</h2>
        <p className="font-display text-sm font-semibold text-muted-foreground">Berätta, vem är misstänksam?</p>
      </div>
      <div className="flex w-full max-w-6xl flex-col justify-between gap-6 lg:flex-row">
        <div className="game-card flex flex-2 flex-col justify-between gap-3">
          <h4 className="font-display text-sm font-bold text-muted-foreground uppercase">Chatt</h4>
          <div className="relative">
            <div ref={scrollRef} onScroll={handleScroll} className="h-110 max-h-110 w-full space-y-3 overflow-y-auto rounded-lg bg-muted/50 px-3 py-2">
              {chatMessages.length === 0 && <p className="flex h-full items-center justify-center py-8 text-center font-display text-sm text-muted-foreground">Inga medelanden ännu. Säg skriv vem som är misstänsam.</p>}
              {/* initial={false} → skip entrance anim for messages already present on mount */}
              <AnimatePresence initial={false}>
                {chatMessages.map((msg, i) => (
                  <motion.div key={i} className="flex w-full items-start gap-2" initial={{ opacity: 0, x: -14, scale: 0.97 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ type: "spring", stiffness: 380, damping: 30 }}>
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-display text-xs font-bold text-white" style={{ backgroundColor: msg.sender.background }}>
                      {msg.sender.username[0]}
                    </span>
                    <div className="w-full min-w-0">
                      <span className="mr-1 font-display text-xs font-bold" style={{ color: msg.sender.background }}>
                        {msg.sender.username}
                      </span>
                      <span className="font-display text-sm wrap-break-word whitespace-pre-wrap text-foreground">{msg.message}</span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            <AnimatePresence>
              {!isAtBottom && unreadBelow > 0 && (
                <motion.button
                  onClick={scrollToBottom}
                  className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border-2 border-primary/50 bg-primary px-3 py-1.5 font-display text-xs font-bold whitespace-nowrap text-primary-foreground shadow-lg"
                  initial={{ opacity: 0, y: 10, scale: 0.88 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.88 }}
                  transition={{ type: "spring", stiffness: 420, damping: 26 }}
                >
                  <ChevronDown className="h-3 w-3" />
                  {unreadBelow} nya meddelanden
                </motion.button>
              )}
            </AnimatePresence>
          </div>
          <div className="flex gap-4">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={isCurrentUserActive ? "Skriv ett meddelande..." : "Du är inte aktiv..."}
              maxLength={200}
              disabled={!isCurrentUserActive}
              className="h-10 rounded-2xl border-2 font-body font-semibold"
            />
            <Button onClick={handleSend} disabled={!draft.trim() || !isCurrentUserActive} size="icon" className="h-10 w-10 shrink-0" aria-label="Skicka meddelande">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="game-card flex-1 lg:self-start">
          <h3 className="mb-3 font-display text-sm font-bold text-muted-foreground uppercase">Ledtrådar</h3>
          <div className="space-y-3">
            {Object.entries(submittedWords ?? {}).map(([userId, clue]) => {
              const player = users[userId]
              const isActivePlayer = activePlayers[userId]
              return (
                <div key={userId} className={cn("flex items-center justify-between gap-3", !isActivePlayer && "opacity-40")}>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-xs font-bold text-white" style={{ backgroundColor: player.background }}>
                      {player.username[0]}
                    </span>
                    <span className="truncate font-display text-sm font-semibold text-muted-foreground">{player.username}</span>
                  </div>
                  {/* snapIn gives a slight rotation, fits the "sneaky clue" feel */}
                  <AnimatePresence mode="wait">
                    {clue ? (
                      <motion.span key="clue" {...snapIn({ strength: 1.06, duration: 0.32 })} className="shrink-0 rounded-full border-2 border-border bg-card px-3 py-1 font-display text-sm font-bold text-foreground">
                        {clue}
                      </motion.span>
                    ) : (
                      <motion.span
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="shrink-0 rounded-full border-2 border-dashed border-border px-3 py-1 font-display text-sm font-bold text-muted-foreground"
                      >
                        —
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </PhaseTransition>
  )
}
