import { motion } from "motion/react"
import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { ALL_MODES, GUIDE_REGISTRY } from "./registry"
import { GameGuide } from "./GameGuide"
import type { GameModeGuide } from "./types"
import { useUIOverlay } from "@/hooks/ui/Hook"

interface GameGuideSelectorProps {
  onClose: () => void
}

export function GameGuideSelector({ onClose }: GameGuideSelectorProps) {
  const [selected, setSelected] = useState<GameModeGuide | null>(null)
  const { setOverlayActive } = useUIOverlay()

  useEffect(() => {
    setOverlayActive(true)
    return () => setOverlayActive(false)
  }, [setOverlayActive])

  if (selected) return <GameGuide guide={selected} onBack={() => setSelected(null)} onComplete={onClose} />

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 p-6 backdrop-blur-sm">
      <button onClick={onClose} className="absolute top-5 right-5 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
        <X className="h-5 w-5" />
      </button>

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8 text-center">
        <h1 className="mb-2 font-display text-3xl font-bold text-foreground">Spelguide</h1>
        <p className="font-display text-sm text-muted-foreground">Välj ett spelläge för att lära dig hur det fungerar</p>
      </motion.div>

      <div className="grid w-full max-w-2xl grid-cols-2 gap-4">
        {ALL_MODES.map((mode, i) => {
          const guide = GUIDE_REGISTRY.find((g) => g.mode === mode.mode)
          const hasGuide = !!guide
          const Icon = mode.icon
          const accentColor = `var(${mode.cssVar})`

          return (
            <motion.button
              key={mode.mode}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, type: "spring", stiffness: 300, damping: 24 }}
              whileHover={hasGuide ? { y: -2 } : undefined}
              onClick={() => hasGuide && setSelected(guide)}
              disabled={!hasGuide}
              className={`relative flex flex-col items-start gap-3 rounded-2xl border bg-card p-5 text-left transition-shadow duration-200 ${
                hasGuide ? "cursor-pointer border-border hover:shadow-md" : "cursor-not-allowed border-border/50 opacity-50"
              }`}
            >
              {!hasGuide && <span className="absolute top-3 right-3 rounded-full bg-muted px-2 py-0.5 font-display text-[10px] font-semibold text-muted-foreground">Kommer snart</span>}

              <div
                className="rounded-xl p-2.5"
                style={{
                  backgroundColor: `color-mix(in oklch, ${accentColor} 12%, transparent)`,
                }}
              >
                <Icon className="h-6 w-6" style={{ color: accentColor }} />
              </div>

              <div>
                <div className="mb-0.5 font-display text-base font-bold text-foreground">{mode.label}</div>
                <div className="font-display text-sm leading-snug text-muted-foreground">{mode.description}</div>
              </div>

              {hasGuide && (
                <div className="mt-auto font-display text-xs font-semibold" style={{ color: accentColor }}>
                  Visa guide →
                </div>
              )}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
