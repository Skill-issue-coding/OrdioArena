import { CheckCircle, Eye, MessageCircle, Sparkles, Trophy, UserX } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useState } from "react"
import type { GameModeGuide, GuideStepProps } from "../types"

const StepIntro = () => (
  <div className="flex flex-col items-center gap-8">
    <motion.div initial={{ scale: 0, rotate: -15 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 18 }} className="rounded-3xl bg-game-purple/10 p-8">
      <Eye className="h-20 w-20 text-game-purple" />
    </motion.div>

    <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="max-w-sm text-center font-display text-base text-muted-foreground">
      Alla spelare får se ett <span className="font-bold text-foreground">hemligt ord</span> men en person har fått ett <span className="font-bold text-game-purple">helt annat</span>. Kan ni avslöja vem som är the impostor?
    </motion.p>

    <div className="flex w-full max-w-xs flex-col gap-2">
      {["Alla beskriver sitt hemliga ord", "Diskutera vem som verkar ha fel ord", "Rösta bort impostorn"].map((text, i) => (
        <motion.div key={text} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 + i * 0.15 }} className="flex items-center gap-3 rounded-xl bg-muted/60 px-4 py-2.5">
          <span className="font-display text-sm font-bold text-game-purple">{i + 1}</span>
          <span className="font-display text-sm text-foreground">{text}</span>
        </motion.div>
      ))}
    </div>
  </div>
)

const StepRoles = () => {
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 900)
    return () => clearTimeout(t)
  }, [])

  const cards = [
    {
      role: "Normal spelare",
      word: "HUND",
      color: "text-game-green",
      bg: "bg-game-green/10",
      border: "border-game-green/20",
      delay: 0.15,
    },
    {
      role: "Impostor",
      word: "HUSDJUR",
      color: "text-game-purple",
      bg: "bg-game-purple/10",
      border: "border-game-purple/20",
      delay: 0.4,
    },
  ]

  return (
    <div className="flex flex-col items-center gap-8">
      <div className="flex gap-4">
        {cards.map((card) => (
          <motion.div
            key={card.role}
            initial={{ opacity: 0, scale: 0.7, rotateY: -25 }}
            animate={{ opacity: 1, scale: 1, rotateY: 0 }}
            transition={{ delay: card.delay, type: "spring", stiffness: 280, damping: 22 }}
            className={`flex flex-col items-center gap-3 rounded-2xl border ${card.border} ${card.bg} px-8 py-5`}
          >
            <span className="font-display text-xs font-semibold tracking-wider text-muted-foreground uppercase">{card.role}</span>
            <AnimatePresence mode="wait">
              {revealed ? (
                <motion.div key="word" initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 20 }} className={`font-display text-3xl font-black ${card.color}`}>
                  {card.word}
                </motion.div>
              ) : (
                <motion.div key="hidden" exit={{ opacity: 0, scale: 0.5 }} className="font-display text-3xl font-black text-muted-foreground/30 select-none">
                  ???
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </div>

      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }} className="max-w-sm text-center font-display text-sm text-muted-foreground">
        Normal spelare ser riktiga ordet. Impostorn ser ett <span className="font-semibold text-game-purple">liknande men annorlunda</span> ord, och vet att hen är impostorn.
      </motion.p>
    </div>
  )
}

const DESCRIPTION = "Päls"

const StepDescribe = ({ onNext }: GuideStepProps) => {
  const [typed, setTyped] = useState(0)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (typed >= DESCRIPTION.length) return
    const t = setTimeout(() => setTyped((p) => p + 1), 65)
    return () => clearTimeout(t)
  }, [typed])

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2">
        <span className="font-display text-sm text-muted-foreground">Ditt ord:</span>
        <span className="font-display text-2xl font-black text-game-green">HUND</span>
      </motion.div>

      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }} className="min-h-11 w-full max-w-sm rounded-xl border border-input bg-card px-4 py-3">
        <span className="font-sans text-foreground">{DESCRIPTION.slice(0, typed)}</span>
        {typed < DESCRIPTION.length && <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-game-purple align-middle" />}
      </motion.div>

      <AnimatePresence mode="wait">
        {typed >= DESCRIPTION.length && !submitted && (
          <motion.button
            key="submit"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            onClick={() => {
              setSubmitted(true)
              setTimeout(() => onNext?.(), 800)
            }}
            className="flex cursor-pointer items-center gap-2 rounded-xl bg-game-purple px-5 py-2.5 font-display text-sm font-semibold text-white"
          >
            <CheckCircle className="h-4 w-4" />
            Skicka svar
          </motion.button>
        )}
        {submitted && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-2 rounded-xl border border-game-green/20 bg-game-green/10 px-5 py-2.5 font-display text-sm font-semibold text-game-green"
          >
            <Sparkles className="h-4 w-4" />
            Svaret skickat!
          </motion.div>
        )}
      </AnimatePresence>

      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="text-center font-display text-xs text-muted-foreground">
        Beskriv ditt ord utan att avslöja det direkt, men om är du impostor? <span className="font-semibold text-game-purple">Bluffa!</span>
      </motion.p>
    </div>
  )
}

const SUBMISSIONS = [
  { player: "Anna", initial: "A", text: "Päls", impostor: false },
  { player: "Björn", initial: "B", text: "Bäste vännen", impostor: false },
  { player: "Cecilia", initial: "C", text: "Gnagare", impostor: true },
  { player: "David", initial: "D", text: "Skäller och leker", impostor: false },
]

