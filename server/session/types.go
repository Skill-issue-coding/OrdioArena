// Package session manages all WebSocket client connections, game lobbies,
// and the central hub that coordinates them. It is the core runtime layer
// of the game server.
package session

import (
	"server/game"
	"server/words"
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// GamePhase represents the current lifecycle stage of a lobby.
type GamePhase string

// GameMode identifies which of the four game modes is active in a lobby.
type GameMode string

const (
	// LobbyPhase indicates the lobby is in the waiting room, players can join
	// and settings can be changed, but the game has not started.
	LobbyPhase GamePhase = "lobby"

	// GameStarted indicates the game is in progress. New players cannot join.
	GameStarted GamePhase = "game_started"

	// ModeImpostor is the "Who is the Impostor?" word-deduction mode.
	ModeImpostor GameMode = "impostor"

	// ModeContextoBattle is the competitive Contexto-style guessing mode.
	ModeContextoBattle GameMode = "contexto_battle"

	// ModeSynonymDuel is the King-of-the-Hill synonym elimination mode.
	ModeSynonymDuel GameMode = "synonym_duel"

	// ModeAntiMatch is the Anti-Hivemind unique-word mode.
	ModeAntiMatch GameMode = "anti_match"
)

// Client represents a single connected WebSocket player.
// It is created when a player upgrades their HTTP connection and lives until
// the connection is closed.
type Client struct {
	// UserId is the player's unique identifier, assigned at connection time.
	UserId uuid.UUID

	// Profile holds the player's display identity. Use the Username() and
	// Background() helpers rather than accessing fields directly.
	Profile *UserProfile

	// Hub is a reference to the central GameHub this client is registered with.
	Hub *GameHub

	// Conn is the underlying gorilla/websocket connection.
	Conn *websocket.Conn

	// Send is a buffered channel of outgoing JSON-encoded event messages.
	// Data should be written to it via SendEvent, never directly.
	Send chan []byte

	// Lobby is the room the client is currently in, or nil if they are in
	// the hub but have not yet joined a lobby.
	Lobby *GameLobby
}

// Username returns the player's current display name from their profile.
func (c *Client) Username() string { return c.Profile.Username }

// Background returns the player's current background color from their profile.
func (c *Client) Background() string { return c.Profile.Background }

// UserProfile stores a player's identity and cosmetic data.
// It is shared by pointer between Client and GameLobby.Users.
type UserProfile struct {
	UserId     uuid.UUID `json:"user_id"`
	Username   string    `json:"username"`
	Background string    `json:"background"`
}

// LobbyState is the complete shared lobby state that is broadcast to every
// client in a lobby on each sync. It contains no private per-player data and
// no game-specific state, game phases manage their own state via GameOutput events.
type LobbyState struct {
	Code     string                     `json:"code"`
	Mode     GameMode                   `json:"mode"`
	Phase    GamePhase                  `json:"phase"`
	Host     uuid.UUID                  `json:"host"`
	Users    map[uuid.UUID]*UserProfile `json:"users"`
	Settings any                        `json:"settings"`
}

// GameLobby represents an active game room. It has its own Run() goroutine that
// processes all state changes sequentially via channels.
type GameLobby struct {
	// ID is the human-readable room code (e.g., "abcd-1234").
	ID string

	// Clients is the set of currently connected players in this lobby.
	Clients map[*Client]bool

	// Register adds a new client to the lobby.
	Register chan *Client

	// Unregister removes a client from the lobby (on disconnect or leave).
	Unregister chan *Client

	// ChatMessages is a channel to broadcast chat messages to all clients in the lobby.
	ChatMessages chan ChatMessage

	// ModeUpdateRequests is a channel used to process lobby game mode updates.
	ModeUpdateRequests chan GameMode

	// SettingUpdateRequests is a channel used to process lobby setting updates.
	SettingUpdateRequests chan UpdateSettingPayload

	// SyncRequest sends the current lobby state only to the requesting client.
	// Use this for reconnects or initial state hydration.
	SyncRequest chan *Client

	// ProfileUpdateRequests signals that a client updated their profile (name,
	// avatar). The lobby broadcasts the new state to all clients.
	ProfileUpdateRequests chan struct{}

	// StartGameRequests is used by clients to request that the game starts.
	// Handling it inside Run() ensures Clients is only accessed from one goroutine.
	StartGameRequests chan *Client

	// GameDone is closed by the active game when it finishes, signalling the
	// lobby to reset back to LobbyPhase.
	GameDone chan struct{}

	// CurrentGame holds the active game instance while the lobby is in the
	// GameStarted phase, or nil when the lobby is in the waiting room.
	CurrentGame game.Game

	// GameInputs carries player actions from client ReadPumps to the lobby's
	// Run goroutine, which forwards them to the active game via HandleInput.
	GameInputs chan game.GameInput

	// GameOutputs carries events from the active game back to the lobby for
	// delivery to clients. The game writes here; the lobby's Run goroutine drains
	// and routes each output to the appropriate client(s).
	GameOutputs chan game.GameOutput

	// Host is the UserId of the player with administrative privileges.
	Host uuid.UUID

	// Phase is the current lifecycle stage of the lobby.
	Phase GamePhase

	// Users is the player roster keyed by UserId.
	Users map[uuid.UUID]*UserProfile

	// Mode is the game mode currently selected for this lobby.
	Mode GameMode

	// ImpostorSettings holds the configuration for the Impostor game mode.
	ImpostorSettings game.ImpostorSettings

	// ContextoBattleSettings holds the configuration for the Contexto Battle game mode.
	ContextoBattleSettings game.ContextoBattleSettings

	// SynonymDuelSettings holds the configuration for the Synonym Duel game mode.
	SynonymDuelSettings game.SynonymDuelSettings

	// AntiMatchSettings holds the configuration for the Anti-Match game mode.
	AntiMatchSettings game.AntiMatchSettings
}

// GameHub is the top-level coordinator for all connected clients and lobbies.
// It runs a single goroutine (Run) that owns the Clients and Lobbies maps.
type GameHub struct {
	// Dictionary is the in-memory Swedish fastText word vector store used by
	// all game modes for semantic distance calculations.
	Dictionary words.Dictionary

	// Clients is the set of all currently connected WebSocket clients.
	Clients map[*Client]bool

	// Lobbies maps room codes to active GameLobby instances.
	Lobbies map[string]*GameLobby

	// LobbiesMutex guards the Lobbies map for concurrent access from handler goroutines.
	LobbiesMutex sync.RWMutex

	// Broadcast sends a raw message to every connected client.
	Broadcast chan []byte

	// Register adds a newly connected client to the hub.
	Register chan *Client

	// Unregister removes a client from the hub and closes their Send channel.
	Unregister chan *Client
}

// ChatMessage represents a single chat message sent by a user inside a lobby.
type ChatMessage struct {
	Sender  UserProfile `json:"sender"`
	Message string      `json:"message"`
	Date    int64       `json:"date"`
}
