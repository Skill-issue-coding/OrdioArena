package events

// =============================================================================
// Server → Client: Impostor mode, events unique to this mode
// =============================================================================

const (
	// ImpostorGameStartedEvent is sent privately to each player at game start.
	// Payload: ImpostorInitialStatePayload (timers + phase + active_players + current_round + word + role)
	ImpostorGameStartedEvent EventType = "impostor_game_started"

	// ImpostorInputPhaseEvent is broadcast when the input phase begins or advances to the next player.
	// Payload: ImpostorInputPhasePayload (timers + current_player)
	ImpostorInputPhaseEvent EventType = "impostor_input_phase"

	// ImpostorSubmissionUpdateEvent is broadcast when a player submits a word.
	// Payload: ImpostorSubmissionUpdatePayload (player_id + word)
	ImpostorSubmissionUpdateEvent EventType = "impostor_submission_update"

	// ImpostorDiscussionPhaseEvent is broadcast when the discussion phase begins.
	// Payload: ImpostorDiscussionPhasePayload (timers + all submissions for the current cycle)
	ImpostorDiscussionPhaseEvent EventType = "impostor_discussion_phase"

	// ImpostorVotePhaseEvent is broadcast when the vote phase begins.
	// Payload: ImpostorVotePhasePayload (timers)
	ImpostorVotePhaseEvent EventType = "impostor_vote_phase"

	// ImpostorVoteUpdateEvent is broadcast immediately when any player casts a vote.
	// Payload: ImpostorVoteUpdatePayload (player_id + target)
	ImpostorVoteUpdateEvent EventType = "impostor_vote_update"

	// ImpostorIntermediateEvent is broadcast after vote result, entering the intermediate phase.
	// Payload: ImpostorIntermediatePayload (timers + voted_out + message + active_players)
	ImpostorIntermediateEvent EventType = "impostor_intermediate"

	// ImpostorRoundUpdateEvent is broadcast at the start of a new cycle with full round history.
	// Payload: ImpostorRoundUpdatePayload (all cycles so far)
	ImpostorRoundUpdateEvent EventType = "impostor_round_update"

	// GameResultEvent is broadcast when the game ends.
	// Payload: ImpostorGameResultPayload | AntiMatchGameResultPayload
	GameResultEvent EventType = "game_result"

	// AntiMatchInputPhaseEvent is broadcast when an anti-match input phase begins.
	// Payload: AntiMatchInputPhasePayload (timers + target_word + current_round + total_rounds)
	AntiMatchInputPhaseEvent EventType = "antimatch_input_phase"

	// AntiMatchSubmissionUpdateEvent is broadcast when a player submits a word.
	// Payload: AntiMatchSubmissionUpdatePayload (player_id + has_submitted)
	AntiMatchSubmissionUpdateEvent EventType = "antimatch_submission_update"

	// AntiMatchRoundResultEvent is broadcast when a round ends with scores.
	// Payload: AntiMatchRoundResultPayload (timers + results + winner + current_round + total_rounds)
	AntiMatchRoundResultEvent EventType = "antimatch_round_result"
)

// =============================================================================
// Client → Server: game input events
// =============================================================================

const (
	// GameSubmitWordRequestEvent is sent by a player to submit a word during
	// the input phase of Impostor, Anti-Match, and Synonym Duel modes.
	// Payload: GameSubmitWordPayload
	GameSubmitWordRequestEvent EventType = "game_submit_word"

	// GameSubmitGuessRequestEvent is sent by a player to submit a guess in
	// Contexto Battle mode. Players may submit multiple guesses per round.
	// Payload: GameSubmitGuessPayload
	GameSubmitGuessRequestEvent EventType = "game_submit_guess"

	// GameSubmitVoteRequestEvent is sent by a player to cast a vote during the
	// Impostor vote phase. A nil target indicates a skip vote.
	// Payload: GameSubmitVotePayload
	GameSubmitVoteRequestEvent EventType = "game_submit_vote"
)
