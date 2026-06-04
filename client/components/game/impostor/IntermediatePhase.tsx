"use client";

import PhaseTransition from "@/components/game/PhaseTransition";
// import { useImpostorGame } from "@/hooks/gamecontext";
import { useImpostorGame } from "@/hooks/newgamecontext";
import { useLobbyContext } from "@/hooks/lobbycontext";
import { useUserContext } from "@/hooks/usercontext";
import { motion } from "framer-motion";
import { popIn } from "@/lib/animation-util";

export function IntermediatePhase() {
  const game = useImpostorGame();
  const { users } = useLobbyContext();
  const { user } = useUserContext();

  if (!user || !users) return null;
  const votedOut = game.intermediate_voted_out;
  const isEliminated = votedOut !== undefined;
  const message = votedOut === undefined ? (game.intermediate_message ?? "") : votedOut === user.user_id ? `Du röstades ut` : `${users[votedOut].username} röstades ut.`;

  return (
    <PhaseTransition phaseKey="Intermediate">
      <div className="flex flex-col items-center w-full max-w-3xl gap-8">
        <div className="text-center">
          <h1 className="text-5xl font-display font-bold mb-2">{message}</h1>
        </div>

        {isEliminated && votedOut !== undefined && (
          <motion.div key={votedOut} className="flex flex-col items-center p-3 rounded-lg gap-2" {...popIn({ delay: 0.15, ease: "easeOut", duration: 0.5 })}>
            <span className="flex items-center justify-center w-16 h-16 text-2xl font-bold text-white rounded-full shrink-0 font-display" style={{ backgroundColor: users[votedOut].background }}>
              {users[votedOut].username[0]}
            </span>
            <span className="w-full text-xl font-bold text-center truncate font-display">{users[votedOut].username}</span>
          </motion.div>
        )}
      </div>
    </PhaseTransition>
  );
}
