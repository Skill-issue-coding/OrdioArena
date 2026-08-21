package session

import (
	"server/events"
	"server/game"
	"server/logging"
	"server/util"

	"github.com/google/uuid"
)

type GameSetting string

const (
	MAXIMUM_LOBBY_SIZE            int = 12
	MIN_NUM_PLAYERS_TO_START_GAME int = 3

	INPUT_DURATION      GameSetting = "input_duration"
	DISCUSSION_DURATION GameSetting = "discussion_duration"
	IMPOSTOR_COUNT      GameSetting = "impostor_count"
	VOTE_DURATION       GameSetting = "vote_duration"
	ROUND_DURATION      GameSetting = "round_duration"
	NUMBER_OF_ROUNDS    GameSetting = "rounds"
	WORD_TYPE           GameSetting = "word_type"
	MAX_DISTANCE        GameSetting = "max_distance"
)

// LeaveReason distinguishes the ways a client stops being in a lobby. The
// lobby cannot infer it: an explicit leave and a dropped socket both arrive as
// a *Client on the same path today, and they must not be handled the same way.
type LeaveReason uint8

const (
	// ReasonLeave is the player pressing leave. Immediate and final: an
	// explicit departure must not linger for the grace period.
	ReasonLeave LeaveReason = iota

	// ReasonDisconnect is the socket dying, forwarded by hub.Run. The seat is
	// held, not destroyed, until the grace timer says otherwise.
	ReasonDisconnect
)

// String makes the reason readable in logs, which are otherwise handed a bare
// uint8.
func (r LeaveReason) String() string {
	switch r {
	case ReasonLeave:
		return "leave"
	case ReasonDisconnect:
		return "disconnect"
	}
	return "unknown"
}

// LeaveRequest is what GameLobby.Unregister carries. The reason travels with
// the client because only the sender knows it: client.go knows the player
// pressed leave, hub.Run knows the socket died, and by the time the lobby
// goroutine sees either one both look identical.
type LeaveRequest struct {
	Client *Client
	Reason LeaveReason
}

// NewLobby creates and returns a new GameLobby with the given room code.
// All channels are initialised and the mode is set to ModeImpostor with
// default settings. The caller is responsible for starting the lobby.Run() goroutine.
func NewLobby(id string) *GameLobby {
	lobby := &GameLobby{
		ID:                    id,
		Clients:               make(map[*Client]bool),
		Register:              make(chan *Client),
		Unregister:            make(chan LeaveRequest),
		ModeUpdateRequests:    make(chan GameMode),
		SettingUpdateRequests: make(chan UpdateSettingPayload),
		ChatMessages:          make(chan ChatMessage),
		SyncRequest:           make(chan *Client),
		ProfileUpdateRequests: make(chan struct{}, 8),
		Phase:                 LobbyPhase,
		Users:                 make(map[uuid.UUID]*UserProfile),
		// Game Related channels
		StartGameRequests: make(chan *Client),
		GameInputs:        make(chan game.GameInput, 16),
		GameOutputs:       make(chan game.GameOutput, 32),
		GameDone:          make(chan struct{}, 1),
	}
	lobby.SetMode(ModeImpostor)
	return lobby
}

// PlayerCount returns how many clients are connected to this lobby. It is the
// only safe way to ask that question from outside the lobby's Run goroutine:
// Clients is owned by Run, so len(lobby.Clients) from anywhere else is a
// concurrent map read against Run's writes.
//
// The value is a snapshot taken without any lock, so it may be stale the
// instant it is returned. That is sufficient for logging and metrics, and not
// sufficient for anything that gates behaviour, capacity checks included.
func (lobby *GameLobby) PlayerCount() int {
	return int(lobby.playerCount.Load())
}

