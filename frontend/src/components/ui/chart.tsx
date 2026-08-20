"use client";

import * as React from "react";
import { ResponsiveContainer, Tooltip, Legend } from "recharts";
import { cn } from "@/lib/utils";

export type ChartConfig = Record<string, { label?: string; color?: string }>;

interface ChartContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  config: ChartConfig;
  children: React.ReactElement;
}

export function ChartContainer({ config, children, className, id: propId, ...props }: ChartContainerProps) {
  const generatedId = React.useId();
  const id = propId ?? generatedId;
  const cssVars = Object.fromEntries(Object.entries(config).map(([k, v]) => [`--color-${k}`, v.color ?? ""]));

  return (
    <div
      data-chart={id}
      className={cn("flex justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border", className)}
      style={cssVars as React.CSSProperties}
      {...props}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

export function ChartTooltip(props: React.ComponentProps<typeof Tooltip>) {
  return <Tooltip cursor={{ stroke: "var(--border)", strokeWidth: 1 }} {...props} />;
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  hideLabel = false,
}: {
  active?: boolean;
  payload?: { dataKey: string; name: string; value: number; color: string }[];
  label?: string;
  hideLabel?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-popover px-3 py-2 text-xs shadow-lg space-y-1">
      {!hideLabel && <p className="font-semibold font-display mb-1">{label}</p>}
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
          <span className="font-display text-muted-foreground">{entry.name}:</span>
          <span className="font-bold font-display">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ChartLegend(props: React.ComponentProps<typeof Legend>) {
  return <Legend {...props} />;
}

export function ChartLegendContent({
  payload,
}: {
  payload?: { value: string; color: string }[];
}) {
  if (!payload?.length) return null;
  return (
    <div className="flex items-center gap-4 flex-wrap justify-center mt-2">
      {payload.map((entry) => (
        <div key={entry.value} className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded" style={{ backgroundColor: entry.color }} />
          <span className="text-xs font-display text-muted-foreground">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}
