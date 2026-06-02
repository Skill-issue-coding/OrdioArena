/**
 * @file impostor-types.ts (lib/game)
 * Domain types for the Impostor game mode. These mirror the Go server's
 * game/payloads.go structs and are used throughout the React UI and WS layer.
 */

/** The current phase of an Impostor game. Mirrors Go's PhaseKind. */
export type ImpostorPhase = "show_word" | "input" | "discussion" | "vote" | "intermediate" | "result";

/** A player's role in an Impostor game. */
export type ImpostorRole = "normal" | "impostor";

/**
 * All submissions and votes recorded in a single game cycle.
 * Mirrors Go's ImpostorCycle struct.
 */
export type ImpostorCycle = {
  /** Word submissions keyed by player UUID. */
  submissions: Record<string, string>;
  /** Votes keyed by voter UUID; null value means a skip vote. */
  votes: Record<string, string | null>;
};

/** Server-side timestamps for a timed phase. Mirrors Go's GamePhasePayload. */
export type GameTimers = {
  /** Phase start time in Unix milliseconds. */
  start_time: number;
  /** When the actual phase begins (start_time + SYNC_DELAY). Show "get ready" overlay until this timestamp. */
  ready_time: number;
  /** Phase end time in Unix milliseconds. */
  end_time: number;
};

/**
 * Delivered privately to each player at game start with their word and role.
 * Mirrors Go's ImpostorClientGameStatePayload.
 * Timer data is not included here — it arrives in the immediately-following
 * ImpostorPhaseUpdate (new_game_phase) event, which is the single source of
 * truth for all phase timers.
 */
export type ImpostorClientGameState = {
  role: ImpostorRole;
  word: string;
  /** Initial set of active players at game start. Updates arrive via impostor_new_cycle. */
  active_players: Record<string, boolean>;
};

/**
 * Broadcast whenever the phase or current input turn changes.
 * Mirrors Go's ImpostorGamePhaseUpdatePayload.
 */
export type ImpostorPhaseUpdate = {
  timers: GameTimers;
  /** All word submissions for the current cycle, keyed by player UUID. */
  words_cycle: Record<string, string>;
  /** All votes cast so far this cycle, keyed by voter UUID; null = skip vote. */
  votes_cycle_votes: Record<string, string | null>;
  /** UUID of the player whose input turn it currently is. Absent outside the input phase. */
  current_player?: string;
  game_phase: ImpostorPhase;
};

/**
 * Broadcast at the start of each new cycle with updated player and cycle state.
 * Mirrors Go's ImpostorGameCycleUpdatePayload.
 */
export type ImpostorCycleUpdate = {
  cycles: ImpostorCycle[];
  active_players: Record<string, boolean>;
};

/**
 * Broadcast when a vote phase ends, revealing the elimination result.
 * Mirrors Go's ImpostorVoteResultPayload.
 *
 * `voted_out` is absent (not null) when no player was eliminated — the Go
 * server uses `omitempty` on a pointer, so a nil pointer is omitted entirely.
 */
export type ImpostorVoteResult = {
  timers: GameTimers;
  /** UUID of the eliminated player. Absent if nobody was voted out. */
  voted_out?: string;
  /** Human-readable result message (in Swedish). */
  message: string;
};

/**
 * Live vote snapshot broadcast each time any player casts a vote.
 * Mirrors Go's ImpostorVoteUpdatePayload.
 */
export type ImpostorVoteUpdate = {
  /** Current votes keyed by voter UUID; null value = skip vote. */
  votes: Record<string, string | null>;
};

/**
 * Broadcast once when the game ends with full results for all players.
 * Mirrors Go's GameResultPayload.
 */
export type ImpostorGameResult = {
  cycles: ImpostorCycle[];
  /** UUIDs of the winning side's players. */
  winners: string[];
  /** Each player's role, keyed by UUID. */
  roles: Record<string, ImpostorRole>;
  /** Each player's word (normal word or their impostor word), keyed by UUID. */
  words: Record<string, string>;
  normal_word: string;
};
