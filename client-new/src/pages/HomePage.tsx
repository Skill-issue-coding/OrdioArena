// import { Gamepad2 } from "lucide-react"
import { motion } from "motion/react"
import { useNavigate } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { popIn } from "@/lib/animation-utils"
import { useEffect, useRef, useState } from "react"
import { useWebsocketContext } from "@/hooks/websocket/Hook"
import { LogoIcon } from "@/components/LogoIcon"

const formatCode = (val: string) => {
  const clean = val.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)
  if (clean.length > 4) return clean.slice(0, 4) + "-" + clean.slice(4)
  return clean
}

export function HomePage() {
  const { sendEvent, subscribe } = useWebsocketContext()
  const navigate = useNavigate()

  const [roomCode, setRoomCode] = useState("")
  const pendingCodeRef = useRef("")

  useEffect(() => {
    const unsubSync = subscribe("sync_gamestate", (payload) => (pendingCodeRef.current = payload.lobbystate.code))
    const unsubJoined = subscribe("joined_lobby", () => {
      if (pendingCodeRef.current) navigate({ to: `/lobby/${pendingCodeRef.current}` })
    })
    return () => {
      unsubSync()
      unsubJoined()
    }
  }, [navigate, subscribe])

  const handleCreateLobby = () => sendEvent("create_lobby", null)
  const handleJoinLobby = () => sendEvent("join_lobby", { lobby_code: roomCode })

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center overflow-hidden p-6">
      <div className="animate-slide-up flex w-full max-w-md flex-col gap-4">
        <motion.div className="mb-2 text-center" {...popIn(0.15, 1.5)}>
          <div className="mb-2 inline-flex items-center justify-center gap-2">
            <LogoIcon className="size-14" variant="v1" />
            {/* <Gamepad2 className="h-14 w-14 text-game-purple" /> */}
            <h1 className="font-display text-4xl font-bold text-game-purple sm:text-6xl">
              Ordio<span className="text-game-pink">Arena</span>
            </h1>
          </div>
          <p className="font-display text-lg font-semibold text-muted-foreground">Snabbtänkt multiplayer ordspel</p>
        </motion.div>

        <motion.div className="game-card border-game-blue/30" {...popIn(0.5)}>
          <h2 className="mb-3 flex items-center gap-2 font-display text-base font-bold text-foreground">Gå med i rum</h2>
          <div className="flex gap-2">
            <Input
              placeholder="xxxx-xxxx"
              value={roomCode}
              onChange={(e) => setRoomCode(formatCode(e.target.value.toLowerCase()))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleJoinLobby()
                }
              }}
              className="h-12 rounded-lg border-2 bg-muted text-center font-body text-base font-bold tracking-widest"
              maxLength={9}
            />
            <Button size="lg" onClick={handleJoinLobby} disabled={roomCode.replace("-", "").length !== 8} className="h-12 px-8 text-base font-bold">
              Gå med
            </Button>
          </div>
        </motion.div>

        <motion.div className="mt-1.5 flex items-center gap-3" {...popIn(0.55)}>
          <div className="h-px flex-1 bg-border" />
          <span className="font-display text-xs font-bold tracking-widest text-muted-foreground uppercase">eller</span>
          <div className="h-px flex-1 bg-border" />
        </motion.div>

        <motion.div {...popIn(0.45)}>
          <Button size="lg" className="mb-4 h-16 w-full text-lg font-bold" onClick={handleCreateLobby}>
            Skapa rum +
          </Button>
        </motion.div>
      </div>
    </div>
  )
}
