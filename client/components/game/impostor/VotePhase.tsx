"use client";

import PhaseTransition from "@/components/game/PhaseTransition";
import { cn, deriveTally } from "@/lib/utils";
import { useUserContext } from "@/hooks/usercontext";
import { useWebsocketContext } from "@/hooks/websocketcontext";
// import { useImpostorGame } from "@/hooks/gamecontext";
import { useImpostorGame } from "@/hooks/newgamecontext";
import { useLobbyContext } from "@/hooks/lobbycontext";
import { useMemo, useState } from "react";
import { User } from "@/lib/game/game";
import { AnimatePresence, motion } from "framer-motion";

const AVATAR_CAP = 5;

function VoterStrip({ voters, users, emptyLabel, center }: { voters: string[]; users: Record<string, User>; emptyLabel?: string; center?: boolean }) {
  const shown = voters.slice(0, AVATAR_CAP);
  const extra = voters.length - shown.length;

  return (
    <div className={cn("flex items-center gap-0.5 mt-0.5 flex-wrap min-h-5 w-full", center && "justify-center")}>
      {voters.length === 0 ? (
        emptyLabel ? (
          <span className="text-xs font-display text-muted-foreground leading-5">{emptyLabel}</span>
        ) : null
      ) : (
        <>
          <AnimatePresence initial={false}>
            {shown.map((voterId) => {
              const voter = users[voterId];
              return (
                <motion.span
                  key={voterId}
                  title={voter?.username}
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-display font-bold text-white border border-card"
                  style={{ backgroundColor: voter?.background }}
                  initial={{ opacity: 0, scale: 0, x: -6 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0 }}
                  transition={{ type: "spring", stiffness: 480, damping: 24 }}>
                  {voter?.username[0]}
                </motion.span>
              );
            })}
          </AnimatePresence>
          {extra > 0 && <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-display font-bold border border-border bg-muted text-muted-foreground">+{extra}</span>}
        </>
      )}
    </div>
  );
}

const cardListVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

const cardItemVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 320, damping: 24 },
  },
};

export function VotePhase() {
  const { user } = useUserContext();
  const { users } = useLobbyContext();
  const { sendEvent } = useWebsocketContext();
  const game = useImpostorGame();

  // Optimistic local vote — immediately reflects the user's click before the
  // server echoes it back via impostor_vote_update.
  const [myVote, setMyVote] = useState<string | null | undefined>(undefined);

  const serverVotes = game.rounds[game.current_round]?.votes ?? {};
  const allVotes = useMemo(() => ({ ...serverVotes, ...(myVote !== undefined && user ? { [user.user_id]: myVote } : {}) }), [serverVotes, myVote, user]);

  const { votersByTarget, skipVoters, counts, skipCount, maxVotes, leader } = useMemo(() => deriveTally(allVotes), [allVotes]);

  if (!users || !user) return null;

  const activePlayers = game.active_players;
  const myId = user.user_id;
  const isCurrentUserActive = activePlayers[myId] ?? false;

  const handleVote = (target: string | null) => {
    if (target === myVote || !isCurrentUserActive) return;
    sendEvent("game_submit_vote", { target });
    setMyVote(target);
  };

  const denom = Math.max(maxVotes, skipCount, 1);

  return (
    <PhaseTransition phaseKey="vote">
      <div className="w-full max-w-4xl">
        {/* Header */}
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold font-display text-foreground">Rösta</h2>
          <p className="text-sm font-semibold text-muted-foreground font-display">Vem är en imposter?</p>
        </div>

        {/* Player grid — stagger in on mount */}
        <motion.div className="grid w-full grid-cols-2 gap-3 mb-3" variants={cardListVariants} initial="hidden" animate="show">
          {Object.entries(users).map(([playerId, player]) => {
            const isActive = activePlayers[playerId] ?? false;
            const isSelected = myVote === playerId;
            const isCurrentUser = playerId === myId;
            const voters = votersByTarget[playerId] ?? [];
            const isLeading = leader === playerId;
            const share = Math.round(((counts[playerId] ?? 0) / denom) * 100);

            return (
              <motion.button
                key={playerId}
                variants={cardItemVariants}
                disabled={!isActive || isCurrentUser}
                onClick={() => handleVote(playerId)}
                className={cn(
                  "game-card relative overflow-hidden flex items-center gap-3 text-left transition-all",
                  isActive && !isCurrentUser && "cursor-pointer hover:border-muted-foreground",
                  isSelected && !isLeading && "border-game-green bg-game-green/40!",
                  isLeading && "border-game-red bg-game-red/40! animate-pulse",
                  (!isActive || isCurrentUser) && "opacity-40 cursor-not-allowed",
                )}>
                <span className="flex items-center justify-center text-sm font-bold text-white rounded-full size-8 shrink-0 font-display" style={{ backgroundColor: player.background }}>
                  {player.username[0]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate font-display text-foreground">{player.username}</p>
                  {!isActive ? <p className="text-xs font-display text-muted-foreground">Eliminerad</p> : <VoterStrip voters={voters} users={users} emptyLabel="Inga röster än" />}
                </div>
                {isActive && (
                  <div className="flex flex-col items-center text-center shrink-0 min-w-8">
                    {/* key change → re-mount → stamp-down entrance feels weighty/tense */}
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.span
                        key={voters.length}
                        className={cn("text-xl font-bold font-display tabular-nums leading-none", voters.length === 0 ? "text-muted-foreground/40" : "text-foreground")}
                        initial={{ opacity: 0, y: -10, scale: 1.25 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.75 }}
                        transition={{ type: "spring", stiffness: 520, damping: 26 }}>
                        {voters.length}
                      </motion.span>
                    </AnimatePresence>
                    <span className="text-[10px] font-display text-muted-foreground leading-none mt-0.5">{voters.length === 1 ? "röst" : "röster"}</span>
                  </div>
                )}
                {isActive && <span className="absolute bottom-0 left-0 h-1 transition-all duration-500 bg-primary/40 rounded-b-xl" style={{ width: `${share}%` }} />}
              </motion.button>
            );
          })}
        </motion.div>

        {/* Skip button */}
        <motion.button
          onClick={() => handleVote(null)}
          className={cn(
            "game-card relative overflow-hidden w-full flex items-center gap-3 cursor-pointer hover:border-muted-foreground transition-all mb-6",
            myVote === null && leader !== null && "border-game-green bg-game-green/40!",
            leader === null && "border-game-red bg-game-red/40! animate-pulse",
          )}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, type: "spring", stiffness: 300, damping: 24 }}>
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-semibold font-display text-foreground">Skippa röst</p>
            <VoterStrip voters={skipVoters} users={users} emptyLabel="Inga röster än" center />
          </div>
          <div className="flex flex-col items-center text-center shrink-0 min-w-8">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={skipVoters.length}
                className={cn("text-xl font-bold font-display tabular-nums leading-none", skipVoters.length === 0 ? "text-muted-foreground/40" : "text-foreground")}
                initial={{ opacity: 0, y: -10, scale: 1.25 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.75 }}
                transition={{ type: "spring", stiffness: 520, damping: 26 }}>
                {skipVoters.length}
              </motion.span>
            </AnimatePresence>
            <span className="text-[10px] font-display text-muted-foreground leading-none mt-0.5">{skipVoters.length === 1 ? "röst" : "röster"}</span>
          </div>
          <span className="absolute bottom-0 left-0 h-1 transition-all duration-500 bg-primary/40 rounded-b-xl" style={{ width: `${Math.round((skipCount / denom) * 100)}%` }} />
        </motion.button>
      </div>
    </PhaseTransition>
  );
}