const StepDiscussion = () => (
  <div className="flex w-full max-w-sm flex-col items-center gap-3">
    {SUBMISSIONS.map((s, i) => (
      <motion.div
        key={s.player}
        initial={{ opacity: 0, x: -24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: i * 0.2, type: "spring", stiffness: 300, damping: 24 }}
        className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 ${s.impostor ? "border-game-purple/30 bg-game-purple/5" : "border-border bg-card"}`}
      >
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-xs font-bold ${s.impostor ? "bg-game-purple/15 text-game-purple" : "bg-muted text-muted-foreground"}`}>{s.initial}</div>
        <div>
          <div className="mb-0.5 font-display text-xs text-muted-foreground">{s.player}</div>
          <div className="font-sans text-sm text-foreground">"{s.text}"</div>
        </div>
      </motion.div>
    ))}

    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }} className="pt-2 text-center font-display text-xs text-muted-foreground">
      Vems svar passar <span className="font-semibold text-game-purple">inte in</span>?
    </motion.p>
  </div>
)

const VOTERS = ["Anna", "Björn", "David"]

const StepVote = () => {
  const [votes, setVotes] = useState(0)
  const [eliminated, setEliminated] = useState(false)

  useEffect(() => {
    if (votes >= VOTERS.length) {
      const t = setTimeout(() => setEliminated(true), 500)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setVotes((p) => p + 1), 700)
    return () => clearTimeout(t)
  }, [votes])

  return (
    <div className="flex flex-col items-center gap-6">
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-display text-sm text-muted-foreground">
        Vem röstar ni ut?
      </motion.p>

      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={eliminated ? { opacity: 0.5, scale: 0.92 } : { opacity: 1, scale: 1 }}
        transition={{ duration: 0.35 }}
        className="relative flex items-center gap-4 rounded-2xl border border-game-purple/30 bg-game-purple/10 px-6 py-4"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-game-purple/20 font-display text-sm font-bold text-game-purple">C</div>
        <div>
          <div className="font-display text-sm font-semibold text-foreground">Cecilia</div>
          <div className="font-display text-xs text-muted-foreground">"Gnagare"</div>
        </div>
        <div className="ml-2 font-display text-xl font-black text-game-purple">
          {votes}
          <span className="text-sm font-normal text-muted-foreground">/{VOTERS.length}</span>
        </div>

        <AnimatePresence>
          {eliminated && (
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -top-2.5 -right-2.5 rounded-full bg-game-purple p-1.5">
              <UserX className="h-3.5 w-3.5 text-white" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="flex gap-2">
        {VOTERS.map((v, i) => (
          <motion.div
            key={v}
            initial={{ scale: 0 }}
            animate={votes > i ? { scale: 1 } : { scale: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 22 }}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-muted font-display text-xs font-bold text-muted-foreground"
          >
            {v[0]}
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {eliminated && (
          <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-center font-display text-sm text-muted-foreground">
            Cecilia var <span className="font-bold text-game-purple">impostorn</span>, de normala spelarna vinner!
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

const WIN_CONDITIONS = [
  {
    who: "Normal spelare",
    how: "Rösta bort impostorn",
    icon: CheckCircle,
    color: "text-game-green",
    bg: "bg-game-green/10",
    border: "border-game-green/20",
    delay: 0.25,
  },
  {
    who: "Impostorn",
    how: "Överlev utan att bli avslöjad",
    icon: Eye,
    color: "text-game-purple",
    bg: "bg-game-purple/10",
    border: "border-game-purple/20",
    delay: 0.5,
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
          <motion.div key={c.who} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: c.delay, type: "spring", stiffness: 300 }} className={`flex items-center gap-4 rounded-2xl border ${c.border} ${c.bg} px-5 py-4`}>
            <div className={`rounded-xl ${c.bg} shrink-0 p-2`}>
              <Icon className={`h-5 w-5 ${c.color}`} />
            </div>
            <div>
              <div className={`font-display text-sm font-bold ${c.color}`}>{c.who}</div>
              <div className="font-display text-sm text-muted-foreground">{c.how}</div>
            </div>
          </motion.div>
        )
      })}
    </div>

    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.85 }} className="text-center font-display text-xs text-muted-foreground">
      Kan ni avslöja vem som bluffar eller lyckas impostorn lura er hela vägen?
    </motion.p>
  </div>
)

export const impostorGuide: GameModeGuide = {
  mode: "impostor",
  label: "Impostor",
  description: "En impostor gömmer sig bland er, avslöja vem!",
  cssVar: "--game-purple",
  icon: Eye,
  steps: [
    { id: "intro", title: "Vad är Impostor?", icon: Eye, component: StepIntro },
    { id: "roles", title: "Dina Roller", icon: MessageCircle, component: StepRoles },
    { id: "describe", title: "Beskriv Ditt Ord", icon: CheckCircle, component: StepDescribe },
    { id: "discussion", title: "Diskussionsfas", icon: MessageCircle, component: StepDiscussion },
    { id: "vote", title: "Röstningsfas", icon: UserX, component: StepVote },
    { id: "win", title: "Vinn Spelet", icon: Trophy, component: StepWin },
  ],
}
