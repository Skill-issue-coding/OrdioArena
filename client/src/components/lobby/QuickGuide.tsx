import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Compass, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import type { GameMode } from "@/hooks/game/types"
import { BASE_GAME_MODES, getMode } from "@/lib/game/config"

interface QuickGuideProps {
  children: React.ReactNode
}

// Extended metadata for the guide
const EXTENDED_INFO: Record<GameMode, { long: string; phases: string[] }> = {
  impostor: {
    long: "Alla utom impostern får samma hemliga ord. Impostern får ett liknande ord. Skriv ledtrådar — sedan röstar ni ut den ni misstänker.",
    phases: ["Avslöjande", "Ledtråd", "Diskussion", "Röstning", "Resultat"],
  },
  contexto_battle: {
    long: "Backend väljer ett hemligt ord. Skriv ord och få ett 'närhetsvärde'. När tiden tar slut vinner den som var närmast.",
    phases: ["Förberedelse", "Gissningar", "Resultat"],
  },
  synonym_duel: {
    long: "Ett målord visas. Ange den bästa synonymen varje runda. Den som svarar med den sämsta synonymen (längst semantiskt avstånd) åker ut. Repetera tills en spelare är kvar.",
    phases: ["Målord", "Snabbinput", "Elimination"],
  },
  anti_match: {
    long: "Skriv ett relevant ord under tidspress. Om någon annan skrev exakt samma ord får ni 0 poäng. Bland unika ord vinner den som är närmast målordet.",
    phases: ["Målord", "Snabbinput", "Unikhetscheck", "Resultat"],
  },
}