// Run is the lobby's main event loop. It must be started in its own goroutine
// and is the only place where lobby state is mutated, making all field access
// implicitly single-threaded and safe without additional locking.
func (lobby *GameLobby) Run() {
	for {
		select {

		case client := <-lobby.Register:
			if len(lobby.Users) >= MAXIMUM_LOBBY_SIZE {
				client.SendError("Lobbyn är full")
				continue
			}

			if lobby.Phase == GameStarted {
				client.SendError("Spelet har redan börjat, kan inte ansluta")
				client.SendEvent(events.JoinLobbyErrorEvent, nil)
				continue
			}

			// Mutate Users and Host here, lobby.Run is the only writer of
			// lobby state, so this is safe without additional locking.
			lobby.Users[client.UserId] = client.Profile
			if lobby.Host == (uuid.UUID{}) {
				lobby.Host = client.UserId
			}

			lobby.Clients[client] = true
			lobby.playerCount.Store(int64(len(lobby.Clients)))
			client.Lobby = lobby

			// Tell the registry where this seat lives, so the next socket that
			// resumes this identity is handed the code in connected_to_hub
			// rather than having to know it from its URL.
			if client.Hub != nil {
				client.Hub.SetSessionLobby(client.UserId, lobby.ID)
			}

			state := lobby.BuildLobbyState()
			for c := range lobby.Clients {
				if _, exists := lobby.Users[c.UserId]; !exists {
					continue
				}

				if c == client {
					c.SendEvent(events.SyncGameStateEvent, SyncStatePayload{
						GameState: state,
						Message:   "Du gick med i spelet!",
					})
				} else {
					c.SendEvent(events.SyncGameStateEvent, SyncStatePayload{
						GameState: state,
					})
				}
			}

			client.SendEvent(events.JoinedLobbyEvent, nil)
			logging.Lobby.Info("player joined",
				"room", lobby.ID, "user", client.Username(), "id", client.UserId, "players", len(lobby.Clients), "host", lobby.Host == client.UserId)

		case req := <-lobby.Unregister:
			client := req.Client
			if _, exists := lobby.Clients[client]; !exists {
				// A socket this lobby does not hold. Both of a client's pumps
				// send an unregister on the way out, so the second one always
				// lands here.
				continue
			}

			delete(lobby.Clients, client)
			lobby.playerCount.Store(int64(len(lobby.Clients)))

			// Does this identity still have a live socket in the lobby?
			//
			// A replaced tab is unregistered after its successor has already
			// joined, and both carry the same UserId. Removing the roster entry
			// unconditionally would therefore evict the player who is sitting
			// there playing, on the strength of a socket that is already dead.
			// The Clients guard above does not cover this: it keys on the
			// connection, and the roster keys on the identity.
			//
			// This is the interim form of the seat model's `seat.Client !=
			// client` check, expressed against the maps that exist today.
			stillSeated := false
			for c := range lobby.Clients {
				if c.UserId == client.UserId {
					stillSeated = true
					break
				}
			}

			if !stillSeated {
				delete(lobby.Users, client.UserId)

				// The seat is gone, so the registry must stop naming this
				// lobby: a code the player is no longer in would send their
				// next socket back to a room that has forgotten them.
				//
				// This moves when the grace period lands. A disconnect will
				// then have to KEEP the code, which is the entire point of the
				// grace window, and only a hard removal (an explicit leave or a
				// grace expiry) will clear it.
				if client.Hub != nil {
					client.Hub.SetSessionLobby(client.UserId, "")
				}

				if lobby.Phase == GameStarted && lobby.CurrentGame != nil {
					lobby.CurrentGame.PlayerLeft(client.UserId)
				}
			}

			logging.Lobby.Info("player left", "room", lobby.ID, "user", client.Username(), "id", client.UserId,
				"reason", req.Reason.String(), "still_seated", stillSeated, "players", len(lobby.Clients))

			// Only an explicit leave gets a confirmation. On a disconnect the
			// socket is already gone and the event would be dropped anyway.
			if req.Reason == ReasonLeave {
				client.SendEvent(events.LeftLobbyEvent, nil)
			}

			// If the lobby is now empty, shut it down.
			if len(lobby.Clients) == 0 {
				logging.Lobby.Info("room empty, closing", "room", lobby.ID)
				if lobby.CurrentGame != nil {
					lobby.CurrentGame.Stop()
				}
				if client.Hub != nil {
					client.Hub.DeleteRoom(lobby.ID)
				}
				return
			}

			// If the host left, promote an arbitrary remaining player. A host
			// whose identity is still seated has not left at all.
			if !stillSeated && lobby.Host == client.UserId {
				for remaining := range lobby.Clients {
					lobby.Host = remaining.UserId
					logging.Lobby.Info("host promoted", "room", lobby.ID, "new_host", remaining.UserId, "user", remaining.Username())
					break
				}
			}

			lobby.SyncStateToAllClients()

		case client := <-lobby.SyncRequest:
			logging.Lobby.Debug("sync requested", "room", lobby.ID, "id", client.UserId)
			lobby.SyncStateToClient(client)

		case <-lobby.ProfileUpdateRequests:
			lobby.SyncStateToAllClients()

		case mode := <-lobby.ModeUpdateRequests:
			logging.Lobby.Info("mode changed", "room", lobby.ID, "mode", string(mode))
			lobby.SetMode(mode)
			lobby.SyncStateToAllClients()

		case update := <-lobby.SettingUpdateRequests:
			logging.Lobby.Info("setting changed", "room", lobby.ID, "key", update.Key, "value", update.Value)
			lobby.ApplySetting(update.Key, update.Value)
			lobby.SyncStateToAllClients()

		case message := <-lobby.ChatMessages:
			logging.Lobby.Debug("chat", "room", lobby.ID, "user", message.Sender.Username, "message", message.Message)
			for client := range lobby.Clients {
				client.SendEvent(events.SendChatMessageEvent, message)
			}

		case client := <-lobby.StartGameRequests:
			if client.UserId != lobby.Host {
				client.SendError("Endast hosten kan starta spelet.")
				continue
			}

			if lobby.Phase == GameStarted {
				client.SendError("Spelet har redan startat.")
				continue
			}

			if len(lobby.Users) < MIN_NUM_PLAYERS_TO_START_GAME {
				client.SendError("Inte tillräckligt med spelare för att starta spelet.")
				continue
			}

			players := make([]uuid.UUID, 0, len(lobby.Users))
			for id := range lobby.Users {
				players = append(players, id)
			}

			onDone := func() {
				select {
				case lobby.GameDone <- struct{}{}:
				default:
				}
			}

			switch lobby.Mode {
			case ModeImpostor:
				lobby.CurrentGame = game.NewImpostorGame(lobby.ImpostorSettings, players, &client.Hub.Dictionary, lobby.GameOutputs, onDone)
			case ModeAntiMatch:
				lobby.CurrentGame = game.NewAntimatchGame(lobby.AntiMatchSettings, &client.Hub.Dictionary, lobby.GameOutputs, players, onDone)
			}

			if lobby.CurrentGame == nil {
				client.SendError("Spelläget stöds inte än.")
				continue
			}

			lobby.Phase = GameStarted
			lobby.SyncStateToAllClients()
			for c := range lobby.Clients {
				c.SendEvent(events.GameStartedEvent, nil)
			}
			logging.Lobby.Info("game started", "room", lobby.ID, "mode", string(lobby.Mode), "players", len(players))
			logging.Game.Info("game started", "room", lobby.ID, "mode", string(lobby.Mode), "players", players)
			go lobby.CurrentGame.Run()

		case input := <-lobby.GameInputs:
			logging.Game.Debug("input received",
				"room", lobby.ID, "id", input.ClientId, "event", string(input.Event.Type), "payload", string(input.Event.Payload))
			if lobby.CurrentGame != nil {
				lobby.CurrentGame.HandleInput(input)
			}

		case out := <-lobby.GameOutputs:
			if out.Target == nil {
				for c := range lobby.Clients {
					c.SendEvent(out.Type, out.Payload)
				}
			} else {
				for c := range lobby.Clients {
					if c.UserId == *out.Target {
						c.SendEvent(out.Type, out.Payload)
						break
					}
				}
			}

		case <-lobby.GameDone:
			// Drain any buffered game outputs (e.g. game_result) before resetting
			// the lobby phase. The game goroutine runs: broadcastGameResult →
			// Stop → onDone, so game_result is guaranteed to be in GameOutputs
			// by the time GameDone is readable. Without draining first, a Go
			// select non-deterministically picks GameDone before GameOutputs,
			// causing sync_gamestate(lobby) to reach clients before game_result,
			// which races the context reset and leaves the result page blank.
			for len(lobby.GameOutputs) > 0 {
				out := <-lobby.GameOutputs
				if out.Target == nil {
					for c := range lobby.Clients {
						c.SendEvent(out.Type, out.Payload)
					}
				} else {
					for c := range lobby.Clients {
						if c.UserId == *out.Target {
							c.SendEvent(out.Type, out.Payload)
							break
						}
					}
				}
			}
			lobby.CurrentGame = nil
			lobby.Phase = LobbyPhase
			logging.Game.Info("game ended", "room", lobby.ID)
			logging.Lobby.Info("game ended, back to lobby", "room", lobby.ID)
		}
	}
}

