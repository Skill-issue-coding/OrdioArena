package session

import (
	"log"
	"server/events"
	"server/game"
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

// NewLobby creates and returns a new GameLobby with the given room code.
// All channels are initialised and the mode is set to ModeImpostor with
// default settings. The caller is responsible for starting the lobby.Run() goroutine.
func NewLobby(id string) *GameLobby {
	lobby := &GameLobby{
		ID:                    id,
		Clients:               make(map[*Client]bool),
		Register:              make(chan *Client),
		Unregister:            make(chan *Client),
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

			// Mutate Users and Host here — lobby.Run is the only writer of
			// lobby state, so this is safe without additional locking.
			lobby.Users[client.UserId] = client.Profile
			if lobby.Host == (uuid.UUID{}) {
				lobby.Host = client.UserId
			}

			lobby.Clients[client] = true
			client.Lobby = lobby

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
			log.Printf("[Room %s] Player '%s' joined. Players in room: %d", lobby.ID, client.Username(), len(lobby.Clients))

		case client := <-lobby.Unregister:
			if _, exists := lobby.Clients[client]; !exists {
				continue
			}

			delete(lobby.Clients, client)
			delete(lobby.Users, client.UserId)

			if lobby.Phase == GameStarted && lobby.CurrentGame != nil {
				lobby.CurrentGame.PlayerLeft(client.UserId)
			}

			log.Printf("[Room %s] Player '%s' left. Players remaining: %d", lobby.ID, client.Username(), len(lobby.Clients))

			client.SendEvent(events.LeftLobbyEvent, nil)

			// If the lobby is now empty, shut it down.
			if len(lobby.Clients) == 0 {
				log.Printf("[Room %s] Room is empty, closing.", lobby.ID)
				if lobby.CurrentGame != nil {
					lobby.CurrentGame.Stop()
				}
				if client.Hub != nil {
					client.Hub.DeleteRoom(lobby.ID)
				}
				return
			}

			// If the host left, promote an arbitrary remaining player.
			if lobby.Host == client.UserId {
				for remaining := range lobby.Clients {
					lobby.Host = remaining.UserId
					break
				}
			}

			lobby.SyncStateToAllClients()

		case client := <-lobby.SyncRequest:
			lobby.SyncStateToClient(client)

		case <-lobby.ProfileUpdateRequests:
			lobby.SyncStateToAllClients()

		case mode := <-lobby.ModeUpdateRequests:
			lobby.SetMode(mode)
			lobby.SyncStateToAllClients()

		case update := <-lobby.SettingUpdateRequests:
			lobby.ApplySetting(update.Key, update.Value)
			lobby.SyncStateToAllClients()

		case message := <-lobby.ChatMessages:
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
			go lobby.CurrentGame.Run()

		case input := <-lobby.GameInputs:
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
