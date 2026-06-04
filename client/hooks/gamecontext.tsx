"use client";

/**
 * @file gamecontext.tsx
 * React context that owns the in-progress game state.
 *
 * Architecture:
 * - Must be nested inside LobbyContextProvider (enforced at runtime).
 * - Subscribes to the three canonical game lifecycle events defined in
 *   game_events.go: game_round_started, new_game_phase, game_result.
 * - Mode-specific events (impostor_vote_update etc.) are handled by the
 *   individual game-view components, not here.
 * - Exposes a discriminated union (ActiveGameState) so callers can narrow
 *   all three payload types at once by checking gameState.mode.
 * - All state resets automatically when phase leaves "game_started".
 *
 * Usage:
 * ```tsx
 * const { gameState } = useGameContext();
 * if (gameState?.mode === "impostor") {
 *   gameState.roundState; // ImpostorClientGameState | null
 *   gameState.phaseState; // ImpostorPhaseUpdate | null
 *   gameState.result;     // ImpostorGameResult | null
 * }
 * ```
 */

import {
  ImpostorClientGameState,
  ImpostorGameResult,
  ImpostorPhaseUpdate,
  ImpostorVoteUpdate,
  ImpostorCycleUpdate,
  ImpostorVoteResult,
} from "@/lib/game/impostor-types";
import type { GameTimers } from "@/lib/game/types";
import { WSReceivedPayloadMap } from "@/lib/websocket/types";
import { createContext, ReactNode, useContext, useEffect, useRef, useState } from "react";
import { useLobbyContext } from "./lobbycontext";
import { useWebsocketContext } from "./websocketcontext";
import { AntiMatchPhaseUpdate, AntiMatchRoundResult } from "@/lib/game/antimatch-types";

/**
 * Discriminated union of per-mode game state.
 * Checking gameState.mode narrows all three fields to the correct payload
 * shapes for that mode — no separate casts needed at the call site.
 *
 * Add one entry per game mode as they are implemented.
 */
export type ActiveGameState =
  | {
      mode: "impostor";
      roundState: ImpostorClientGameState | null;
      phaseState: ImpostorPhaseUpdate | null;
      result: ImpostorGameResult | null;
      cycleState: ImpostorCycleUpdate | null;
      voteResult: ImpostorVoteResult | null;
      /** Active (non-eliminated) players. Set from game_round_started; updated on each impostor_new_cycle. */
      activePlayers: Record<string, boolean> | null;
    }
  | {
      mode: "anti_match";
      phaseState: AntiMatchPhaseUpdate | null;
      roundResultState: AntiMatchRoundResult | null;
    }
  | null;

export interface GameContextProps {
  /**
   * The current in-game state, or null when no game is active.
   * Discriminate on gameState.mode to get fully-typed payloads.
   */
  gameState: ActiveGameState;
}

export const GameContext = createContext<GameContextProps | null>(null);

/**
 * Access the current in-game state.
 * Throws if called outside of a GameContextProvider tree.
 */
export function useGameContext() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGameContext must be used within a GameContextProvider");
  return ctx;
}

/**
 * Returns the fully-narrowed impostor game state, or null when the active
 * mode is not "impostor" or no game is in progress.
 * Use this in impostor-specific components instead of useGameContext() to
 * avoid the mode check and get properly typed roundState/phaseState/result.
 */
export function useImpostorGame() {
  const { gameState } = useGameContext();
  return gameState?.mode === "impostor" ? gameState : null;
}

/**
 * Returns the fully-narrowed anti-match game state, or null when the active
 * mode is not "anti_match" or no game is in progress.
 * Use this in anti-match-specific components instead of useGameContext() to
 * avoid the mode check and get properly typed roundState/phaseState/result.
 */
export function useAntiMatchGame() {
  const { gameState } = useGameContext();
  return gameState?.mode === "anti_match" ? gameState : null;
}

/**
 * Returns the active phase's GameTimers regardless of game mode, or null when no
 * phase is in progress. Works for every mode that has timers in its phaseState
 * (impostor, anti_match, and future modes that follow the same shape).
 */
export function useGamePhaseTimers(): GameTimers | null {
  const { gameState } = useGameContext();
  if (!gameState || !gameState.phaseState) return null;
  return gameState.phaseState.timers;
}

/**
 * Returns false while the server's SYNC_DELAY window is still open (i.e. while
 * Date.now() < readyTime), then flips to true and stays true.
 * Pass game?.phaseState?.timers?.ready_time — when undefined, returns true immediately.
 */
export function usePhaseReady(readyTime: number | undefined): boolean {
  const [isReady, setIsReady] = useState(() => !readyTime || Date.now() >= readyTime);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!readyTime || Date.now() >= readyTime) {
      setIsReady(true);
      return;
    }

    setIsReady(false);
    timerRef.current = setTimeout(() => setIsReady(true), readyTime - Date.now());

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [readyTime]);

  return isReady;
}

/**
 * Returns the remaining milliseconds until readyTime, updating every 50ms.
 * Useful for displaying a countdown during the SYNC_DELAY "get ready" window.
 * Returns 0 when readyTime is undefined or already passed.
 */