function ModeExample({ modeId }: { modeId: GameMode }) {
  if (modeId === "impostor") {
    return (
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border-2 bg-card p-4 shadow-sm" style={{ borderColor: "color-mix(in srgb, var(--color-game-green) 40%, var(--color-border))" }}>
          <div className="mb-1 font-display text-[10px] font-extrabold tracking-widest text-game-green uppercase">3 av 4 spelare</div>
          <div className="mb-1 font-display text-3xl font-extrabold text-foreground">Äpple</div>
          <div className="font-body text-xs font-semibold text-muted-foreground">Det hemliga ordet</div>
        </div>

        <div className="rounded-xl border-2 bg-card p-4 shadow-sm" style={{ borderColor: "color-mix(in srgb, var(--color-game-red) 40%, var(--color-border))" }}>
          <div className="mb-1 font-display text-[10px] font-extrabold tracking-widest text-game-red uppercase">Impostorn 🕵️</div>
          <div className="mb-1 font-display text-3xl font-extrabold text-foreground">Päron</div>
          <div className="font-body text-xs font-semibold text-muted-foreground">Ett snarlikt ord (~0.18 avstånd)</div>
        </div>
      </div>
    )
  }

  if (modeId === "contexto_battle") {
    const guesses = [
      { w: "vatten", r: 3, bg: "bg-game-green" },
      { w: "strand", r: 28, bg: "bg-game-green" },
      { w: "fisk", r: 156, bg: "bg-game-yellow" },
      { w: "tegel", r: 8421, bg: "bg-game-red" },
    ]

    return (
      <div className="mt-6 flex flex-col gap-2">
        <div className="mb-1 font-display text-[10px] font-extrabold tracking-widest text-muted-foreground uppercase">Exempel: målord = "hav"</div>
        {guesses.map((g) => (
          <div key={g.w} className={cn("flex items-center justify-between rounded-xl px-4 py-2.5 font-display font-bold text-white shadow-sm", g.bg)}>
            <span className="text-lg">{g.w}</span>
            <span className="font-mono text-sm tracking-tight opacity-90">#{g.r}</span>
          </div>
        ))}
      </div>
    )
  }

  if (modeId === "synonym_duel") {
    const players = [
      { n: "Linnea", w: "cykel", d: 0.21, kept: true },
      { n: "Oskar", w: "motor", d: 0.18, kept: true },
      { n: "Astrid", w: "hjul", d: 0.16, kept: true },
      { n: "Viktor", w: "banan", d: 0.91, kept: false },
    ]

    return (
      <div className="mt-6">
        <div className="mb-2 font-display text-[10px] font-extrabold tracking-widest text-muted-foreground uppercase">Exempel: målord = "fordon"</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {players.map((p) => (
            <div key={p.n} className={cn("rounded-xl border-2 bg-card p-3 shadow-sm transition-opacity", p.kept ? "border-border" : "border-game-red opacity-60")}>
              <div className="mb-1 font-display text-[10px] font-bold text-muted-foreground">{p.n}</div>
              <div className="mb-2 font-display text-lg leading-none font-extrabold text-foreground">{p.w}</div>
              <div className={cn("font-mono text-[10px] font-bold tracking-tight", p.kept ? "text-game-green" : "text-game-red")}>
                d={p.d.toFixed(2)} {!p.kept && "· UT"}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (modeId === "anti_match") {
    const players = [
      { n: "Linnea", w: "frukt", dup: false, pts: 87 },
      { n: "Oskar", w: "päron", dup: true, pts: 0 },
      { n: "Astrid", w: "päron", dup: true, pts: 0 },
      { n: "Saga", w: "banan", dup: false, pts: 64 },
    ]

    return (
      <div className="mt-6">
        <div className="mb-2 font-display text-[10px] font-extrabold tracking-widest text-muted-foreground uppercase">Exempel: målord = "äpple"</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {players.map((p) => (
            <div key={p.n} className={cn("rounded-xl border-2 p-3 shadow-sm", p.dup ? "border-game-red bg-game-red/5" : p.pts > 80 ? "border-game-green bg-card" : "border-border bg-card")}>
              <div className="mb-1 font-display text-[10px] font-bold text-muted-foreground">{p.n}</div>
              <div className="mb-2 font-display text-lg leading-none font-extrabold text-foreground">{p.w}</div>
              <div className={cn("font-mono text-[10px] font-bold tracking-tight", p.dup ? "text-game-red" : "text-game-green")}>{p.dup ? "DUBBLETT · 0p" : `+${p.pts}p`}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return null
}

export function QuickGuide({ children }: QuickGuideProps) {
  const [activeMode, setActiveMode] = useState<GameMode>("impostor")
  const mode = getMode(activeMode)
  const ActiveModeIcon = mode.icon
  const info = EXTENDED_INFO[activeMode]

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[85vh] w-[95vw] overflow-y-auto rounded-2xl border-2 border-border bg-background p-6 shadow-xl outline-none sm:max-w-3xl md:max-w-7xl md:p-8">
        <DialogTitle asChild>
          <div className="flex flex-col justify-between gap-2 md:flex-row md:items-end">
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-game-purple md:text-4xl">Snabb guide</h1>
            <span className="font-display text-xs font-bold tracking-widest text-muted-foreground uppercase">Hur fungerar OrdioArena?</span>
          </div>
        </DialogTitle>

        <DialogDescription className="sr-only">En snabbguide som förklarar hur de olika spellägena i OrdioArena fungerar.</DialogDescription>

        <div className="rounded-2xl border-2 border-game-purple/20 bg-linear-to-br from-game-purple/10 to-game-blue/5 p-5 shadow-sm">
          <div className="flex flex-col items-start gap-5 sm:flex-row">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-game-purple text-white shadow-sm">
              <Compass className="h-8 w-8" />
            </div>
            <div className="flex-1">
              <h2 className="mb-2 font-display text-xl font-extrabold text-foreground">Bakom kulisserna</h2>
              <p className="font-body text-sm leading-relaxed font-semibold text-muted-foreground">
                OrdioArena bygger på <strong className="text-foreground">fastText-vektorer för svenska ord</strong>. Varje ord du skriver placeras i ett 100-dimensionellt rum. Spelet räknar avstånd mellan ditt ord och målordet — och det avgör
                vinnaren.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {["~200k ord", "spaCy POS-filter", "Kelly + Korp + Maktbarometern", "WebSocket realtid", "Go backend"].map((tag) => (
                  <span key={tag} className="rounded-md border-2 border-border bg-card px-2.5 py-1.5 font-display text-[10px] font-bold tracking-wider text-muted-foreground uppercase shadow-sm">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2.5">
          {BASE_GAME_MODES.map((m) => {
            const isActive = activeMode === m.id
            const ModeIcon = m.icon
            return (
              <button
                key={m.id}
                onClick={() => setActiveMode(m.id)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-lg border-2 px-4 py-2.5 text-sm font-bold transition-all",
                  isActive ? `bg-game-${m.color} border-game-${m.color} scale-105 text-white shadow-md` : "border-border bg-muted/40 text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/60"
                )}
              >
                <ModeIcon className="h-4 w-4" />
                {m.title}
              </button>
            )
          })}
        </div>

        <div
          key={activeMode} // Forces animation re-trigger on change
          className="animate-in rounded-2xl border-2 border-border bg-card p-6 shadow-sm duration-300 fade-in slide-in-from-bottom-2"
        >
          <div className="mb-2 flex items-center gap-4">
            <div className={cn("flex h-16 w-16 items-center justify-center rounded-lg shadow-sm", `bg-game-${mode.color}`)}><ActiveModeIcon className="h-7 w-7 text-white" /></div>
            <div>
              <h2 className={cn("font-display text-2xl font-extrabold", mode.textClass)}>{mode.title}</h2>
              <div className="mt-1 font-display text-xs font-bold tracking-wider text-muted-foreground uppercase">{mode.players}</div>
            </div>
          </div>

          <p className="mb-2 font-body text-base leading-relaxed font-semibold text-foreground">{info.long}</p>

          <div>
            <div className="mb-3 font-display text-[10px] font-extrabold tracking-widest text-muted-foreground uppercase">Faser per omgång</div>
            <div className="flex flex-wrap items-center gap-2">
              {info.phases.map((phase, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex items-center gap-2 rounded-xl border-2 bg-background px-3 py-1.5 font-display text-xs font-bold shadow-sm" style={{ borderColor: `color-mix(in srgb, var(--game-${mode.color}) 40%, var(--border))` }}>
                    <span className={mode.textClass}>{i + 1}</span>
                    <span className="text-foreground">{phase}</span>
                  </div>
                  {i < info.phases.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={3} />}
                </div>
              ))}
            </div>
          </div>
          <ModeExample modeId={activeMode} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
