import { ArrowLeft, Play, BookOpenText, Loader2, UserRoundX } from "lucide-react"
import { Link, useParams } from "@tanstack/react-router"
import { useState, useEffect, Suspense } from "react"
import { motion } from "motion/react"

import { Button } from "@/components/ui/button"
import { PlayerList } from "@/components/lobby/PlayerList"
import { LobbyCodeDisplay } from "@/components/lobby/CodeDisplay"
import { GameModeSelector, GameSettings } from "@/components/lobby/GameSettings"
import { GameGuideSelector } from "@/components/guide/GameGuideSelector"

import { ToastError } from "@/lib/ToastFunctions"
import { log } from "@/lib/logger"
import { snapIn } from "@/lib/animation-utils"
import { BASE_GAME_MODES } from "@/lib/game/config"
import { useUserContext } from "@/hooks/user/Hook"
import { useOptionalLobbyContext } from "@/hooks/lobby/Hook"
import { useWebsocketContext } from "@/hooks/websocket/Hook"
import { cn } from "@/lib/utils"

function LobbyFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <Loader2 className="mb-4 h-10 w-10 animate-spin text-game-purple" />
      <p className="flex font-display font-semibold text-muted-foreground">
        Hämtar rum
        <span className="flex w-6">
          <span className="ml-0.5 animate-[loading_1.4s_infinite]">.</span>
          <span className="ml-0.5 animate-[loading_1.4s_infinite_0.2s]">.</span>
          <span className="ml-0.5 animate-[loading_1.4s_infinite_0.4s]">.</span>
        </span>
      </p>
    </div>
  )
}

export function LobbyPage() {
  const { lobbyCode } = useParams({ strict: false })
  return (
    <Suspense fallback={<LobbyFallback />}>
      <LobbyView code={lobbyCode ?? ""} />
    </Suspense>
  )
}

