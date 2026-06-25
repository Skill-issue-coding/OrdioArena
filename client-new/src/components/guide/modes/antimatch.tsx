import { CheckCircle, MessageSquareMore, Shuffle, Trophy, X } from "lucide-react"
import type { GameModeGuide, GuideStepProps } from "../types"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useState } from "react"

const StepIntro = () => (
  <div className="flex flex-col items-center gap-8">
    <motion.div initial={{ scale: 0, rotate: -15 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 18 }} className="rounded-3xl bg-game-orange/10 p-8">
      <Shuffle className="h-20 w-20 text-game-orange" />
    </motion.div>

    <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="max-w-sm text-center font-display text-base text-muted-foreground">
      Alla spelare får <span className="font-bold text-game-orange">samma ord</span>. Skriv in en synonym — men se till att <span className="font-bold text-foreground">inte skriva</span> samma sak som någon annan.
    </motion.p>

    <div className="flex w-full max-w-xs flex-col gap-2">
      {["Alla ser samma ord", "Skriv en synonym — var nära men unik", "Dubbletter ger 0 poäng"].map((text, i) => (
        <motion.div key={text} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 + i * 0.15 }} className="flex items-center gap-3 rounded-xl bg-muted/60 px-4 py-2.5">
          <span className="font-display text-sm font-bold text-game-orange">{i + 1}</span>
          <span className="font-display text-sm text-foreground">{text}</span>
        </motion.div>
      ))}
    </div>
  </div>
)

const TYPED_WORD = "Fordon"

const StepWordAndInput = ({ onNext }: GuideStepProps) => {
  const [wordRevealed, setWordRevealed] = useState(false)
  const [typed, setTyped] = useState(0)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setWordRevealed(true), 700)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!wordRevealed || typed >= TYPED_WORD.length) return
    const t = setTimeout(() => setTyped((p) => p + 1), 130)
    return () => clearTimeout(t)
  }, [wordRevealed, typed])

  useEffect(() => {
    if (typed < TYPED_WORD.length) return
    const t = setTimeout(() => {
      setSubmitted(true)
      setTimeout(() => onNext?.(), 900)
    }, 600)
    return () => clearTimeout(t)
  }, [typed, onNext])

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-2">
        <span className="font-display text-xs font-semibold tracking-widest text-muted-foreground uppercase">Ordet denna runda</span>
        <div className="flex items-center justify-center rounded-2xl border border-game-orange/20 bg-game-orange/10 px-12 py-5">
          <AnimatePresence mode="wait">
            {wordRevealed ? (
              <motion.div key="word" initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 20 }} className="font-display text-4xl font-black text-game-orange">
                Bil
              </motion.div>
            ) : (
              <motion.div key="hidden" exit={{ opacity: 0, scale: 0.5 }} className="font-display text-4xl font-black text-muted-foreground/30 select-none">
                ???
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {!submitted ? (
          <motion.div
            key="input"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: wordRevealed ? 1 : 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex min-h-12 w-full max-w-xs items-center rounded-xl border-2 border-input bg-card px-4 py-3"
          >
            <span className="font-display text-xl font-bold text-foreground">
              {TYPED_WORD.slice(0, typed)}
              {typed < TYPED_WORD.length && <span className="ml-0.5 inline-block h-5 w-0.5 animate-pulse bg-game-orange align-middle" />}
            </span>
          </motion.div>
        ) : (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className="flex min-h-12 w-full max-w-xs items-center justify-center gap-2 rounded-xl border-2 border-game-green/30 bg-game-green/10 px-4 py-3"
          >
            <CheckCircle className="h-6 w-6 text-game-green" />
            <span className="font-display text-xl font-bold text-game-green">{TYPED_WORD}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.p initial={{ opacity: 0 }} animate={{ opacity: wordRevealed ? 1 : 0 }} transition={{ delay: 0.4 }} className="text-center font-display text-sm text-muted-foreground">
        Skriv en synonym till <span className="font-bold text-game-orange">Bil</span> — men var <span className="font-bold text-foreground">unik</span>. Skriver två spelare samma ord ger båda 0 poäng.
      </motion.p>
    </div>
  )
}

const RESULTS = [
  { name: "Du", initial: "D", word: "Fordon", points: 85, isDuplicate: false, isWinner: true },
  { name: "Anna", initial: "A", word: "Transport", points: 62, isDuplicate: false, isWinner: false },
  { name: "Björn", initial: "B", word: "Buss", points: 0, isDuplicate: true, isWinner: false },
  { name: "Cecilia", initial: "C", word: "Buss", points: 0, isDuplicate: true, isWinner: false },
]

const StepResult = () => {
  const [showFails, setShowFails] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setShowFails(true), 1200)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <div className="font-display text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1">Rundaresultat</div>
        <div className="font-display text-2xl font-extrabold text-foreground">"Bil"</div>
      </motion.div>

      <div className="w-full max-w-sm flex flex-col gap-2">
        {RESULTS.map((r, i) => (
          <motion.div
            key={r.name}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.12, type: "spring", stiffness: 300, damping: 24 }}
            className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3 transition-all duration-500 ${
              r.isDuplicate && showFails
                ? "border-game-red bg-game-red/5"
                : r.isWinner
                  ? "border-game-green bg-game-green/10"
                  : "border-border bg-card"
            }`}
          >
            <div className="w-5 shrink-0 text-center font-display font-extrabold text-sm text-muted-foreground">{i + 1}</div>
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ${
                r.isWinner ? "bg-game-green/20 text-game-green" : r.isDuplicate ? "bg-game-red/15 text-game-red" : "bg-muted text-muted-foreground"
              }`}
            >
              {r.initial}
            </div>
            <div className="flex-1 min-w-0">
              <div className="relative inline-block">
                <div className="font-display text-xs text-muted-foreground">{r.name}</div>
                {r.isDuplicate && showFails && (
                  <motion.div
                    className="absolute top-1/2 left-[-5%] right-[-5%] h-0.5 bg-game-red origin-left rounded-full"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                  />
                )}
              </div>
              <div className="font-display font-extrabold text-lg truncate flex items-center gap-2">
                "{r.word}"
                {r.isDuplicate && <span className="text-[10px] font-display font-extrabold text-game-red uppercase tracking-wider">· Dubblett</span>}
              </div>
            </div>
            <div
              className={`font-display font-extrabold text-lg w-10 text-right shrink-0 ${
                r.isDuplicate && showFails ? "text-game-red" : r.isWinner ? "text-game-green" : "text-muted-foreground"
              }`}
            >
              {r.isDuplicate && showFails ? <X className="h-5 w-5 stroke-[3px] ml-auto" /> : `+${r.points}p`}
            </div>
          </motion.div>
        ))}
      </div>

      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }} className="text-center font-display text-xs text-muted-foreground">
        <span className="font-semibold text-game-orange">Närmast synonymen</span> vinner rundan — dubbletter ger <span className="font-semibold text-game-red">0 poäng</span>.
      </motion.p>
    </div>
  )
}

