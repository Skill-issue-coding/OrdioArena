package game

import (
	"github.com/google/uuid"
)

type GamePhasePayload struct {
	StartTime int64 `json:"start_time"`
	// ReadyTime is StartTime + SYNC_DELAY. The client shows a "get ready"
	// overlay until this timestamp, then starts the actual phase countdown.
	ReadyTime int64 `json:"ready_time"`
	EndTime   int64 `json:"end_time"`
}

// Sent on every phase transition, maps 1:1 to BaseGameState
type GameBaseUpdatePayload struct {
	GamePhasePayload                    // timers
	Phase            string             `json:"phase"`
	ActivePlayers    map[uuid.UUID]bool `json:"active_players"`
	CurrentRound     int                `json:"current_round"`
}

// =============================================================================
// Impostor mode payload types
// =============================================================================

// ImpostorGameRoles identifies whether a player is a normal player or an impostor.
type ImpostorGameRoles string

const (
	ImpostorRoleNormal   ImpostorGameRoles = "normal"
	ImpostorRoleImpostor ImpostorGameRoles = "impostor"
)

// =============================================================================
// Server -> Client
// =============================================================================

// ImpostorInitialStatePayload is sent privately to each player at game start.
type ImpostorInitialStatePayload struct {
	GameBaseUpdatePayload
	Role ImpostorGameRoles `json:"role"`
	Word string            `json:"word"`
}

// ImpostorInputPhasePayload is broadcast when input phase begins or advances to next player.
type ImpostorInputPhasePayload struct {
	GamePhasePayload
	Phase         string    `json:"phase"` // always "input"
	CurrentPlayer uuid.UUID `json:"current_player"`
}

// ImpostorSubmissionUpdatePayload is broadcast when a player submits a word.
type ImpostorSubmissionUpdatePayload struct {
	PlayerID uuid.UUID `json:"player_id"`
	Word     string    `json:"word"`
}

// ImpostorDiscussionPhasePayload is broadcast when discussion phase begins.
type ImpostorDiscussionPhasePayload struct {
	GamePhasePayload
	Phase       string               `json:"phase"` // always "discussion"
	Submissions map[uuid.UUID]string `json:"submissions"`
}

// ImpostorVotePhasePayload is broadcast when vote phase begins.
type ImpostorVotePhasePayload struct {
	GamePhasePayload
	Phase string `json:"phase"` // always "vote"
}

// ImpostorVoteUpdatePayload is broadcast when a player casts a vote.
type ImpostorVoteUpdatePayload struct {
	PlayerID uuid.UUID  `json:"player_id"`
	Target   *uuid.UUID `json:"target"` // nil = skip vote
}

// ImpostorIntermediatePayload is broadcast after vote result, entering intermediate phase.
type ImpostorIntermediatePayload struct {
	GamePhasePayload
	Phase         string             `json:"phase"` // always "intermediate"
	VotedOut      *uuid.UUID         `json:"voted_out,omitempty"`
	Message       string             `json:"message"`
	ActivePlayers map[uuid.UUID]bool `json:"active_players"`
}

// ImpostorRoundUpdatePayload is broadcast at the start of a new cycle with full round history.
type ImpostorRoundUpdatePayload struct {
	Rounds []ImpostorCycle `json:"rounds"`
}

type AntiMatchSubmissionUpdatePayload struct {
	PlayerID     uuid.UUID `json:"player_id"`
	HasSubmitted bool      `json:"has_submitted"`
}

type ImpostorGameResultPayload struct {
	Cycles           []ImpostorCycle                 `json:"cycles"`
	Winners          []uuid.UUID                     `json:"winners"`
	Roles            map[uuid.UUID]ImpostorGameRoles `json:"roles"`
	Words            map[uuid.UUID]string            `json:"words"`
	NormalSecretWord string                          `json:"normal_word"`
}

// AntiMatchPlayerResult holds a single player's result for one round.
type AntiMatchPlayerResult struct {
	Word        string `json:"word"`
	Score       int    `json:"score"`
	IsDuplicate bool   `json:"is_duplicate"`
	TotalScore  int    `json:"total_score"`
}

// AntiMatchInputPhasePayload is broadcast when an input phase begins.
type AntiMatchInputPhasePayload struct {
	GamePhasePayload
	Phase        string `json:"phase"` // always "input"
	TargetWord   string `json:"target_word"`
	CurrentRound int    `json:"current_round"`
	TotalRounds  int    `json:"total_rounds"`
}

// AntiMatchRoundResultPayload is broadcast when a round ends.
type AntiMatchRoundResultPayload struct {
	GamePhasePayload
	Phase        string                          `json:"phase"` // always "round_result"
	TargetWord   string                          `json:"target_word"`
	Results      map[uuid.UUID]AntiMatchPlayerResult `json:"results"`
	Winner       *uuid.UUID                      `json:"winner,omitempty"`
	CurrentRound int                             `json:"current_round"`
	TotalRounds  int                             `json:"total_rounds"`
}

// AntiMatchGameResultPayload is broadcast when the game ends.
type AntiMatchGameResultPayload struct {
	TotalScores map[uuid.UUID]int `json:"total_scores"`
}

// =============================================================================
// Client → Server payload types
// =============================================================================

// GameSubmitWordPayload is the payload for GameSubmitWordRequestEvent.
type GameSubmitWordPayload struct {
	Word string `json:"word"`
}

// GameSubmitGuessPayload is the payload for GameSubmitGuessRequestEvent.
type GameSubmitGuessPayload struct {
	Word string `json:"word"`
}

// GameSubmitVotePayload is the payload for GameSubmitVoteRequestEvent.
// A nil Target indicates a skip vote (no elimination this round).
type GameSubmitVotePayload struct {
	Target *uuid.UUID `json:"target"`
}
