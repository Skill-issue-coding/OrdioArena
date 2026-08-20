import { ToastError, ToastSucess } from "@/lib/ToastFunctions"
import { log } from "@/lib/logger"
/**
 * @file Hook.tsx (hooks/websocket/Hook.tsx)
 * Global React context that manages the WebSocket transport layer.
 *
 * Architecture:
 * - This provider acts strictly as the network manager. It handles connecting,
 * reconnecting, and holding the actual `WebSocket` instance.
 * - It implements a Publish/Subscribe (PubSub) pattern. Instead of storing
 * incoming game state directly in React state (which causes massive re-renders),
 * it routes incoming JSON payloads to whatever child contexts are listening.
 * - Child contexts (like UserContext or LobbyContext) use the `subscribe`
 * function to listen for specific events.
 *
 * Usage:
 * ```tsx
 * const { sendEvent, subscribe, connectionStatus } = useWebsocketContext();
 *
 * useEffect(() => {
 * const unsubscribe = subscribe("chat_message", (payload) => {
 * console.log("New message:", payload);
 * });
 * return unsubscribe; // Cleans up when the component unmounts
 * }, [subscribe]);
 * ```
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import type { WSReceivedEvent, WSReceivedEventType, WSReceivedPayloadMap, WSSendEventType, WSSendPayloadMap } from "./types"

/**
 * Typed sendMessage function. The generic parameter T constrains the payload
 * shape to the one defined in WSSendPayloadMap for the given event type,
 * preventing mismatched event/payload combinations at compile time.
 */
export type SendMessageType = <T extends WSSendEventType>(type: T, payload: WSSendPayloadMap[T]) => void

/**
 * Represents the current state of the WebSocket connection.
 * Useful for displaying loading spinners or offline indicators in the UI.
 */
type ConnectionStatus = "connected" | "disconnected" | "error"

/** Subscriber callback type, payload is narrowed to the specific event's shape via WSReceivedPayloadMap. */
type EventCallback<T extends WSReceivedEventType> = (payload: WSReceivedPayloadMap[T]) => void

/** Shape of the value exposed by WebSocketContext. */
export interface WebsocketContextProps {
  /**
   * Send a typed event to the Go server. Silently no-ops if the socket is
   * not open and shows an error toast instead.
   */
  sendEvent: SendMessageType

  /**
   * Returns information about the current connection status.
   * - "connected": Socket is open and ready.
   * - "disconnected": Socket is closed (intentionally or dropped).
   * - "error": An error occurred during connection.
   */
  connectionStatus: ConnectionStatus

  /**
   * Registers a callback function to run whenever a specific WebSocket event
   * is received from the server.
   * @param eventType The string identifier of the event (e.g., "sync_gamestate").
   * @param callback The function to execute with the event payload.
   * @returns A cleanup function to immediately unsubscribe (ideal for useEffect returns).
   */
  subscribe: <T extends WSReceivedEventType>(eventType: T, callback: EventCallback<T>) => () => void
}

export const WebSocketContext = createContext<WebsocketContextProps | null>(null)

/**
 * useWebsocketContext returns the WebSocketContext value and throws if called outside
 * of a WebSocketProvider tree.
 */
export function useWebsocketContext() {
  const context = useContext(WebSocketContext)
  if (!context) throw new Error("useWebsocketContext must be used within a WebSocketProvider")
  return context
}

/**
 * WebSocketProvider mounts high in the component tree, opens the connection,
 * and provides the network transport and routing layer to all child contexts.
 */