const WIN_CONDITIONS = [
  {
    label: "Närmast synonymen",
    desc: "Flest poäng per runda",
    icon: CheckCircle,
    color: "text-game-green",
    bg: "bg-game-green/10",
    border: "border-game-green/20",
    delay: 0.2,
  },
  {
    label: "Unik synonym",
    desc: "Dubbletter ger alltid 0 poäng",
    icon: X,
    color: "text-game-red",
    bg: "bg-game-red/10",
    border: "border-game-red/20",
    delay: 0.4,
  },
  {
    label: "Flest poäng totalt",
    desc: "Vinner hela spelet",
    icon: Trophy,
    color: "text-game-yellow",
    bg: "bg-game-yellow/10",
    border: "border-game-yellow/20",
    delay: 0.6,
  },
]

const StepWin = () => (
  <div className="flex flex-col items-center gap-8">
    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 250, damping: 16 }}>
      <Trophy className="h-16 w-16 text-game-yellow" />
    </motion.div>

    <div className="flex w-full max-w-sm flex-col gap-3">
      {WIN_CONDITIONS.map((c) => {
        const Icon = c.icon
        return (
          <motion.div key={c.label} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: c.delay, type: "spring", stiffness: 300 }} className={`flex items-center gap-4 rounded-2xl border ${c.border} ${c.bg} px-5 py-4`}>
            <div className={`rounded-xl ${c.bg} shrink-0 p-2`}>
              <Icon className={`h-5 w-5 ${c.color}`} />
            </div>
            <div>
              <div className={`font-display text-sm font-bold ${c.color}`}>{c.label}</div>
              <div className="font-display text-sm text-muted-foreground">{c.desc}</div>
            </div>
          </motion.div>
        )
      })}
    </div>

    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.85 }} className="text-center font-display text-xs text-muted-foreground">
      Spelet spelas över flera rundor — den med flest totalpoäng vinner!
    </motion.p>
  </div>
)

export const antiMatchGuide: GameModeGuide = {
  mode: "anti_match",
  label: "Anti-Match",
  description: "Skriv en synonym, men va unik.",
  cssVar: "--game-orange",
  icon: Shuffle,
  steps: [
    { id: "intro", title: "Vad är Anti-Match?", icon: Shuffle, component: StepIntro },
    { id: "input", title: "Skriv din synonym", icon: MessageSquareMore, component: StepWordAndInput },
    { id: "result", title: "Rundaresultat", icon: CheckCircle, component: StepResult },
    { id: "win", title: "Vinn spelet", icon: Trophy, component: StepWin },
  ],
}
