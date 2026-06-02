"use client";

import PhaseTransition from "@/components/game/PhaseTransition";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useImpostorGame } from "@/hooks/gamecontext";
import { cn, isStringEmptyOrOnlySpaces } from "@/lib/utils";
import { useWebsocketContext } from "@/hooks/websocketcontext";
import { useState } from "react";
import { ToastError } from "@/lib/toast-functions";
import { useUserContext } from "@/hooks/usercontext";
import { useLobbyContext } from "@/hooks/lobbycontext";
import { Send } from "lucide-react";

export function InputPhase() {
  const { sendEvent } = useWebsocketContext();
  const game = useImpostorGame();
  const { user } = useUserContext();
  const { users } = useLobbyContext();
  const [wordSubmission, setWordSubmission] = useState<string>("");

  if (!game || !game.roundState || !game.phaseState || !game.activePlayers || !user || !users) return null;

  const isImpostor = game.roundState.role === "impostor";

  const sendWordSubmission = () => {
    if (game.phaseState?.current_player !== user.user_id) {
      ToastError("Det är inte din tur!");
      return;
    }
    if (isStringEmptyOrOnlySpaces(wordSubmission) || wordSubmission.length > 128) {
      ToastError("Skriv in ett ord");
      return;
    }
    sendEvent("game_submit_word", { word: wordSubmission });
  };

  const submittedWords = game.phaseState.words_cycle;
  const activePlayers = game.activePlayers;
  const isCurrentPlayer = game.phaseState.current_player === user.user_id;

  return (
    <PhaseTransition phaseKey="input">
      <div className="flex flex-col items-center w-full max-w-4xl gap-6">
        <div className="flex flex-col justify-between w-full max-w-4xl gap-6 lg:flex-row">
          {isCurrentPlayer && (
            <div className="flex flex-col items-center self-start justify-center flex-1 gap-6 text-center game-card shrink-0">
              <div className="text-center">
                <p className={cn("text-muted-foreground text-sm mb-2 font-display uppercase tracking-wider font-bold", isImpostor ? "text-destructive" : "text-muted-foreground")}>{isImpostor ? "Hitta på en bluff" : "Ange en ledtråd"}</p>
                <p className="text-xs text-muted-foreground font-display">{isImpostor ? "Välj ett ord som får dig att smälta in i gruppen" : "Skriv ett ord relaterat till ditt hemliga ord"}</p>
              </div>
              <div className="flex items-center justify-center w-full gap-3">
                <Input
                  value={wordSubmission}
                  onChange={(e) => setWordSubmission(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      sendWordSubmission();
                    }
                  }}
                  placeholder={isImpostor ? "Skriv en bluff..." : "Skriv en ledtråd..."}
                  className="h-12 text-lg font-bold border-2 bg-card font-display rounded-2xl"
                  maxLength={128}
                  autoFocus
                />
                <Button onClick={sendWordSubmission} disabled={!wordSubmission.trim() || !isCurrentPlayer} size="icon" className="size-12 shrink-0" aria-label="Skicka meddelande">
                  <Send className="size-5" />
                </Button>
              </div>
            </div>
          )}
          <div className="flex-1 game-card">
            <h3 className="mb-3 text-sm font-bold uppercase font-display text-muted-foreground">Ledtrådar</h3>
            <div className="space-y-3">
              {Object.entries(users ?? {}).map(([userId, player]) => {
                const isActivePlayer = activePlayers[userId];
                const clue = submittedWords[userId];
                return (
                  <div key={userId} className={cn("flex items-center justify-between gap-3", !isActivePlayer && "opacity-40")}>
                    <div className="flex items-center min-w-0 gap-2">
                      <span className="flex items-center justify-center text-xs font-bold text-white rounded-full shrink-0 w-7 h-7 font-display" style={{ backgroundColor: player.background }}>
                        {player.username[0]}
                      </span>
                      <span className="text-sm font-semibold truncate font-display text-muted-foreground">{player.username}</span>
                    </div>
                    {clue ? (
                      <span className="px-3 py-1 text-sm font-bold border-2 rounded-full shrink-0 bg-card border-border font-display text-foreground">{clue}</span>
                    ) : (
                      <span className="px-3 py-1 text-sm font-bold border-2 border-dashed rounded-full shrink-0 border-border font-display text-muted-foreground">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </PhaseTransition>
  );
}