// SyncStateToAllClients broadcasts the current LobbyState to every client in the
// lobby. It should only be called from within the lobby's Run goroutine.
func (lobby *GameLobby) SyncStateToAllClients() {
	state := lobby.BuildLobbyState()
	for client := range lobby.Clients {
		if _, exists := lobby.Users[client.UserId]; !exists {
			continue
		}
		client.SendEvent(events.SyncGameStateEvent, SyncStatePayload{
			GameState: state,
		})
	}
}

// SyncStateToClient broadcasts the current LobbyState to a single client.
func (lobby *GameLobby) SyncStateToClient(client *Client) {
	state := lobby.BuildLobbyState()
	client.SendEvent(events.SyncGameStateEvent, SyncStatePayload{GameState: state})
}

// BuildLobbyState assembles a point-in-time snapshot of the lobby's shared
// state, ready to be serialised and sent to clients.
func (lobby *GameLobby) BuildLobbyState() LobbyState {
	state := LobbyState{
		Code:     lobby.ID,
		Mode:     lobby.Mode,
		Phase:    lobby.Phase,
		Host:     lobby.Host,
		Users:    lobby.Users,
		Settings: lobby.ModeSettings(),
	}

	return state
}

// ModeSettings returns the settings struct for the currently active game mode.
func (lobby *GameLobby) ModeSettings() any {
	switch lobby.Mode {
	case ModeImpostor:
		return lobby.ImpostorSettings
	case ModeContextoBattle:
		return lobby.ContextoBattleSettings
	case ModeSynonymDuel:
		return lobby.SynonymDuelSettings
	case ModeAntiMatch:
		return lobby.AntiMatchSettings
	default:
		return nil
	}
}

