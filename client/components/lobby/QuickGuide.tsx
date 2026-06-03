"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Compass, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { GAME_MODES, getMode } from "@/lib/game/gameModes";
import { GameMode } from "@/lib/game/types";

interface QuickGuideProps {
  children: React.ReactNode;
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
};

function ModeExample({ modeId }: { modeId: GameMode }) {
  if (modeId === "impostor") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6">
        <div
          className="p-4 rounded-xl border-2 bg-card shadow-sm"
          style={{ borderColor: "color-mix(in srgb, var(--color-game-green) 40%, var(--color-border))" }}>
          <div className="text-[10px] font-display font-extrabold uppercase tracking-widest text-game-green mb-1">
            3 av 4 spelare
          </div>
          <div className="text-3xl font-display font-extrabold mb-1 text-foreground">Äpple</div>
          <div className="text-xs font-body font-semibold text-muted-foreground">Det hemliga ordet</div>
        </div>

        <div
          className="p-4 rounded-xl border-2 bg-card shadow-sm"
          style={{ borderColor: "color-mix(in srgb, var(--color-game-red) 40%, var(--color-border))" }}>
          <div className="text-[10px] font-display font-extrabold uppercase tracking-widest text-game-red mb-1">
            Impostorn 🕵️
          </div>
          <div className="text-3xl font-display font-extrabold mb-1 text-foreground">Päron</div>
          <div className="text-xs font-body font-semibold text-muted-foreground">Ett snarlikt ord (~0.18 avstånd)</div>
        </div>
      </div>
    );
  }

  if (modeId === "contexto_battle") {
    const guesses = [
      { w: "vatten", r: 3, bg: "bg-game-green" },
      { w: "strand", r: 28, bg: "bg-game-green" },
      { w: "fisk", r: 156, bg: "bg-game-yellow" },
      { w: "tegel", r: 8421, bg: "bg-game-red" },
    ];

    return (
      <div className="flex flex-col gap-2 mt-6">
        <div className="text-[10px] font-display font-extrabold uppercase tracking-widest text-muted-foreground mb-1">
          Exempel: målord = "hav"
        </div>
        {guesses.map((g) => (
          <div
            key={g.w}
            className={cn(
              "flex justify-between items-center px-4 py-2.5 rounded-xl text-white font-display font-bold shadow-sm",
              g.bg,
            )}>
            <span className="text-lg">{g.w}</span>
            <span className="text-sm opacity-90 font-mono tracking-tight">#{g.r}</span>
          </div>
        ))}
      </div>
    );
  }

  if (modeId === "synonym_duel") {
    const players = [
      { n: "Linnea", w: "cykel", d: 0.21, kept: true },
      { n: "Oskar", w: "motor", d: 0.18, kept: true },
      { n: "Astrid", w: "hjul", d: 0.16, kept: true },
      { n: "Viktor", w: "banan", d: 0.91, kept: false },
    ];

    return (
      <div className="mt-6">
        <div className="text-[10px] font-display font-extrabold uppercase tracking-widest text-muted-foreground mb-2">
          Exempel: målord = "fordon"
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {players.map((p) => (
            <div
              key={p.n}
              className={cn(
                "p-3 rounded-xl border-2 bg-card shadow-sm transition-opacity",
                p.kept ? "border-border" : "border-game-red opacity-60",
              )}>
              <div className="text-[10px] font-display font-bold text-muted-foreground mb-1">{p.n}</div>
              <div className="text-lg font-display font-extrabold leading-none mb-2 text-foreground">{p.w}</div>
              <div
                className={cn(
                  "text-[10px] font-mono font-bold tracking-tight",
                  p.kept ? "text-game-green" : "text-game-red",
                )}>
                d={p.d.toFixed(2)} {!p.kept && "· UT"}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (modeId === "anti_match") {
    const players = [
      { n: "Linnea", w: "frukt", dup: false, pts: 87 },
      { n: "Oskar", w: "päron", dup: true, pts: 0 },
      { n: "Astrid", w: "päron", dup: true, pts: 0 },
      { n: "Saga", w: "banan", dup: false, pts: 64 },
    ];

    return (
      <div className="mt-6">
        <div className="text-[10px] font-display font-extrabold uppercase tracking-widest text-muted-foreground mb-2">
          Exempel: målord = "äpple"
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {players.map((p) => (
            <div
              key={p.n}
              className={cn(
                "p-3 rounded-xl border-2 shadow-sm",
                p.dup
                  ? "border-game-red bg-game-red/5"
                  : p.pts > 80
                    ? "border-game-green bg-card"
                    : "border-border bg-card",
              )}>
              <div className="text-[10px] font-display font-bold text-muted-foreground mb-1">{p.n}</div>
              <div className="text-lg font-display font-extrabold leading-none mb-2 text-foreground">{p.w}</div>
              <div
                className={cn(
                  "text-[10px] font-mono font-bold tracking-tight",
                  p.dup ? "text-game-red" : "text-game-green",
                )}>
                {p.dup ? "DUBBLETT · 0p" : `+${p.pts}p`}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

export function QuickGuide({ children }: QuickGuideProps) {
  const [activeMode, setActiveMode] = useState<GameMode>("impostor");
  const mode = getMode(activeMode);
  const info = EXTENDED_INFO[activeMode];

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-3xl md:max-w-7xl w-[95vw] max-h-[85vh] overflow-y-auto bg-background p-6 md:p-8 border-2 border-border rounded-2xl shadow-xl outline-none">
        <DialogTitle asChild>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-2">
            <h1 className="text-3xl md:text-4xl font-extrabold font-display text-game-purple tracking-tight">
              Snabb guide
            </h1>
            <span className="font-display font-bold text-xs text-muted-foreground uppercase tracking-widest">
              Hur fungerar OrdioArena?
            </span>
          </div>
        </DialogTitle>

        <DialogDescription className="sr-only">
          En snabbguide som förklarar hur de olika spellägena i OrdioArena fungerar.
        </DialogDescription>

        <div className=" p-5 bg-linear-to-br from-game-purple/10 to-game-blue/5 border-2 border-game-purple/20 rounded-2xl shadow-sm">
          <div className="flex flex-col sm:flex-row gap-5 items-start">
            <div className="w-14 h-14 rounded-lg bg-game-purple flex items-center justify-center text-white shrink-0 shadow-sm">
              <Compass className="w-8 h-8" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-display font-extrabold text-foreground mb-2">Bakom kulisserna</h2>
              <p className="text-sm font-body font-semibold text-muted-foreground leading-relaxed">
                OrdioArena bygger på <strong className="text-foreground">fastText-vektorer för svenska ord</strong>.
                Varje ord du skriver placeras i ett 100-dimensionellt rum. Spelet räknar avstånd mellan ditt ord och
                målordet — och det avgör vinnaren.
              </p>
              <div className="flex gap-2 mt-4 flex-wrap">
                {[
                  "~200k ord",
                  "spaCy POS-filter",
                  "Kelly + Korp + Maktbarometern",
                  "WebSocket realtid",
                  "Go backend",
                ].map((tag) => (
                  <span
                    key={tag}
                    className="font-display font-bold text-[10px] uppercase tracking-wider px-2.5 py-1.5 rounded-md bg-card border-2 border-border text-muted-foreground shadow-sm">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2.5 flex-wrap">
          {GAME_MODES.map((m) => {
            const isActive = activeMode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setActiveMode(m.id)}
                className={cn(
                  "flex items-center gap-2.5 px-4 py-2.5 rounded-lg cursor-pointer font-bold text-sm transition-all border-2",
                  isActive
                    ? `bg-game-${m.color} border-game-${m.color} text-white shadow-md scale-105`
                    : "bg-muted/40 border-border text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/60",
                )}>
                <span className="text-lg leading-none">{m.icon}</span>
                {m.title}
              </button>
            );
          })}
        </div>

        <div
          key={activeMode} // Forces animation re-trigger on change
          className="p-6 border-2 border-border rounded-2xl bg-card shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center gap-4 mb-2">
            <div
              className={cn(
                "w-16 h-16 rounded-lg flex items-center justify-center text-3xl shadow-sm",
                `bg-game-${mode.color}`,
              )}>
              {mode.icon}
            </div>
            <div>
              <h2 className={cn("text-2xl font-display font-extrabold", mode.textClass)}>{mode.title}</h2>
              <div className="text-xs font-display font-bold text-muted-foreground mt-1 uppercase tracking-wider">
                {mode.players}
              </div>
            </div>
          </div>

          <p className="text-base font-body font-semibold text-foreground leading-relaxed mb-2">{info.long}</p>

          <div>
            <div className="text-[10px] font-display font-extrabold text-muted-foreground uppercase tracking-widest mb-3">
              Faser per omgång
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {info.phases.map((phase, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div
                    className="px-3 py-1.5 rounded-xl border-2 bg-background font-display font-bold text-xs shadow-sm flex items-center gap-2"
                    style={{ borderColor: `color-mix(in srgb, var(--game-${mode.color}) 40%, var(--border))` }}>
                    <span className={mode.textClass}>{i + 1}</span>
                    <span className="text-foreground">{phase}</span>
                  </div>
                  {i < info.phases.length - 1 && (
                    <ArrowRight className="w-4 h-4 text-muted-foreground/50 shrink-0" strokeWidth={3} />
                  )}
                </div>
              ))}
            </div>
          </div>
          <ModeExample modeId={activeMode} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
