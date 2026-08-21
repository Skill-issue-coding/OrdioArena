package session

// This file defines all WebSocket payload structs used by the session package.
// Payloads are always nested inside an events.Event envelope on the wire.
//
// Naming convention:
//   - Structs ending in "Payload" are client → server (inbound).
//   - Structs ending in "Payload" prefixed with a server concept are server → client (outbound).

// Server → Client -------------------------------------------------------

// SyncStatePayload is the payload for the sync_gamestate event. It is sent to
// every client in a lobby whenever shared state changes.
type SyncStatePayload struct {
	// GameState is the complete shared lobby state at the time of the sync.
	GameState LobbyState `json:"lobbystate"`

	// Message is an optional human-readable confirmation shown as a toast on the
	// frontend (e.g., "Du gick med i spelet!"). It is omitted from JSON when empty.
	Message string `json:"message,omitempty"`
}

// ConnectedToHubPayload is the payload for the connected_to_hub event, sent
// once to a client immediately after they connect.
type ConnectedToHubPayload struct {
	User UserProfile `json:"user"`

	// Token is a fresh session token, reissued on every successful connect
	// (sliding expiry). The client stores it and replays it as the resume
	// handshake's token on its next connection.
	Token string `json:"token"`

	// Resumed is true when Token's id matched an existing session rather than
	// being freshly minted. The client uses this to skip the "Välkommen"
	// toast and show "Återansluten" instead.
	Resumed bool `json:"resumed"`

	LobbyCode *string `json:"lobby_code"` // nil -> JSON null, not omitted
}

// Client → Server -------------------------------------------------------

// JoinLobbyPayload is the payload for the join_lobby event.
type JoinLobbyPayload struct {
	// LobbyCode is the room code the player wants to join (e.g., "AbCd-1234").
	LobbyCode string `json:"lobby_code"`
}

// UpdateUserPayload is the payload for the update_user event. All fields are
// optional, only non-empty values are applied to the player's profile.
type UpdateUserPayload struct {
	// Username is the new display name. It is ignored if empty or whitespace-only.
	Username string `json:"username,omitempty"`

	// Background is the new background color hex string. It is ignored if empty.
	Background string `json:"background,omitempty"`
}

// ChatMessageRequestPayload is the payload sent by the client to broadcast a chat message.
type ChatMessageRequestPayload struct {
	Message string `json:"message"`
}

// ChangeModePayload is the payload sent by the client when requesting a game mode change.
type ChangeModePayload struct {
	Mode GameMode `json:"mode"`
}

// UpdateSettingPayload carries a single key/value pair for updating lobby settings.
// Value is stored as float64 because all current settings are numbers.
type UpdateSettingPayload struct {
	Key   GameSetting `json:"key"`
	Value float64     `json:"value"`
}

// ResumeRequestPayload is the payload sent by the client when it has been disconnected
// and wants to reconnect to the lobby/game that it was disconnected from.
type ResumeRequestPayload struct {
	Token string `json:"token"`
}