export function usePhaseCountdown(readyTime: number | undefined): number {
  const [remaining, setRemaining] = useState(() => (!readyTime ? 0 : Math.max(0, readyTime - Date.now())));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (!readyTime || Date.now() >= readyTime) {
      setRemaining(0);
      return;
    }

    const tick = () => {
      const ms = Math.max(0, readyTime - Date.now());
      setRemaining(ms);
      if (ms === 0 && intervalRef.current) clearInterval(intervalRef.current);
    };

    intervalRef.current = setInterval(tick, 50);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [readyTime]);

  return remaining;
}

/**
 * Provides in-game state to all child components.
 * Must be nested inside LobbyContextProvider.
 *
 * Usage:
 * ```tsx
 * <LobbyContextProvider>
 *   <GameContextProvider>
 *     <App />
 *   </GameContextProvider>
 * </LobbyContextProvider>
 * ```
 */
export function GameContextProvider({ children }: { children: ReactNode }) {
  const { phase, mode } = useLobbyContext(); // enforces nesting — throws if outside LobbyContextProvider
  const { subscribe } = useWebsocketContext();

  // Raw internal state typed via WSReceivedPayloadMap — stays in sync with the WS
  // event definitions automatically. The types widen to a union as more game modes
  // are added to impostor.ts / antimatch.ts etc. in lib/websocket/game/.
  const [roundState, setRoundState] = useState<WSReceivedPayloadMap["game_round_started"] | null>(null);
  const [phaseState, setPhaseState] = useState<WSReceivedPayloadMap["new_game_phase"] | null>(null);
  const [result, setResult] = useState<WSReceivedPayloadMap["game_result"] | null>(null);
  const [roundResultState, setRoundResultState] = useState<unknown | null>(null);

  const [cycleState, setCycleState] = useState<ImpostorCycleUpdate | null>(null);
  const [voteResult, setVoteResult] = useState<ImpostorVoteResult | null>(null);
  const [activePlayers, setActivePlayers] = useState<Record<string, boolean> | null>(null);

  // Reset all game state when the lobby returns to the waiting room.
  // result is intentionally kept so ResultPhase stays mounted after game ends —
  // the player must click "Tillbaka till lobbyn" to leave. It is cleared when
  // the next game_round_started arrives (i.e. a new game begins).
  useEffect(() => {
    if (phase !== "game_started") {
      setRoundState(null);
      setPhaseState(null);
      setCycleState(null);
      setVoteResult(null);
      setActivePlayers(null);
    }
  }, [phase]);

  useEffect(() => {
    const unsubRound = subscribe("game_round_started", (payload) => {
      setResult(null); // clear any result from the previous game
      setRoundState(payload);
      // active_players in game_round_started is the authoritative initial set for cycle 0.
      setActivePlayers((payload as ImpostorClientGameState).active_players ?? null);
    });
    const unsubPhase = subscribe("new_game_phase", setPhaseState);
    const unsubResult = subscribe("game_result", setResult);
    const unsubVoteUpdate = subscribe("impostor_vote_update", (payload: ImpostorVoteUpdate) => {
      if (mode === "impostor") {
        setPhaseState((prev) => {
          if (!prev) return null;
          // Cast to the specific phase type for impostor mode and update votes
          const impostorPrev = prev as ImpostorPhaseUpdate;
          return {
            ...impostorPrev,
            votes_cycle_votes: payload.votes,
          };
        });
      }
    });
    const unsubNewCycle = subscribe("impostor_new_cycle", (payload: ImpostorCycleUpdate) => {
      if (mode === "impostor") {
        setCycleState(payload);
        setVoteResult(null); // Clear previous vote result when a new cycle begins
        setActivePlayers(payload.active_players); // Update active set after elimination
      }
    });
    const unsubVoteResult = subscribe("impostor_vote_result", (payload: ImpostorVoteResult) => {
      if (mode === "impostor") {
        setVoteResult(payload);
      }
    });
    const unsubRoundResult = subscribe("game_round_result", (payload) => {
      if (mode === "anti_match") {
        setPhaseState(payload); // We also update phaseState so the timers/phase strings stay in sync
        setRoundResultState(payload);
      }
    });

    return () => {
      unsubRound();
      unsubPhase();
      unsubResult();
      unsubVoteUpdate();
      unsubNewCycle();
      unsubVoteResult();
      unsubRoundResult();
    };
  }, [subscribe, mode]);

  // Build the discriminated union from mode. mode is the runtime guarantee that
  // the payloads match the expected shapes — the server never emits impostor
  // payloads while mode === "anti_match", so the casts are safe.
  //
  // We also build gameState when result is non-null even if phase has reverted to
  // the lobby phase — this keeps ResultPhase alive until the user navigates away.
  let gameState: ActiveGameState = null;
  if (phase === "game_started" || result !== null) {
    switch (mode) {
      case "impostor":
        gameState = {
          mode: "impostor",
          roundState: roundState as ImpostorClientGameState | null,
          phaseState: phaseState as ImpostorPhaseUpdate | null,
          result: result as ImpostorGameResult | null,
          cycleState: cycleState,
          voteResult: voteResult,
          activePlayers: activePlayers,
        };
        break;
      case "anti_match":
        gameState = {
          mode: "anti_match",
          phaseState: phaseState as AntiMatchPhaseUpdate | null,
          roundResultState: roundResultState as AntiMatchRoundResult | null,
        };
        break;
    }
  }

  return <GameContext.Provider value={{ gameState }}>{children}</GameContext.Provider>;
}
