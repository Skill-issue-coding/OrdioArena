"use client";

import { motion } from "framer-motion";

interface GetReadyScreenProps {
  remainingMs: number;
}

export function GetReadyScreen({ remainingMs }: GetReadyScreenProps) {
  const seconds = Math.floor(remainingMs / 1000);
  const ms = Math.floor((remainingMs % 1000) / 10);

  return (
    <motion.div key="get-ready" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="flex flex-col items-center justify-center gap-4 pt-20">
      <p className="text-4xl font-bold font-display text-game-purple animate-pulse">Gör dig redo...</p>
      <p className="text-2xl font-bold font-display text-muted-foreground tabular-nums">
        {seconds}.{String(ms).padStart(2, "0")}
      </p>
    </motion.div>
  );
}
