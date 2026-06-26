"use client"

import PhaseTransition from "@/components/game/PhaseTransition"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn, isStringEmptyOrOnlySpaces } from "@/lib/utils"
import { useState } from "react"
import { Send } from "lucide-react"
import { useWebsocketContext } from "@/hooks/websocket/Hook"
import { useImpostorGame } from "@/hooks/game/Hook"
import { useUserContext } from "@/hooks/user/Hook"
import { useLobbyContext } from "@/hooks/lobby/Hook"
import { ToastError } from "@/lib/ToastFunctions"

export function InputPhase() {
  const { sendEvent } = useWebsocketContext()
  const game = useImpostorGame()
  const { user } = useUserContext()
  const { users } = useLobbyContext()
  const [wordSubmission, setWordSubmission] = useState<string>("")

  if (!user || !users) return null

  const isImpostor = game.role === "impostor"

  const sendWordSubmission = () => {
    if (game.current_player !== user.user_id) {
      ToastError("Det är inte din tur!")
      return
    }
    if (isStringEmptyOrOnlySpaces(wordSubmission) || wordSubmission.length > 128) {
      ToastError("Skriv in ett ord")
      return
    }
    sendEvent("game_submit_word", { word: wordSubmission })
  }

  const submittedWords = game.rounds[game.current_round]?.submissions ?? {}
  const activePlayers = game.active_players
  const isCurrentPlayer = game.current_player === user.user_id

  return (
    <PhaseTransition phaseKey="input">
      <div className="flex w-full max-w-4xl flex-col items-center gap-6">
        <div className="flex w-full max-w-4xl flex-col justify-between gap-6 lg:flex-row">
          {isCurrentPlayer && (
            <div className="game-card flex flex-1 shrink-0 flex-col items-center justify-center gap-6 self-start text-center">
              <div className="text-center">
                <p className={cn("mb-2 font-display text-sm font-bold tracking-wider text-muted-foreground uppercase", isImpostor ? "text-destructive" : "text-muted-foreground")}>{isImpostor ? "Hitta på en bluff" : "Ange en ledtråd"}</p>
                <p className="font-display text-xs text-muted-foreground">{isImpostor ? "Välj ett ord som får dig att smälta in i gruppen" : "Skriv ett ord relaterat till ditt hemliga ord"}</p>
              </div>
              <div className="flex w-full items-center justify-center gap-3">
                <Input
                  value={wordSubmission}
                  onChange={(e) => setWordSubmission(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      sendWordSubmission()
                    }
                  }}
                  placeholder={isImpostor ? "Skriv en bluff..." : "Skriv en ledtråd..."}
                  className="h-12 rounded-2xl border-2 bg-card font-display text-lg font-bold"
                  maxLength={128}
                  autoFocus
                />
                <Button onClick={sendWordSubmission} disabled={!wordSubmission.trim() || !isCurrentPlayer} size="icon" className="size-12 shrink-0" aria-label="Skicka meddelande">
                  <Send className="size-5" />
                </Button>
              </div>
            </div>
          )}
          <div className="game-card flex-1">
            <h3 className="mb-3 font-display text-sm font-bold text-muted-foreground uppercase">Ledtrådar</h3>
            <div className="space-y-3">
              {Object.entries(users ?? {}).map(([userId, player]) => {
                const isActivePlayer = activePlayers[userId]
                const clue = submittedWords[userId]
                return (
                  <div key={userId} className={cn("flex items-center justify-between gap-3", !isActivePlayer && "opacity-40")}>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-xs font-bold text-white" style={{ backgroundColor: player.background }}>
                        {player.username[0]}
                      </span>
                      <span className="truncate font-display text-sm font-semibold text-muted-foreground">{player.username}</span>
                    </div>
                    {clue ? (
                      <span className="shrink-0 rounded-full border-2 border-border bg-card px-3 py-1 font-display text-sm font-bold text-foreground">{clue}</span>
                    ) : (
                      <span className="shrink-0 rounded-full border-2 border-dashed border-border px-3 py-1 font-display text-sm font-bold text-muted-foreground">—</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </PhaseTransition>
  )
}
