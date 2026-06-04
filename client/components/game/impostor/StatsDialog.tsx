"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChartContainer, ChartTooltipContent, ChartLegendContent, ChartTooltip, ChartLegend, type ChartConfig } from "@/components/ui/chart";
import { CartesianGrid, Line, LineChart, XAxis, YAxis, ReferenceDot } from "recharts";
import { cn } from "@/lib/utils";
// import { ImpostorCycle } from "@/lib/game/impostor-types";
// import { useImpostorGame } from "@/hooks/gamecontext";
import { chartColor } from "@/lib/chart-colors";
import { useNewGameContext, type ImpostorGameResultPayload } from "@/hooks/newgamecontext";
import { useLobbyContext } from "@/hooks/lobbycontext";

interface StatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Cycle = ImpostorGameResultPayload["cycles"][number];

/** Returns the voted-out player ID for a cycle, or null if nobody was eliminated. */
function getVotedOut(cycle: Cycle): string | null {
  const counts: Record<string, number> = {};
  let skipCount = 0;
  for (const target of Object.values(cycle.votes)) {
    if (target === null) skipCount++;
    else counts[target] = (counts[target] ?? 0) + 1;
  }
  let maxVotes = 0;
  let topCandidates: string[] = [];
  for (const [id, n] of Object.entries(counts)) {
    if (n > maxVotes) {
      maxVotes = n;
      topCandidates = [id];
    } else if (n === maxVotes) topCandidates.push(id);
  }
  if (skipCount < maxVotes && topCandidates.length === 1) return topCandidates[0];
  return null;
}

const SKIP_COLOR = "#94a3b8";

export function StatsDialog({ open, onOpenChange }: StatsDialogProps) {
  const { result: rawResult } = useNewGameContext();
  const { users } = useLobbyContext();

  if (!rawResult || !users) return null;

  const { cycles, roles, normal_word: normalWord } = rawResult as ImpostorGameResultPayload;

  // ── Vote line chart data ──────────────────────────────────────────────────
  // Collect all player IDs that received ≥1 vote across any round.
  const allVotedIds = new Set<string>();
  cycles.forEach((c) =>
    Object.values(c.votes).forEach((t) => {
      if (t !== null) allVotedIds.add(t);
    }),
  );
  const votedIds = [...allVotedIds];

  // Assign each player a stable chart colour by their position in the full player list.
  const playerIds = Object.keys(users);
  const playerColorMap: Record<string, string> = Object.fromEntries(playerIds.map((id, i) => [id, chartColor(i)]));

  const chartConfig: ChartConfig = {
    skip: { label: "Hoppa över", color: SKIP_COLOR },
    ...Object.fromEntries(votedIds.map((id) => [id, { label: users[id]?.username ?? id, color: playerColorMap[id] }])),
  };

  type RoundRow = { round: string; [key: string]: string | number };
  const voteChartData: RoundRow[] = cycles.map((cycle, i) => {
    const counts: Record<string, number> = {};
    let skipCount = 0;
    for (const target of Object.values(cycle.votes)) {
      if (target === null) skipCount++;
      else counts[target] = (counts[target] ?? 0) + 1;
    }
    return { round: `Runda ${i + 1}`, skip: skipCount, ...counts };
  });

  // Compute voted-out per round for the X markers.
  const votedOutPerRound = cycles.map(getVotedOut);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] min-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold font-display">Spelstatistik</DialogTitle>
        </DialogHeader>

        {/* ── Vote line chart ──────────────────────────────────────────────── */}
        <section>
          <h3 className="text-sm font-bold uppercase tracking-wider font-display text-muted-foreground mb-3">Röster per runda</h3>
          <ChartContainer config={chartConfig} className="h-64 w-full">
            <LineChart data={voteChartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="round" tickLine={false} axisLine={false} className="font-display text-xs" />
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} className="font-display text-xs" />
              <ChartTooltip content={<ChartTooltipContent />} />

              {/* Skip line */}
              <Line type="monotone" dataKey="skip" name={chartConfig.skip.label} stroke={SKIP_COLOR} strokeWidth={2} strokeDasharray="4 4" dot={{ r: 4, fill: SKIP_COLOR }} activeDot={{ r: 5 }} />

              {/* One line per player who received votes */}
              {votedIds.map((id) => {
                const color = playerColorMap[id];
                return <Line key={id} type="monotone" dataKey={id} name={users[id]?.username ?? id} stroke={color} strokeWidth={2} dot={{ r: 4, fill: color }} activeDot={{ r: 5 }} />;
              })}

              {/* X markers for voted-out players */}
              {votedOutPerRound.map((votedOutId, roundIdx) => {
                if (!votedOutId) return null;
                const roundKey = `Runda ${roundIdx + 1}`;
                const count = (voteChartData[roundIdx][votedOutId] as number) ?? 0;
                const color = playerColorMap[votedOutId];
                return <ReferenceDot key={`${votedOutId}-${roundIdx}`} x={roundKey} y={count} r={8} fill="transparent" stroke={color} strokeWidth={2.5} label={{ value: "✕", position: "center", fontSize: 10, fontWeight: "bold", fill: color }} />;
              })}

              <ChartLegend content={<ChartLegendContent />} />
            </LineChart>
          </ChartContainer>
        </section>

        {/* ── Words grid ───────────────────────────────────────────────────── */}
        <section className="mt-2">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-sm font-bold uppercase tracking-wider font-display text-muted-foreground">Ord per runda</h3>
            <span className="text-xs font-display text-muted-foreground">
              Hemligt ord: <span className="font-semibold text-foreground">{normalWord}</span>
            </span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs font-display border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-28">Spelare</th>
                  {cycles.map((_, i) => (
                    <th key={i} className="text-center px-3 py-2 font-semibold text-muted-foreground">
                      Runda {i + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {playerIds.map((id, rowIdx) => {
                  const player = users[id];
                  const isImpostor = roles[id] === "impostor";
                  return (
                    <tr key={id} className={cn("border-b border-border last:border-0", rowIdx % 2 === 0 ? "bg-background" : "bg-muted/20", isImpostor && "bg-destructive/5")}>
                      {/* Player name cell */}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="flex items-center justify-center size-6 text-[10px] font-bold text-white rounded-full shrink-0" style={{ backgroundColor: player.background }}>
                            {player.username[0]}
                          </span>
                          <span className={cn("font-semibold truncate", isImpostor && "text-destructive")}>{player.username}</span>
                        </div>
                      </td>
                      {/* Word per round */}
                      {cycles.map((cycle, cycleIdx) => {
                        const word = cycle.submissions[id];
                        const votedOut = votedOutPerRound[cycleIdx];
                        const wasEliminatedThisRound = votedOut === id;
                        return (
                          <td key={cycleIdx} className="px-3 py-2 text-center">
                            {word ? (
                              <span
                                className={cn(
                                  "inline-block px-2 py-0.5 rounded-full border font-semibold",
                                  isImpostor ? "border-destructive/40 text-destructive bg-destructive/10" : "border-border text-foreground bg-card",
                                  wasEliminatedThisRound && "ring-2 ring-destructive",
                                )}>
                                {word}
                                {wasEliminatedThisRound && " ✕"}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground font-display">Impostorers ord är markerade i rött. ✕ markerar den runda en spelare röstades ut.</p>
        </section>
      </DialogContent>
    </Dialog>
  );
}
