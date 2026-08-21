// Package events defines the WebSocket event protocol between the Go server
// and the Next.js client. All messages are JSON objects with a "type" string
// and a "payload" object.
//
// Direction conventions:
//   - Server → Client: events the backend emits (ConnectedEvent, SyncGameStateEvent, …)
//   - Client → Server: events the frontend sends (CreateLobbyRequestEvent, JoinLobbyRequestEvent, …)
package events

import "encoding/json"

// EventType is the discriminator field used to route incoming and outgoing
// WebSocket messages. Values are stable strings shared between Go and TypeScript.
type EventType string

// Server → Client event types.
const (
	// ConnectedEvent is sent once immediately after a client connects to the hub.
	// Payload: ConnectedToHubPayload, contains the server-generated user profile.
	ConnectedEvent EventType = "connected_to_hub"

	// JoinedLobbyEvent is sent to the joining client after they are registered
	// into a lobby. The frontend uses this to navigate to the lobby view.
	// Payload: nil
	JoinedLobbyEvent EventType = "joined_lobby"

	// SyncGameStateEvent is the primary state-sync event. It is broadcast to all
	// lobby clients whenever any shared state changes (player joined/left, profile
	// updated, settings changed, phase changed).
	// Payload: SyncStatePayload
	SyncGameStateEvent EventType = "sync_gamestate"

	// ErrorEvent delivers a human-readable Swedish error message to the client.
	// Payload: { "message": string }
	ErrorEvent EventType = "error"

	// SuccessEvent delivers a human-readable Swedish success message to the client.
	// Payload: { "message": string }
	SuccessEvent EventType = "success"

	// SendChatMessageEvent is broadcasted to clients when a valid chat message is received.
	// Payload: ChatMessage
	SendChatMessageEvent EventType = "chat_message"

	// LeftLobbyEvent is sent to the client confirming they have successfully left the lobby.
	// Payload: nil
	LeftLobbyEvent EventType = "left_lobby"

	// JoinLobbyErrorEvent is sent when the user is trying to join a lobby but an error occurs
	// not allowing the user to join
	JoinLobbyErrorEvent EventType = "join_error"

	// GameStartedEvent is sent when the server has started the game
	// Payload: nil
	GameStartedEvent EventType = "game_started"

	// SessionReplacedEvent is sent when the same token is used twice, dropping the old connection
	// Payload: nil
	SessionReplacedEvent EventType = "session_replaced"
)

// Client → Server event types.
const (
	// CreateLobbyRequestEvent requests creation of a new lobby. The client is
	// automatically registered as the host.
	// Payload: nil.
	CreateLobbyRequestEvent EventType = "create_lobby"

	// JoinLobbyRequestEvent requests joining an existing lobby using a room code.
	// Payload: JoinLobbyPayload.
	JoinLobbyRequestEvent EventType = "join_lobby"

	// UpdateUserRequestEvent requests a profile update (username and/or background).
	// The server mutates the client's shared UserProfile pointer and triggers
	// a SyncGameStateEvent broadcast to the lobby.
	// Payload: UpdateUserPayload.
	UpdateUserRequestEvent EventType = "update_user"

	// ChatMessageRequestEvent is sent to the server to broadcast a message to the lobby.
	// Payload: ChatMessageRequestPayload
	ChatMessageRequestEvent EventType = "send_chatmessage"

	// LeaveLobbyRequestEvent is sent when a client explicitly requests to leave their current lobby.
	// Payload: nil
	LeaveLobbyRequestEvent EventType = "leave_lobby"

	// ChangeModeRequestEvent is received when a user wants to change the game mode.
	// This event is only processed if the requesting user is the host of the lobby.
	// Payload: ChangeModePayload
	ChangeModeRequestEvent EventType = "change_mode"

	// UpdateSettingsRequestEvent is received when a user wants to update the lobby settings.
	// This event is only processed if the requesting user is the host of the lobby.
	// Payload: UpdateSettingPayload
	UpdateSettingsRequestEvent EventType = "update_setting"

	// StartGameRequestEvent is received when a client wants to start the game.
	// Payload: nil
	StartGameRequestEvent EventType = "start_game"

	// SyncRequestEvent asks the server to broadcast the latest lobby state.
	// Payload: nil
	SyncRequestEvent EventType = "sync_request"

	// ResumeRequestEvent is recieved when a client has been disconnected and wants to reconnect
	// Payload:
	ResumeRequestEvent EventType = "resume"
)

// Event is the wire envelope for all WebSocket messages. Both directions use
// this structure: a type discriminator and a raw JSON payload that is decoded
// separately based on the type.
type Event struct {
	Type    EventType       `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// ParseEvent decodes a raw WebSocket message into an Event envelope.
// The Payload field is left as raw JSON for subsequent typed decoding
// via DecodePayload.
func ParseEvent(message []byte) (Event, error) {
	var event Event
	err := json.Unmarshal(message, &event)
	return event, err
}

// DecodePayload decodes the raw JSON payload of an event into the requested
// concrete type T. It should be used after ParseEvent when the event type is known.
//
// Example:
//
//	payload, err := events.DecodePayload[JoinLobbyPayload](event)
func DecodePayload[T any](event Event) (T, error) {
	var out T
	err := json.Unmarshal(event.Payload, &out)
	return out, err
}

// EncodeEvent serialises the given payload and wraps it in an Event envelope
// with the specified type. It returns the final JSON bytes or an error.
func EncodeEvent(eventType EventType, payload any) ([]byte, error) {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return json.Marshal(Event{Type: eventType, Payload: payloadBytes})
}

// PrepareEvent is a convenience wrapper around EncodeEvent that returns the
// JSON-encoded event bytes ready to be written directly to a WebSocket connection.
func PrepareEvent(eventType EventType, payload any) ([]byte, error) {
	return EncodeEvent(eventType, payload)
}
