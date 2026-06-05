"use client";

import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Gamepad2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { popIn } from "@/lib/animation-util";
import { useWebsocketContext } from "@/hooks/websocketcontext";
import { useRouter } from "next/navigation";

export default function HomeView() {
  const { sendEvent, subscribe } = useWebsocketContext();
  const router = useRouter();
  const [roomCode, setRoomCode] = useState("");
  const pendingCodeRef = useRef("");

  useEffect(() => {
    const unsubSync = subscribe("sync_gamestate", (payload) => {
      pendingCodeRef.current = payload.lobbystate.code;
    });
    const unsubJoined = subscribe("joined_lobby", () => {
      if (pendingCodeRef.current) router.push(`/lobby/${pendingCodeRef.current}`);
    });
    return () => {
      unsubSync();
      unsubJoined();
    };
  }, [router, subscribe]);

  const formatCode = (val: string) => {
    const clean = val.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
    if (clean.length > 4) return clean.slice(0, 4) + "-" + clean.slice(4);
    return clean;
  };

  const handleCreateLobby = () => sendEvent("create_lobby", null);
  const handleJoinLobby = () => sendEvent("join_lobby", { lobby_code: roomCode });

  return (
    <div className="flex flex-col items-center justify-center w-screen h-screen p-4 overflow-hidden sm:p-6">
      <div className="flex flex-col w-full max-w-md animate-slide-up gap-4">
        <motion.div className="mb-8 text-center" {...popIn(0.15, 1.5)}>
          <div className="inline-flex items-center justify-center mb-2 gap-2">
            <Gamepad2 className="h-14 w-14 text-game-purple" />
            <h1 className="text-4xl font-bold font-display sm:text-6xl text-game-purple">
              Ordio<span className="text-game-pink">Arena</span>
            </h1>
          </div>
          <p className="text-base font-semibold text-muted-foreground font-display">Snabbtänkt multiplayer ordspel</p>
        </motion.div>

        <motion.div className="mt-2 game-card border-game-blue/30" {...popIn(0.5)}>
          <h2 className="flex items-center mb-3 text-base font-bold font-display text-foreground gap-2">Gå med i rum</h2>
          <div className="flex gap-2">
            <Input
              placeholder="xxxx-xxxx"
              value={roomCode}
              onChange={(e) => setRoomCode(formatCode(e.target.value.toLowerCase()))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleJoinLobby();
                }
              }}
              className="h-12 text-base font-bold tracking-widest text-center border-2 rounded-lg font-body bg-muted"
              maxLength={9}
            />
            <Button size="lg" onClick={handleJoinLobby} disabled={roomCode.replace("-", "").length !== 8} className="h-12 px-8 text-base font-bold">
              Gå med
            </Button>
          </div>
        </motion.div>

        <motion.div className="flex items-center gap-3 mt-1.5" {...popIn(0.55)}>
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs font-bold tracking-widest uppercase font-display text-muted-foreground">eller</span>
          <div className="flex-1 h-px bg-border" />
        </motion.div>

        <motion.div {...popIn(0.45)}>
          <Button size="lg" className="w-full h-16 mb-4 text-lg font-bold" onClick={handleCreateLobby}>
            Skapa rum +
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
