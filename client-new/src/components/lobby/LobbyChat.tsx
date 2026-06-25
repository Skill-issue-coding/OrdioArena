import { useEffect, useRef, useState } from "react"
import { useRouterState } from "@tanstack/react-router"
import { ChevronDown, MessageCircle, Send } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useLobbyContext } from "@/hooks/lobby/Hook"
import { useUserContext } from "@/hooks/user/Hook"
import { useWebsocketContext } from "@/hooks/websocket/Hook"
import { useUIOverlay } from "@/hooks/ui/Hook"

const formatTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

export function LobbyChat() {
  const lobby = useLobbyContext()
  const chatMessages = lobby?.chatMessages ?? []
  const code = lobby?.code
  const phase = lobby?.phase
  const { user } = useUserContext()
  const { sendEvent } = useWebsocketContext()
  const { isOverlayActive } = useUIOverlay()

  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [lastReadIndex, setLastReadIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Tracks whether the scroll container is at the bottom (via ref to avoid stale closures in effects).
  const isAtBottomRef = useRef(true)
  const [isAtBottom, setIsAtBottom] = useState(true)
  // readCount = message count the last time the user was at the bottom while the chat was open.
  const [readCount, setReadCount] = useState(0)
  const unreadBelow = Math.max(0, chatMessages.length - readCount)

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const visible = mounted && pathname.startsWith("/lobby") && code && phase !== "game_started" && !pathname.endsWith("/game") && !isOverlayActive
  const unread = Math.max(0, chatMessages.length - lastReadIndex)

  // Keep badge count (closed state) in sync and reset it when popover opens.
  useEffect(() => {
    if (open) {
      setLastReadIndex(chatMessages.length)
      return
    }
    if (lastReadIndex > chatMessages.length) setLastReadIndex(chatMessages.length)
  }, [open, chatMessages, lastReadIndex])

  // Scroll to bottom immediately when the popover opens.
  useEffect(() => {
    if (!open) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    setReadCount(chatMessages.length)
    isAtBottomRef.current = true
    setIsAtBottom(true)
    // chatMessages.length intentionally excluded — we only want this on open/close transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Auto-scroll when a new message arrives and the user is already at the bottom.
  useEffect(() => {
    if (!open) return
    if (isAtBottomRef.current) {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
      setReadCount(chatMessages.length)
    }
  }, [chatMessages.length, open])

  if (!visible) return null

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8
    isAtBottomRef.current = atBottom
    if (atBottom !== isAtBottom) setIsAtBottom(atBottom)
    if (atBottom) setReadCount(chatMessages.length)
  }

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    setReadCount(chatMessages.length)
    isAtBottomRef.current = true
    setIsAtBottom(true)
  }

  const handleSend = () => {
    if (!code) return
    if (!draft.trim()) return
    sendEvent("send_chatmessage", { message: draft })
    setDraft("")
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button aria-label="Open chat" className="group fixed right-6 bottom-6 z-50 h-14 w-14 cursor-pointer overflow-visible rounded-full outline-none">
          <div className="flex h-full w-full items-center justify-center rounded-full border-4 border-card bg-primary text-white shadow-[0_4px_0_0_oklch(from_var(--color-primary)_l_c_h/0.5),0_8px_20px_oklch(from_var(--color-game-shadow)_l_c_h/0.2)] transition-all duration-200 ease-out group-hover:scale-110 group-active:scale-95">
            <MessageCircle className="h-6 w-6 -scale-x-100" />
            {unread > 0 && <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-card bg-game-red px-1 font-display text-xs font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
          </div>
        </button>
      </PopoverTrigger>

      <PopoverContent side="top" align="end" sideOffset={12} className="z-50 flex h-112 max-h-[calc(100vh-7rem)] w-70 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border-2 p-0 shadow-xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex shrink-0 items-center gap-2 border-b-2 border-border px-4 py-3">
          <MessageCircle className="h-5 w-5 text-game-blue" />
          <div className="font-display text-base font-bold">Chattrum</div>
        </div>

        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} onScroll={handleScroll} className="h-full space-y-3 overflow-y-auto px-3 py-2">
            {chatMessages.length === 0 && <p className="py-8 text-center font-display text-sm text-muted-foreground">Inga medelanden ännu. Säg hej! 👋</p>}
            {chatMessages.map((m) => {
              const self = m.sender.user_id === user?.user_id
              return (
                <div key={`${m.sender.user_id}-${m.date}`} className={cn("flex items-end gap-3", self && "flex-row-reverse")}>
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-card font-display text-xs font-bold text-white" style={{ backgroundColor: m.sender.background }}>
                    {m.sender.username.charAt(0).toUpperCase()}
                  </div>
                  <div className={cn("flex max-w-[75%] min-w-0 flex-col", self ? "items-end" : "items-start")}>
                    <div
                      className={cn(
                        "w-fit max-w-full rounded-2xl border-2 px-3 py-2 font-display text-sm font-semibold wrap-break-word whitespace-pre-wrap",
                        self ? "rounded-br-md border-primary bg-primary text-primary-foreground" : "rounded-bl-md border-border bg-muted text-foreground"
                      )}
                    >
                      {m.message}
                    </div>
                    <div className="mt-1 px-1 font-display text-[10px] font-bold text-muted-foreground">
                      {self ? "You" : m.sender.username} · {formatTime(m.date)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {!isAtBottom && unreadBelow > 0 && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border-2 border-primary/50 bg-primary px-3 py-1.5 font-display text-xs font-bold whitespace-nowrap text-primary-foreground shadow-lg transition-opacity"
            >
              <ChevronDown className="h-3 w-3" />
              {unreadBelow} nya meddelanden
            </button>
          )}
        </div>

        <div className="flex shrink-0 gap-2 border-t-2 border-border p-3">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Skriv ett meddelande..."
            maxLength={200}
            className="h-10 rounded-2xl border-2 font-body font-semibold"
          />
          <Button onClick={handleSend} disabled={!draft.trim()} size="icon" className="h-10 w-10 shrink-0" aria-label="Send message">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