// SetMode switches the lobby to the given game mode and resets its settings
// to the mode's defaults.
func (lobby *GameLobby) SetMode(mode GameMode) {
	lobby.Mode = mode
	switch mode {
	case ModeImpostor:
		lobby.ImpostorSettings = game.DefaultImpostorSettings()
	case ModeContextoBattle:
		lobby.ContextoBattleSettings = game.DefaultContextoBattleSettings()
	case ModeSynonymDuel:
		lobby.SynonymDuelSettings = game.DefaultSynonymDuelSettings()
	case ModeAntiMatch:
		lobby.AntiMatchSettings = game.DefaultAntiMatchSettings()
	}
}

// ApplySetting updates a specific setting for the currently active game mode
// based on the provided key and value.
func (lobby *GameLobby) ApplySetting(key GameSetting, value float64) {
	switch lobby.Mode {
	case ModeImpostor:
		switch key {
		case INPUT_DURATION:
			lobby.ImpostorSettings.InputDuration = util.ClampInt(value, game.IMPOSTOR_INPUT_DURATION_MIN, game.IMPOSTOR_INPUT_DURATION_MAX)
		case DISCUSSION_DURATION:
			lobby.ImpostorSettings.DiscussionDuration = util.ClampInt(value, game.IMPOSTOR_DISCUSSION_DURATION_MIN, game.IMPOSTOR_DISCUSSION_DURATION_MAX)
		case IMPOSTOR_COUNT:
			lobby.ImpostorSettings.ImpostorCount = util.ClampInt(value, game.IMPOSTOR_COUNT_MIN, game.IMPOSTOR_COUNT_MAX)
		case VOTE_DURATION:
			lobby.ImpostorSettings.VoteDuration = util.ClampInt(value, game.IMPOSTOR_VOTE_DURATION_MIN, game.IMPOSTOR_VOTE_DURATION_MAX)
		}
	case ModeContextoBattle:
		switch key {
		case ROUND_DURATION:
			lobby.ContextoBattleSettings.RoundDuration = util.ClampInt(value, game.CONTEXTO_ROUND_DURATION_MIN, game.CONTEXTO_ROUND_DURATION_MAX)
		case NUMBER_OF_ROUNDS:
			lobby.ContextoBattleSettings.Rounds = util.ClampInt(value, game.CONTEXTO_ROUNDS_MIN, game.CONTEXTO_ROUNDS_MAX)
		case WORD_TYPE:
			lobby.ContextoBattleSettings.WordType = util.ClampInt(value, game.CONTEXTO_WORD_TYPE_MIN, game.CONTEXTO_WORD_TYPE_MAX)
		}
	case ModeSynonymDuel:
		switch key {
		case ROUND_DURATION:
			lobby.SynonymDuelSettings.RoundDuration = util.ClampInt(value, game.SYNONYM_ROUND_DURATION_MIN, game.SYNONYM_ROUND_DURATION_MAX)
		case NUMBER_OF_ROUNDS:
			lobby.SynonymDuelSettings.Rounds = util.ClampInt(value, game.SYNONYM_ROUNDS_MIN, game.SYNONYM_ROUNDS_MAX)
		case WORD_TYPE:
			lobby.SynonymDuelSettings.WordType = util.ClampInt(value, game.SYNONYM_WORD_TYPE_MIN, game.SYNONYM_WORD_TYPE_MAX)
		}
	case ModeAntiMatch:
		switch key {
		case INPUT_DURATION:
			lobby.AntiMatchSettings.InputDuration = util.ClampInt(value, game.ANTIMATCH_ROUND_DURATION_MIN, game.ANTIMATCH_ROUND_DURATION_MAX)
		case NUMBER_OF_ROUNDS:
			lobby.AntiMatchSettings.Rounds = int8(util.ClampInt(value, int(game.ANTIMATCH_ROUNDS_MIN), int(game.ANTIMATCH_ROUNDS_MAX)))
		}

	}
}
