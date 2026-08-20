import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { GameModeGuide } from "./types"

interface GameGuideProps {
  guide: GameModeGuide
  onBack: () => void
  onComplete?: () => void
}

export function GameGuide({ guide, onBack, onComplete }: GameGuideProps) {
  const [step, setStep] = useState(0)
  const current = guide.steps[step]
  const StepComponent = current.component
  const Icon = current.icon
  const isLast = step === guide.steps.length - 1

  const next = useCallback(() => {
    if (isLast) {
      onComplete?.()
      onBack()
    } else {
      setStep((p) => p + 1)
    }
  }, [isLast, onComplete, onBack])

  const prev = useCallback(() => setStep((p) => Math.max(p - 1, 0)), [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault()
        next()
      }
      if (e.key === "ArrowLeft") prev()
      if (e.key === "Escape") onBack()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [next, prev, onBack])

  const accentColor = `var(${guide.cssVar})`

  return (
    <div className="absolute flex h-screen w-screen flex-col overflow-hidden bg-background">
      {/* Progress bar */}
      <div className="h-1 bg-muted">
        <motion.div className="h-full" style={{ backgroundColor: accentColor }} animate={{ width: `${((step + 1) / guide.steps.length) * 100}%` }} transition={{ type: "spring", stiffness: 200, damping: 30 }} />
      </div>

      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          <span className="font-display font-medium">Tillbaka</span>
        </button>
        <span className="font-display text-xs text-muted-foreground">
          {step + 1} / {guide.steps.length}
        </span>
      </div>

      {/* Step dots */}
      <div className="flex items-center justify-center gap-2 pb-3">
        {guide.steps.map((s, i) => (
          <motion.button
            key={s.id}
            onClick={() => setStep(i)}
            className="rounded-full"
            animate={{ width: i === step ? 24 : 6 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            style={{
              height: 6,
              backgroundColor: accentColor,
              opacity: i === step ? 1 : i < step ? 0.4 : 0.15,
            }}
          />
        ))}
      </div>

      {/* Header */}
      <AnimatePresence mode="wait">
        <motion.div key={current.id + "-header"} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.2 }} className="flex items-center justify-center gap-3 py-2">
          <div className="rounded-xl p-2.5" style={{ backgroundColor: `color-mix(in oklch, ${accentColor} 12%, transparent)` }}>
            <Icon className="h-5 w-5" style={{ color: accentColor }} />
          </div>
          <h2 className="font-display text-xl font-bold text-foreground">{current.title}</h2>
        </motion.div>
      </AnimatePresence>

      {/* Content */}
      <div className="flex flex-1 items-center justify-center overflow-hidden px-8 py-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="flex w-full max-w-xl flex-col items-center justify-center"
          >
            <StepComponent onNext={next} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between px-8 py-4">
        <Button onClick={prev} disabled={step === 0} variant="outline" className="gap-2 font-display">
          <ChevronLeft className="h-4 w-4" />
          Föregående
        </Button>
        <span className="hidden font-mono text-xs text-muted-foreground sm:block">← → för att navigera</span>
        <Button onClick={next} className="gap-2 font-display" style={{ backgroundColor: accentColor }}>
          {isLast ? "Klar" : "Nästa"}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
