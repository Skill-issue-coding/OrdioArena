/**
 * @file shared.ts (hooks/game/shared.ts)
 * Client → Server game input events shared across all game modes.
 *
 * Server → Client events use canonical event names defined in game_events.go
 * (game_round_started, new_game_phase, game_round_result, game_result) but
 * each mode defines its own payload shape in its own file (e.g. impostor.ts).
 */

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export type GameWSSendPayloadMap = {
  /** Submit a word during the input phase (Impostor, Anti-Match, Synonym Duel). */
  game_submit_word: { word: string }

  /** Submit a guess in Contexto Battle, multiple guesses are allowed per round. */
  game_submit_guess: { word: string }

  /**
   * Cast a vote during the Impostor vote phase.
   * A null target means the player chose to skip (no elimination).
   */
  game_submit_vote: { target: string | null }
}
