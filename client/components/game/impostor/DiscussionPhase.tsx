"use client";

import { ChevronDown, Send } from "lucide-react";
import PhaseTransition from "@/components/game/PhaseTransition";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLobbyContext } from "@/hooks/lobbycontext";
import { useUserContext } from "@/hooks/usercontext";
import { useWebsocketContext } from "@/hooks/websocketcontext";
import { useImpostorGame } from "@/hooks/gamecontext";
import { AnimatePresence, motion } from "framer-motion";
import { snapIn } from "@/lib/animation-util";

export function DiscussionPhase() {
  const { chatMessages, users } = useLobbyContext();
  const game = useImpostorGame();
  const { user } = useUserContext();
  const { sendEvent } = useWebsocketContext();

  const [draft, setDraft] = useState<string>("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [readCount, setReadCount] = useState(0);
  const unreadBelow = Math.max(0, chatMessages.length - readCount);

  // Scroll to bottom on mount.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setReadCount(chatMessages.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Auto-scroll when a new message arrives and the user is already at the bottom.
  useEffect(() => {
    if (isAtBottomRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      setReadCount(chatMessages.length);
    }
  }, [chatMessages.length]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
    isAtBottomRef.current = atBottom;
    if (atBottom !== isAtBottom) setIsAtBottom(atBottom);
    if (atBottom) setReadCount(chatMessages.length);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setReadCount(chatMessages.length);
    isAtBottomRef.current = true;
    setIsAtBottom(true);
  };

  const handleSend = () => {
    if (!draft.trim()) return;
    sendEvent("send_chatmessage", { message: draft });
    setDraft("");
    setIsAtBottom(true);
  };

  if (!game || !game.phaseState || !game.activePlayers || !users || !user) return null;

  const submittedWords = game.phaseState.words_cycle;
  const activePlayers = game.activePlayers;
  const isCurrentUserActive = activePlayers[user.user_id] ?? false;

  return (
    <PhaseTransition phaseKey="discuss">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold font-display text-foreground">Diskutera</h2>
        <p className="text-sm font-semibold text-muted-foreground font-display">Berätta, vem är misstänksam?</p>
      </div>
      <div className="flex flex-col justify-between w-full max-w-6xl gap-6 lg:flex-row">
        <div className="flex flex-col justify-between gap-3 flex-2 game-card">
          <h4 className="text-sm font-bold uppercase font-display text-muted-foreground">Chatt</h4>
          <div className="relative">
            <div ref={scrollRef} onScroll={handleScroll} className="w-full px-3 py-2 space-y-3 overflow-y-auto rounded-lg h-110 max-h-110 bg-muted/50">
              {chatMessages.length === 0 && <p className="flex items-center justify-center h-full py-8 text-sm text-center text-muted-foreground font-display">Inga medelanden ännu. Säg skriv vem som är misstänsam.</p>}
              {/* initial={false} → skip entrance anim for messages already present on mount */}
              <AnimatePresence initial={false}>
                {chatMessages.map((msg, i) => (
                  <motion.div key={i} className="flex items-start w-full gap-2" initial={{ opacity: 0, x: -14, scale: 0.97 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ type: "spring", stiffness: 380, damping: 30 }}>
                    <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-display font-bold text-white mt-0.5" style={{ backgroundColor: msg.sender.background }}>
                      {msg.sender.username[0]}
                    </span>
                    <div className="w-full min-w-0">
                      <span className="mr-1 text-xs font-bold font-display" style={{ color: msg.sender.background }}>
                        {msg.sender.username}
                      </span>
                      <span className="text-sm whitespace-pre-wrap font-display text-foreground wrap-break-word">{msg.message}</span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            <AnimatePresence>
              {!isAtBottom && unreadBelow > 0 && (
                <motion.button
                  onClick={scrollToBottom}
                  className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-display font-bold shadow-lg border-2 border-primary/50"
                  initial={{ opacity: 0, y: 10, scale: 0.88 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.88 }}
                  transition={{ type: "spring", stiffness: 420, damping: 26 }}>
                  <ChevronDown className="w-3 h-3" />
                  {unreadBelow} nya meddelanden
                </motion.button>
              )}
            </AnimatePresence>
          </div>
          <div className="flex gap-4">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={isCurrentUserActive ? "Skriv ett meddelande..." : "Du är inte aktiv..."}
              maxLength={200}
              disabled={!isCurrentUserActive}
              className="h-10 font-semibold border-2 font-body rounded-2xl"
            />
            <Button onClick={handleSend} disabled={!draft.trim() || !isCurrentUserActive} size="icon" className="w-10 h-10 shrink-0" aria-label="Skicka meddelande">
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="flex-1 lg:self-start game-card">
          <h3 className="mb-3 text-sm font-bold uppercase font-display text-muted-foreground">Ledtrådar</h3>
          <div className="space-y-3">
            {Object.entries(submittedWords ?? {}).map(([userId, clue]) => {
              const player = users[userId];
              const isActivePlayer = activePlayers[userId];
              return (
                <div key={userId} className={cn("flex items-center justify-between gap-3", !isActivePlayer && "opacity-40")}>
                  <div className="flex items-center min-w-0 gap-2">
                    <span className="flex items-center justify-center text-xs font-bold text-white rounded-full shrink-0 w-7 h-7 font-display" style={{ backgroundColor: player.background }}>
                      {player.username[0]}
                    </span>
                    <span className="text-sm font-semibold truncate font-display text-muted-foreground">{player.username}</span>
                  </div>
                  {/* snapIn gives a slight rotation — fits the "sneaky clue" feel */}
                  <AnimatePresence mode="wait">
                    {clue ? (
                      <motion.span key="clue" {...snapIn({ strength: 1.06, duration: 0.32 })} className="px-3 py-1 text-sm font-bold border-2 rounded-full shrink-0 bg-card border-border font-display text-foreground">
                        {clue}
                      </motion.span>
                    ) : (
                      <motion.span
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="px-3 py-1 text-sm font-bold border-2 border-dashed rounded-full shrink-0 border-border font-display text-muted-foreground">
                        —
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </PhaseTransition>
  );
}