export function LobbyView({ code }: { code: string }) {
  const { user } = useUserContext()
  const lobby = useOptionalLobbyContext()
  const host = lobby?.host
  const users = lobby?.users
  const mode = lobby?.mode
  const { sendEvent, connectionStatus } = useWebsocketContext()
  const [hasAttemptedJoin, setHasAttemptedJoin] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  useEffect(() => {
    if (!code || typeof code !== "string") return

    if (connectionStatus === "connected" && user && !host && !hasAttemptedJoin) {
      setHasAttemptedJoin(true)
      log.lobby.info("auto-join from URL", { code })
      sendEvent("join_lobby", { lobby_code: code })
    }
  }, [connectionStatus, user, host, code, hasAttemptedJoin, sendEvent])

  if (!user || !host) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6">
        <Loader2 className="mb-4 h-10 w-10 animate-spin text-game-purple" />
        <p className="mb-6 flex font-display font-semibold text-muted-foreground">
          Ansluter till rummet
          <span className="flex w-6">
            <span className="ml-0.5 animate-[loading_1.4s_infinite]">.</span>
            <span className="ml-0.5 animate-[loading_1.4s_infinite_0.2s]">.</span>
            <span className="ml-0.5 animate-[loading_1.4s_infinite_0.4s]">.</span>
          </span>
        </p>
        <Link to="/">
          <Button variant="outline" className="font-body font-bold">
            Avbryt
          </Button>
        </Link>
      </div>
    )
  }

  const hostUser = users && host ? users[host] : null
  const hostName = hostUser?.username
  const handleLeave = () => {
    log.lobby.info("leave lobby clicked", { code })
    sendEvent("leave_lobby", null)
  }

  const isHost = host === user.user_id

  const handleStartGame = () => {
    if (!isHost) {
      log.lobby.warn("non-host tried to start game")
      ToastError("Endast hosten kan starta spelet.")
      return
    }
    log.lobby.info("host started game", { code, mode, players: Object.keys(users ?? {}).length })
    sendEvent("start_game", null)
  }

  const playerCount = Object.keys(users ?? {}).length
  const currentModeConfig = BASE_GAME_MODES.find((m) => m.id === mode) || BASE_GAME_MODES[0]
  const enoughPlayers = playerCount >= currentModeConfig.min_players

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="animate-slide-up w-full max-w-4xl">
        <motion.div className="relative mb-6 flex items-center justify-between" {...snapIn({ delay: 0.08, strength: 1.2, y: 10 })}>
          <div className="flex flex-1 justify-start">
            <Link to="/" className="flex items-center" onClick={handleLeave}>
              <button className="flex cursor-pointer items-center gap-2 text-muted-foreground transition-colors hover:text-foreground">
                <ArrowLeft className="h-4 w-4" />
                <span className="text-sm">Tillbaka</span>
              </button>
            </Link>
          </div>

          <h1 className="font-display text-4xl font-bold whitespace-nowrap text-game-purple max-[565px]:px-2 max-[565px]:text-center max-[565px]:text-2xl max-[565px]:whitespace-break-spaces">
            {hostName?.slice(-1) === "s" ? `${hostName} rum` : `${hostName}s rum`}
          </h1>
          <div className="flex-1" />
        </motion.div>
        <div>
          <div className="flex flex-col gap-6 md:grid md:grid-cols-5">
            <motion.div className="h-full md:col-span-3" {...snapIn({ delay: 0.16, x: -12, y: 12 })}>
              <div className="game-card h-full flex-1 rounded-2xl border border-border bg-card p-6 shadow-sm">
                <div className="flex flex-col gap-4">
                  <LobbyCodeDisplay />
                  <div className="flex items-center justify-between">
                    <p className="font-display text-sm font-bold tracking-wider text-muted-foreground uppercase">Spelläge</p>
                  </div>
                  <GameModeSelector />
                  <div className="flex items-center justify-between">
                    <p className="font-display text-sm font-bold tracking-wider text-muted-foreground uppercase">Spelinställningar</p>
                  </div>
                  <GameSettings />
                </div>
              </div>
            </motion.div>
            <motion.div className="h-full md:col-span-2" {...snapIn({ delay: 0.2, x: 12, y: 12 })}>
              <PlayerList className="h-full max-h-150" />
            </motion.div>
          </div>
          <motion.div className="mt-6 flex flex-col gap-6 sm:flex-row" {...snapIn({ delay: 0.24, y: 14, rotate: 1.5 })}>
            {/* <QuickGuide>
              <Button variant="glass" size="lg" className="min-h-12 flex-1 gap-2 font-body">
                Snabb Guide
                <BookOpenText />
              </Button>
            </QuickGuide> */}
            <Button variant="glass" size="lg" onClick={() => setShowGuide(true)} className="min-h-12 flex-1 gap-2 font-body">
              Snabb Guide
              <BookOpenText />
            </Button>

            <Button
              size="lg"
              disabled={!isHost || !enoughPlayers}
              onClick={handleStartGame}
              className={cn("min-h-12 flex-1 gap-2 font-body transition-all", (!isHost || !enoughPlayers) && "cursor-not-allowed opacity-50", isHost && !enoughPlayers && "cursor-not-allowed opacity-50")}
            >
              {isHost && enoughPlayers ? (
                <>
                  Starta
                  <Play className="h-4 w-4" />
                </>
              ) : isHost ? (
                <>
                  För få spelare för att starta
                  <UserRoundX className="h-4 w-4" />
                </>
              ) : !enoughPlayers ? (
                <>
                  Väntar på fler spelare...
                  <Loader2 className="h-4 w-4 animate-spin" />
                </>
              ) : (
                <>
                  Väntar på host...
                  <Loader2 className="h-4 w-4 animate-spin" />
                </>
              )}
            </Button>
          </motion.div>
        </div>
      </div>
      {showGuide && <GameGuideSelector onClose={() => setShowGuide(false)} />}
    </div>
  )
}
