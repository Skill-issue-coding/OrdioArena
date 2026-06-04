"use client";

/**
 * @file lobbycontext.tsx
 * Global React context that owns lobby state and chat history.
 *
 * Architecture:
 * - Subscribes to the websocket transport for lobby-specific events.
 * - Keeps the latest lobby code in a ref for navigation on join.
 * - Updates lobby state and chat messages in response to server syncs.
 *
 * Usage:
 * ```tsx
 * const { lobbyState, chatMessages } = useLobbyContext();
 * ```
 */

import { ToastSucess } from "@/lib/toast-functions";
import { WSSendEventType, WSSendPayloadMap, WSReceivedPayloadMap } from "@/lib/websocket/types";
import { useRouter } from "next/navigation";
import { createContext, ReactNode, useContext, useEffect, useState, useRef } from "react";
import { useWebsocketContext } from "./websocketcontext";
import { ChatMessage, LobbyState } from "@/lib/game/lobby";

/**
 * Typed sendMessage function. The generic parameter T constrains the payload
 * shape to the one defined in WSSendPayloadMap for the given event type,
 * preventing mismatched event/payload combinations at compile time.
 */
export type SendMessageType = <T extends WSSendEventType>(type: T, payload: WSSendPayloadMap[T]) => void;

/** Shape of the value exposed by LobbyContext. */
export interface LobbyContextProps {
  /** Human-readable room code (e.g. "AbCd-1234"), or null when not in a lobby. */
  code: LobbyState["code"] | null;
  /** Active game mode, or null when not in a lobby. */
  mode: LobbyState["mode"] | null;
  /** Current lobby phase, or null when not in a lobby. */
  phase: LobbyState["phase"] | null;
  /** user_id of the player with host privileges, or null when not in a lobby. */
  host: LobbyState["host"] | null;
  /** All players currently in the lobby, or null when not in a lobby. */
  users: LobbyState["users"] | null;
  /** Active mode's settings, or null when not in a lobby. */
  settings: LobbyState["settings"] | null;
  /** Chat messages sent within the lobby. */
  chatMessages: ChatMessage[];
}

export const LobbyContext = createContext<LobbyContextProps | null>(null);

/**
 * Access the current lobby state and chat messages.
 * Throws if called outside of a LobbyContextProvider tree.
 *
 * Usage:
 * ```tsx
 * const { lobbyState, chatMessages } = useLobbyContext();
 * ```
 */
export function useLobbyContext() {
  const context = useContext(LobbyContext);
  if (!context) throw new Error("useLobbyContext must be used within a LobbyContextProvider");
  return context;
}

/**
 * Provides the lobby context to all child components.
 * Must be nested inside WebSocketProvider.
 *
 * Usage:
 * ```tsx
 * <LobbyContextProvider>
 *   <App />
 * </LobbyContextProvider>
 * ```
 */
export function LobbyContextProvider({ children }: { children: ReactNode }) {
  const { subscribe } = useWebsocketContext();

  // Kept in a ref to avoid stale closures in event handlers without triggering re-renders
  const lobbyCodeRef = useRef<string>("");

  const [lobbyState, setLobbyState] = useState<WSReceivedPayloadMap["sync_gamestate"]["lobbystate"] | null>(null);
  const [chatMessages, setChatMessages] = useState<WSReceivedPayloadMap["chat_message"][]>([]);

  const router = useRouter();

  useEffect(() => {
    const unsubJoinError = subscribe("join_error", () => router.push("/"));

    const unsubLeftLobby = subscribe("left_lobby", () => {
      setChatMessages([]);
      setLobbyState(null);
      lobbyCodeRef.current = "";
    });

    const unsubChat = subscribe("chat_message", (payload) =>
      setChatMessages((prev) => {
        const next = [...prev, payload];
        return next.length > 200 ? next.slice(-200) : next;
      }),
    );

    const unsubSync = subscribe("sync_gamestate", (payload) => {
      lobbyCodeRef.current = payload.lobbystate.code;
      setLobbyState(payload.lobbystate);
      if (payload.message) ToastSucess(payload.message);
    });

    const unsubJoined = subscribe("joined_lobby", () => {
      if (lobbyCodeRef.current) router.push(`/lobby/${lobbyCodeRef.current}`);
    });

    const unsubGameStarted = subscribe("game_started", () => router.push(`/lobby/${lobbyCodeRef.current}/game`));

    return () => {
      unsubJoinError();
      unsubLeftLobby();
      unsubChat();
      unsubSync();
      unsubJoined();
      unsubGameStarted();
    };
  }, [router, subscribe]);

  const value: LobbyContextProps = {
    code: lobbyState?.code ?? null,
    mode: lobbyState?.mode ?? null,
    phase: lobbyState?.phase ?? null,
    host: lobbyState?.host ?? null,
    users: lobbyState?.users ?? null,
    settings: lobbyState?.settings ?? null,
    chatMessages,
  };

  return <LobbyContext.Provider value={value}>{children}</LobbyContext.Provider>;
}
