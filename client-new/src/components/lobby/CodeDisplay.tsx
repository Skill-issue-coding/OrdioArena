import { useLobbyContext } from "@/hooks/lobby/Hook"
import { Copy, Check } from "lucide-react"
import { useState } from "react"

export function LobbyCodeDisplay() {
  const [copied, setCopied] = useState(false)
  const { code } = useLobbyContext()

  const handleCopy = () => {
    navigator.clipboard.writeText(code || "xxxx-xxxx")
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const chars = (code || "xxxx-xxxx").split("")

  return (
    <button onClick={handleCopy} className="group flex cursor-pointer items-center justify-center gap-3 rounded-lg border border-border bg-muted/40 px-5 py-2.5 transition-colors hover:bg-border/50 max-[565px]:px-3 md:max-[920px]:px-3">
      {/*<span className="font-display text-2xl font-bold tracking-[0.3em] text-neon-green text-glow-green">{code}</span>*/}
      <div className="flex items-center gap-1.5">
        {chars.map((c, i) =>
          c === "-" ? (
            <span key={i} className="px-1 font-display text-2xl font-bold text-muted-foreground max-[565px]:text-lg md:max-[920px]:text-lg">
              -
            </span>
          ) : (
            <span
              key={i}
              className="game-tile flex h-12 w-10 items-center justify-center font-display text-2xl font-bold text-game-purple max-[565px]:h-10 max-[565px]:w-8 max-[565px]:text-lg md:max-[920px]:h-10 md:max-[920px]:w-8 md:max-[920px]:text-lg"
            >
              {c}
            </span>
          )
        )}
      </div>
      {copied ? <Check className="h-5 w-5 text-game-green" /> : <Copy className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-foreground" />}
    </button>
  )
}
