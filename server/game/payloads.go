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

type ImpostorClientGameStatePayload struct {
	Role          ImpostorGameRoles  `json:"role"`
	Word          string             `json:"word"`
	ActivePlayers map[uuid.UUID]bool `json:"active_players"`
}

type ImpostorGamePhaseUpdatePayload struct {
	GamePhasePayload `json:"timers"`
	WordsCycle       map[uuid.UUID]string     `json:"words_cycle"`
	VotesCycle       map[uuid.UUID]*uuid.UUID `json:"votes_cycle_votes"`
	CurrentPlayer    *uuid.UUID               `json:"current_player,omitempty"`
	Phase            ImpostorPhaseType        `json:"game_phase"`
}

type ImpostorGameCycleUpdatePayload struct {
	Cycles        []ImpostorCycle    `json:"cycles"`
	ActivePlayers map[uuid.UUID]bool `json:"active_players"`
}

type ImpostorVoteResultPayload struct {
	GamePhasePayload `json:"timers"`
	VotedOut         *uuid.UUID `json:"voted_out,omitempty"`
	Message          string     `json:"message"`
}

// ImpostorVoteUpdatePayload is broadcast after each individual vote is cast.
type ImpostorVoteUpdatePayload struct {
	Votes map[uuid.UUID]*uuid.UUID `json:"votes"`
}

type GameResultPayload struct {
	Cycles           []ImpostorCycle                 `json:"cycles"`
	Winners          []uuid.UUID                     `json:"winners"`
	Roles            map[uuid.UUID]ImpostorGameRoles `json:"roles"`
	Words            map[uuid.UUID]string            `json:"words"`
	NormalSecretWord string                          `json:"normal_word"`
}

type AntiMatchPhaseUpdatePayload struct {
	GamePhasePayload `json:"timers"`
	Phase      AntiMatchPhaseType `json:"game_phase"`
	TargetWord string             `json:"target_word"`
	Submissions      map[uuid.UUID]bool `json:"submissions"`
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
