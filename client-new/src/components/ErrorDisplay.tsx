import { AlertTriangle, Copy, Check } from "lucide-react"
import { Link } from "@tanstack/react-router"
import type { ErrorComponentProps } from "@tanstack/react-router"
import { useState } from "react"

export function ErrorDisplay({ error }: ErrorComponentProps) {
  const [copied, setCopied] = useState(false)
  const message = error?.message ?? "Ett oväntat fel inträffade."

  async function handleCopy() {
    await navigator.clipboard.writeText(message)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <AlertTriangle className="mb-4 h-10 w-10 text-game-purple" />
      <p className="mb-2 font-display text-2xl font-bold text-foreground">Något gick fel</p>
      <div className="mb-8 flex items-center gap-2">
        <p className="font-display text-sm text-muted-foreground">{message}</p>
        <button onClick={handleCopy} className="text-muted-foreground transition-colors hover:text-game-purple" aria-label="Kopiera felmeddelande">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <Link to="/" className="font-display text-sm font-semibold text-game-purple hover:underline">
        Tillbaka till startsidan
      </Link>
    </div>
  )
}
