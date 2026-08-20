/**
 * @file logger.ts
 * Client-side domain logger that mirrors the Go server's logging package.
 *
 * Domains: "ws" | "lobby" | "game", same split as the server's hub/lobby/game
 * log files.
 *
 * Two sinks, always layered:
 *   1. Console, always on, gated by a level threshold (debug in dev, info in
 *      prod, override with VITE_LOG_LEVEL).
 *   2. Server file, when VITE_LOG_TO_SERVER="true", logs are batched and POSTed
 *      to /api/log, where the server appends them to logs/client.log. This is
 *      the browser-side parallel to LOG_TO_FILE: you tail one place on the
 *      server to see what every client did.
 *
 * Usage:
 *   import { log, setLogUserId } from "@/lib/logger"
 *   log.ws.info("connected", { url })
 *   log.game.debug("submitting word", { word })
 *   setLogUserId(user.user_id) // attaches id to every shipped entry
 */

export type LogLevel = "debug" | "info" | "warn" | "error"
export type LogDomain = "ws" | "lobby" | "game"

type LogEntry = {
  time: string
  level: LogLevel
  domain: LogDomain
  msg: string
  user_id?: string
  data?: Record<string, unknown>
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

// Console threshold: env override → debug in dev → info in prod.
const envLevel = (import.meta.env.VITE_LOG_LEVEL as LogLevel | undefined) ?? (import.meta.env.DEV ? "debug" : "info")
const threshold = LEVEL_ORDER[envLevel] ?? LEVEL_ORDER.info

// Server shipping toggle (browser parallel of the server's LOG_TO_FILE).
const SHIP_TO_SERVER = import.meta.env.VITE_LOG_TO_SERVER === "true"

// Resolve the /api/log endpoint the same way the username call resolves its
// backend base (VITE_PUBLIC_BACKEND_PATH already includes the /api prefix).
const backendBase = import.meta.env.VITE_PUBLIC_BACKEND_PATH ? `${import.meta.env.VITE_PUBLIC_BACKEND_PATH}` : "http://localhost:8080/api"
const LOG_ENDPOINT = `${backendBase}/log`

let userId: string | undefined

/** Attach a user id to every subsequently shipped log entry. */
export function setLogUserId(id: string | undefined) {
  userId = id
}

// ── Server shipping: batch + flush ──────────────────────────────────────────

const queue: LogEntry[] = []
const FLUSH_INTERVAL_MS = 3000
const FLUSH_AT_SIZE = 20
const MAX_QUEUE = 500 // hard cap so an offline tab can't grow unbounded

function enqueue(entry: LogEntry) {
  if (!SHIP_TO_SERVER) return
  queue.push(entry)
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE)
  if (queue.length >= FLUSH_AT_SIZE) flush()
}

function flush(useBeacon = false) {
  if (!SHIP_TO_SERVER || queue.length === 0) return
  const entries = queue.splice(0, queue.length)
  const body = JSON.stringify({ entries })

  // On page unload, sendBeacon is the only reliable transport.
  if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon(LOG_ENDPOINT, new Blob([body], { type: "application/json" }))
    return
  }

  // keepalive lets the request outlive a navigation. Failures are swallowed —
  // logging must never break the app.
  fetch(LOG_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Re-queue on failure so logs survive a transient network blip.
    queue.unshift(...entries)
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE)
  })
}

if (SHIP_TO_SERVER && typeof window !== "undefined") {
  setInterval(() => flush(), FLUSH_INTERVAL_MS)
  // Flush remaining logs when the tab is hidden or closed.
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true)
  })
  window.addEventListener("pagehide", () => flush(true))
}

// ── Console sink ────────────────────────────────────────────────────────────

const consoleFn: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
}

function emit(domain: LogDomain, level: LogLevel, msg: string, data?: Record<string, unknown>) {
  const entry: LogEntry = { time: new Date().toISOString(), level, domain, msg, user_id: userId, data }

  if (LEVEL_ORDER[level] >= threshold) {
    const prefix = `%c[${domain}]`
    const color = domain === "ws" ? "color:#06b6d4" : domain === "lobby" ? "color:#a855f7" : "color:#22c55e"
    if (data) consoleFn[level](prefix, color, msg, data)
    else consoleFn[level](prefix, color, msg)
  }

  enqueue(entry)
}

type DomainLogger = Record<LogLevel, (msg: string, data?: Record<string, unknown>) => void>

function makeDomain(domain: LogDomain): DomainLogger {
  return {
    debug: (msg, data) => emit(domain, "debug", msg, data),
    info: (msg, data) => emit(domain, "info", msg, data),
    warn: (msg, data) => emit(domain, "warn", msg, data),
    error: (msg, data) => emit(domain, "error", msg, data),
  }
}

export const log = {
  ws: makeDomain("ws"),
  lobby: makeDomain("lobby"),
  game: makeDomain("game"),
}

/** Force-flush any queued logs immediately (e.g. before a hard reload). */
export function flushLogs() {
  flush()
}
