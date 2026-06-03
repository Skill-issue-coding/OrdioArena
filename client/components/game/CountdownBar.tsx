"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useGamePhaseTimers } from "@/hooks/gamecontext";

const barColorMap = {
  green: "heat-hot",
  orange: "heat-warm",
  red: "heat-cold",
};

const CountdownBar = () => {
  const timers = useGamePhaseTimers();

  // Derive timer values before hooks so they're stable on every render path.
  const endTime = timers?.end_time ?? 0;
  const totalDurationMs = timers ? timers.end_time - timers.ready_time : 0;

  const [timeLeft, setTimeLeft] = useState(() => Math.max(0, endTime - Date.now()));

  useEffect(() => {
    setTimeLeft(Math.max(0, endTime - Date.now()));

    const timer = setInterval(() => {
      const remaining = Math.max(0, endTime - Date.now());
      setTimeLeft(remaining);
      if (remaining === 0) clearInterval(timer);
    }, 50);

    return () => clearInterval(timer);
  }, [endTime]);

  if (!timers) return null;

  const totalSeconds = Math.floor(timeLeft / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((timeLeft % 1000) / 10);

  const display = minutes > 0 ? `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;

  const percent = totalDurationMs > 0 ? (timeLeft / totalDurationMs) * 100 : 0;
  const isUrgent = percent < 25;

  let color: keyof typeof barColorMap;
  if (percent >= 80) {
    color = "green";
  } else if (percent > 25) {
    color = "orange";
  } else {
    color = "red";
  }

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="flex items-center justify-center mb-2">
        <span className={cn("font-display text-3xl font-bold tabular-nums px-4 py-1 rounded-xl bg-card border-2 border-border", isUrgent && "text-destructive border-destructive animate-pulse")}>{display}</span>
      </div>
      <div className="h-3 overflow-hidden border rounded-full bg-muted border-border">
        <div className={cn("h-full rounded-full transition-all duration-100", barColorMap[color])} style={{ width: `${Math.max(0, percent)}%` }} />
      </div>
    </div>
  );
};

export default CountdownBar;
