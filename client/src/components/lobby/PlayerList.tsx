import { Crown, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { useRef } from "react"
import { useEffect } from "react"
import { useLobbyContext } from "@/hooks/lobby/Hook"
import type { User } from "@/hooks/user/types"
import { useUserContext } from "@/hooks/user/Hook"

interface PlayerListProps {
  className?: string
}

export function PlayerAvatar({ name, color, className }: { name: string; color: string; className?: string }) {
  //const initials = name.split(" ").map(n => n[0]).join("").toUpperCase();
  const split = name.split(" ")
  return (
    <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-card font-body font-bold text-white", className)} style={{ backgroundColor: color, boxShadow: `0 3px 0 0 ${color}88` }}>
      {/*style={{ backgroundColor: p.color, boxShadow: `0 3px 0 0 ${p.color}88` }} */}
      {split.length >= 2 ? `${split[0][0]}${split[1][0]}` : name[0]}
    </div>
  )
}

function PlayerCard({ player }: { player: User }) {
  const { host } = useLobbyContext()
  const { user } = useUserContext()
  const [shouldAnimate, setShouldAnimate] = useState(false)
  const textRef = useRef<HTMLSpanElement>(null)

  const isHost = host === player.user_id
  const currentPlayer = user?.user_id === player.user_id

  useEffect(() => {
    if (textRef.current) {
      const containerWidth = textRef.current.parentElement?.clientWidth || 0
      const textWidth = textRef.current.scrollWidth
      setShouldAnimate(textWidth > containerWidth)
    }
  }, [player.username])

  return (
    <div className="group flex items-center gap-4 rounded-lg border-2 border-border bg-muted/50 px-4 py-3 font-display transition-all hover:border-primary">
      <PlayerAvatar name={player.username} color={player.background} />
      <div className="min-w-0 flex-1">
        <div className="relative w-full overflow-hidden">
          <span ref={textRef} className={cn("inline-block cursor-default text-base font-bold whitespace-nowrap text-foreground", shouldAnimate && "group-hover:animate-[marquee_5s_linear_infinite]")}>
            {player.username}
            {currentPlayer && <span className="ml-2 shrink-0 text-xs text-muted-foreground"> (Du)</span>}
          </span>
        </div>
      </div>
      {isHost && (
        <div className="flex items-center rounded-md bg-game-yellow/20 p-2">
          <Crown className="size-6 shrink-0 stroke-3 text-game-yellow" />
        </div>
      )}
    </div>
  )
}

function EmptySlot() {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-dashed border-border/90 bg-muted/5 px-4 py-3 opacity-90">
      <div className="flex h-10 w-10 shrink-0 animate-pulse items-center justify-center rounded-full border border-dashed border-border/50 bg-muted/10 text-muted-foreground/30">?</div>
      <div className="flex-1">
        <span className="flex animate-pulse text-sm text-muted-foreground/60 italic">
          Väntar på spelare
          <span className="flex w-6">
            <span className="ml-0.5 animate-[loading_1.4s_infinite]">.</span>
            <span className="ml-0.5 animate-[loading_1.4s_infinite_0.2s]">.</span>
            <span className="ml-0.5 animate-[loading_1.4s_infinite_0.4s]">.</span>
          </span>
        </span>
      </div>
    </div>
  )
}

export function PlayerList({ className }: PlayerListProps) {
  const { users: all_players } = useLobbyContext()
  const { user } = useUserContext()
  const MAX_SLOTS = 12
  const playerCount = Object.values(all_players ?? {}).length
  const emptySlotsCount = Math.max(0, MAX_SLOTS - playerCount)
  const players = all_players ? Object.values(all_players).map((player) => (user && player.user_id === user.user_id ? user : player)) : []

  return (
    <div className={cn("game-card flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm", className)}>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex shrink-0 items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-sm font-bold tracking-wider text-muted-foreground uppercase">
            <Users className="h-4 w-4" />
            Spelare
          </h2>
          <span className="rounded-full bg-muted px-2.5 py-0.5 font-display text-sm font-bold text-foreground tabular-nums">{playerCount}/12</span>
        </div>

        <div className="custom-scrollbar flex flex-1 flex-col gap-2 overflow-y-auto">
          {players.map((player) => (
            <PlayerCard key={player.user_id} player={player} />
          ))}
          {Array.from({ length: emptySlotsCount }).map((_, index) => (
            <EmptySlot key={`empty-${index}`} />
          ))}
        </div>
      </div>
    </div>
  )
}