export function WebSocketProvider({ children }: { children: ReactNode }) {
  /**
   * Holds the actual WebSocket instance. Using a ref ensures that we don't
   * trigger React re-renders just because the socket instance changes.
   */
  const wsRef = useRef<WebSocket | null>(null)

  /** Track connection status primarily for UI feedback. */
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected")

  /**
   * PUBSUB STATE: A map where the key is the event type (e.g., "sync_gamestate")
   * and the value is a Set of callback functions.
   * Kept in a ref so adding/removing listeners is silent and fast.
   */
  const subscribersRef = useRef<Map<WSReceivedEventType, Set<EventCallback<WSReceivedEventType>>>>(new Map())

  /**
   * PUBSUB METHOD: Expose this to child contexts so they can listen to events.
   * Wrapped in useCallback so it has a stable signature for child useEffects.
   */
  const subscribe = useCallback(<T extends WSReceivedEventType>(eventType: T, callback: EventCallback<T>) => {
    if (!subscribersRef.current.has(eventType)) subscribersRef.current.set(eventType, new Set())

    subscribersRef.current.get(eventType)!.add(callback as EventCallback<WSReceivedEventType>)

    // Return a cleanup function so useEffects in child contexts can easily unsubscribe
    return () => subscribersRef.current.get(eventType)?.delete(callback as EventCallback<WSReceivedEventType>)
  }, [])

  // Reconnect state: attempt counter, pending timeout handle, and backoff constants.
  const attemptRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxAttempts = 10
  const initialDelay = 1000

  useEffect(() => {
    let isUnmounted = false

    // Defined as a named function so the exponential-backoff onclose handler can call it recursively.
    const connect = () => {
      // Clear any pending reconnect timers safety check
      if (timeoutRef.current) clearTimeout(timeoutRef.current)

      const url = import.meta.env.VITE_WS_PATH ? `wss://${import.meta.env.VITE_WS_PATH}/ws/game` : `ws://localhost:8080/ws/game`

      log.ws.info("connecting", { url, attempt: attemptRef.current })
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setConnectionStatus("connected")
        log.ws.info("connected", { url, afterAttempts: attemptRef.current })
        attemptRef.current = 0 // Reset backoff on successful connection
      }

      ws.onerror = () => {
        setConnectionStatus("error")
        log.ws.error("socket error", { url, attempt: attemptRef.current })
      }

      ws.onclose = (e) => {
        setConnectionStatus("disconnected")
        log.ws.warn("socket closed", { code: e.code, reason: e.reason, wasClean: e.wasClean })

        // Stop reconnecting if the component unmounted or max attempts reached
        if (isUnmounted) return

        if (attemptRef.current >= maxAttempts) {
          log.ws.error("giving up reconnect", { maxAttempts })
          ToastError("Kunde inte återansluta till servern. Vänligen ladda om sidan.")
          return
        }

        ToastError(`Fel med anslutning. Försöker igen... (${attemptRef.current + 1}/${maxAttempts})`)

        // Exponential backoff logic: 1s, 2s, 4s, 8s, up to ~30s max cap
        const backoff = Math.min(initialDelay * Math.pow(2, attemptRef.current), 30000)
        const jitter = Math.random() * 0.5 * backoff
        const delay = backoff + jitter

        log.ws.info("scheduling reconnect", { delayMs: Math.round(delay), attempt: attemptRef.current + 1, maxAttempts })

        timeoutRef.current = setTimeout(() => {
          attemptRef.current++
          connect()
        }, delay)
      }

      /**
       * The master message router. Every incoming websocket message hits this first.
       */
      ws.onmessage = (event) => {
        let parsedEvent: WSReceivedEvent
        try {
          parsedEvent = JSON.parse(event.data) as WSReceivedEvent
        } catch (err) {
          log.ws.error("failed to parse incoming message", { err: String(err), raw: String(event.data).slice(0, 200) })
          return
        }
        const { type, payload } = parsedEvent

        if (type === "error") {
          log.ws.warn("server error event", { message: payload.message })
          ToastError(payload.message)
        }
        if (type === "success") ToastSucess(payload.message)

        log.ws.debug("recv", { type })

        const listeners = subscribersRef.current.get(type as WSReceivedEventType)
        if (listeners) listeners.forEach((callback) => callback(payload))
      }
    }

    connect()

    // Cleanup function component unmounts
    return () => {
      isUnmounted = true
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (wsRef.current) {
        // Remove onclose handler before closing to prevent triggering an instant reconnect loop during unmount
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [])

  /**
   * sendEvent serialises and sends a typed event to the server.
   * Stable reference via useCallback, safe to use in child useEffect dep arrays.
   */
  const sendEvent: SendMessageType = useCallback((type, payload) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      log.ws.warn("send dropped, socket not open", { type, readyState: wsRef.current?.readyState })
      ToastError("Ej ansluten till servern")
      return
    }
    log.ws.debug("send", { type })
    wsRef.current.send(JSON.stringify({ type, payload }))
  }, [])

  const value: WebsocketContextProps = {
    connectionStatus,
    sendEvent,
    subscribe,
  }

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>
}
