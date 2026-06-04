import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { ImpostorVoteUpdate } from "./game/impostor-types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The set of background colors available for player avatars.
 * Must be kept in sync with the `palette` slice in the Go util package.
 */
export const BACKGROUND_COLOR_PALETTE = ["#8b5cf6", "#ec4899", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7"];

/**
 * Helper function to check if a string is empty or contains white spaces
 */
export function isStringEmptyOrOnlySpaces(str: string) {
  return str === null || str.match(/^ *$/) !== null;
}

/**
 * Derive vote tallies and current leader from a vote map.
 */
export function deriveTally(allVotes: ImpostorVoteUpdate["votes"]) {
  const votersByTarget: Record<string, string[]> = {};
  const skipVoters: string[] = [];
  const counts: Record<string, number> = {};
  let skipCount = 0;

  for (const [voterId, target] of Object.entries(allVotes)) {
    if (target === null) {
      skipVoters.push(voterId);
      skipCount++;
    } else {
      (votersByTarget[target] ??= []).push(voterId);
      counts[target] = (counts[target] ?? 0) + 1;
    }
  }

  let maxVotes = 0;
  let topCandidates: string[] = [];
  for (const [id, n] of Object.entries(counts)) {
    if (n > maxVotes) {
      maxVotes = n;
      topCandidates = [id];
    } else if (n === maxVotes) topCandidates.push(id);
  }

  let leader: string | null | undefined = undefined;
  if (maxVotes === 0 && skipCount === 0) leader = undefined;
  else if (skipCount > maxVotes) leader = null;
  else if (skipCount < maxVotes && topCandidates.length === 1) leader = topCandidates[0];

  return { votersByTarget, skipVoters, counts, skipCount, maxVotes, leader };
}
