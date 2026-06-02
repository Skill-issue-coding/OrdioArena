"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, MessageCircle, Send } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLobbyContext } from "@/hooks/lobbycontext";
import { useUserContext } from "@/hooks/usercontext";
import { useWebsocketContext } from "@/hooks/websocketcontext";

const formatTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const ChatButton = () => {
  const { chatMessages, code, phase } = useLobbyContext();
  const { user } = useUserContext();
  const { sendEvent } = useWebsocketContext();

  const location = usePathname();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [lastReadIndex, setLastReadIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Tracks whether the scroll container is at the bottom (via ref to avoid stale closures in effects).
  const isAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  // readCount = message count the last time the user was at the bottom while the chat was open.
  const [readCount, setReadCount] = useState(0);
  const unreadBelow = Math.max(0, chatMessages.length - readCount);

  const visible = location.startsWith("/lobby") && code && phase !== "game_started" && !location.endsWith("/game");
  const unread = Math.max(0, chatMessages.length - lastReadIndex);

  // Keep badge count (closed state) in sync and reset it when popover opens.
  useEffect(() => {
    if (open) {
      setLastReadIndex(chatMessages.length);
      return;
    }
    if (lastReadIndex > chatMessages.length) setLastReadIndex(chatMessages.length);
  }, [open, chatMessages, lastReadIndex]);

  // Scroll to bottom immediately when the popover opens.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setReadCount(chatMessages.length);
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    // chatMessages.length intentionally excluded — we only want this on open/close transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-scroll when a new message arrives and the user is already at the bottom.
  useEffect(() => {
    if (!open) return;
    if (isAtBottomRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      setReadCount(chatMessages.length);
    }
  }, [chatMessages.length, open]);

  if (!visible) return null;

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
    if (!code) return;
    if (!draft.trim()) return;
    sendEvent("send_chatmessage", { message: draft });
    setDraft("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button aria-label="Open chat" className="fixed z-50 overflow-visible rounded-full outline-none cursor-pointer bottom-6 right-6 w-14 h-14 group">
          <div className="w-full h-full rounded-full flex items-center justify-center text-white border-4 border-card bg-primary transition-all duration-200 ease-out group-hover:scale-110 group-active:scale-95 shadow-[0_4px_0_0_oklch(from_var(--color-primary)_l_c_h/0.5),0_8px_20px_oklch(from_var(--color-game-shadow)_l_c_h/0.2)]">
            <MessageCircle className="w-6 h-6 -scale-x-100" />
            {unread > 0 && <span className="absolute flex items-center justify-center h-5 px-1 text-xs font-bold text-white border-2 rounded-full -top-1 -right-1 min-w-5 bg-game-red font-display border-card">{unread > 9 ? "9+" : unread}</span>}
          </div>
        </button>
      </PopoverTrigger>

      <PopoverContent side="top" align="end" sideOffset={12} className="z-50 w-70 max-w-[calc(100vw-2rem)] p-0 rounded-lg border-2 overflow-hidden flex flex-col h-112 max-h-[calc(100vh-7rem)] shadow-xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex items-center px-4 py-3 border-b-2 border-border shrink-0 gap-2">
          <MessageCircle className="w-5 h-5 text-game-blue" />
          <div className="text-base font-bold font-display">Chattrum</div>
        </div>

        <div className="relative flex-1 min-h-0">
          <div ref={scrollRef} onScroll={handleScroll} className="h-full px-3 py-2 overflow-y-auto space-y-3">
            {chatMessages.length === 0 && <p className="py-8 text-sm text-center text-muted-foreground font-display">Inga medelanden ännu. Säg hej! 👋</p>}
            {chatMessages.map((m) => {
              const self = m.sender.user_id === user?.user_id;
              return (
                <div key={`${m.sender.user_id}-${m.date}`} className={cn("flex gap-3 items-end", self && "flex-row-reverse")}>
                  <div className="flex items-center justify-center text-xs font-bold text-white border-2 rounded-full w-7 h-7 font-display border-card shrink-0" style={{ backgroundColor: m.sender.background }}>
                    {m.sender.username.charAt(0).toUpperCase()}
                  </div>
                  <div className={cn("max-w-[75%] flex flex-col min-w-0", self ? "items-end" : "items-start")}>
                    <div
                      className={cn(
                        "px-3 py-2 rounded-2xl border-2 font-display font-semibold text-sm w-fit max-w-full wrap-break-word whitespace-pre-wrap",
                        self ? "bg-primary text-primary-foreground border-primary rounded-br-md" : "bg-muted border-border text-foreground rounded-bl-md",
                      )}>
                      {m.message}
                    </div>
                    <div className="text-[10px] font-display font-bold text-muted-foreground px-1 mt-1">
                      {self ? "You" : m.sender.username} · {formatTime(m.date)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {!isAtBottom && unreadBelow > 0 && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-display font-bold shadow-lg border-2 border-primary/50 transition-opacity">
              <ChevronDown className="w-3 h-3" />
              {unreadBelow} nya meddelanden
            </button>
          )}
        </div>

        <div className="flex p-3 border-t-2 border-border shrink-0 gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Skriv ett meddelande..."
            maxLength={200}
            className="h-10 font-semibold border-2 font-body rounded-2xl"
          />
          <Button onClick={handleSend} disabled={!draft.trim()} size="icon" className="w-10 h-10 shrink-0" aria-label="Send message">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ChatButton;
