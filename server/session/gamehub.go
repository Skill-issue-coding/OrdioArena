package session

import (
	"server/events"
	"server/logging"
	"server/util"
	"server/words"
	"time"
)

// NewGameHub initialises and returns a GameHub with a loaded word dictionary.
// It returns an error if the dictionary files cannot be read or parsed.
// The hub's Run goroutine must be started separately by the caller.
func NewGameHub() (*GameHub, error) {
	dict, err := words.InitializeDictionary()
	if err != nil {
		return nil, err
	}

	return &GameHub{
		Dictionary: dict,
		Clients:    make(map[*Client]bool),
		Lobbies:    make(map[string]*GameLobby),
		Broadcast:  make(chan []byte),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
	}, nil
}

// Run is the hub's main event loop and must be started in its own goroutine.
// It is the single owner of the Clients map, so all mutations to it happen
// here without additional locking.
func (hub *GameHub) Run() {
	statusTicker := time.NewTicker(30 * time.Second)
	defer statusTicker.Stop()

	for {
		select {

		case client := <-hub.Register:
			hub.Clients[client] = true

			// Immediately inform the client of their server-assigned identity.
			client.SendEvent(events.ConnectedEvent, ConnectedToHubPayload{
				User: UserProfile{
					UserId:     client.UserId,
					Username:   client.Username(),
					Background: client.Background(),
				},
			})

			hub.LobbiesMutex.RLock()
			openRooms, inRooms := len(hub.Lobbies), hub.totalPlayers()
			hub.LobbiesMutex.RUnlock()
			logging.Hub.Info("client connected",
				"id", client.UserId, "connected", len(hub.Clients), "rooms_open", openRooms, "players_in_rooms", inRooms)

		case client := <-hub.Unregister:
			if client.Lobby != nil {
				room := client.Lobby
				client.Lobby = nil
				// Forward to the lobby's unregister channel in a goroutine
				// to avoid a deadlock between the hub and lobby event loops.
				go func() { room.Unregister <- client }()
			}

			if _, ok := hub.Clients[client]; ok {
				delete(hub.Clients, client)
				close(client.Send) // signals WritePump to exit

				hub.LobbiesMutex.RLock()
				openRooms, inRooms := len(hub.Lobbies), hub.totalPlayers()
				hub.LobbiesMutex.RUnlock()
				logging.Hub.Info("client disconnected",
					"id", client.UserId, "connected", len(hub.Clients), "rooms_open", openRooms, "players_in_rooms", inRooms)
			}

		case message := <-hub.Broadcast:
			for client := range hub.Clients {
				select {
				case client.Send <- message:
				default:
					// Send buffer is full, treat as a dead connection.
					close(client.Send)
					delete(hub.Clients, client)
				}
			}

		case <-statusTicker.C:
			hub.LobbiesMutex.RLock()
			openRooms, inRooms := len(hub.Lobbies), hub.totalPlayers()
			hub.LobbiesMutex.RUnlock()
			logging.Hub.Info("status",
				"rooms_open", openRooms, "players_in_rooms", inRooms, "connected_clients", len(hub.Clients))
		}
	}
}

// totalPlayers returns the total number of players across all active lobbies.
// It must only be called from within the Run goroutine (or while holding
// LobbiesMutex) as it reads the Lobbies map.
func (hub *GameHub) totalPlayers() int {
	total := 0
	for _, room := range hub.Lobbies {
		total += len(room.Clients)
	}
	return total
}

// CreateUniqueRoom generates a collision-free room code, creates a new lobby,
// starts its Run goroutine, registers it in the hub, and returns the code.
// It is safe to call from any goroutine.
func (hub *GameHub) CreateUniqueRoom() string {
	hub.LobbiesMutex.Lock()
	defer hub.LobbiesMutex.Unlock()

	var code string
	for {
		code = util.GenerateGameCode()
		if _, exists := hub.Lobbies[code]; !exists {
			newRoom := NewLobby(code)
			hub.Lobbies[code] = newRoom
			go newRoom.Run()
			logging.Hub.Info("room created", "code", code, "rooms_open", len(hub.Lobbies))
			break
		}
	}
	return code
}

// GetRoom returns the GameLobby for the given room code, or nil if no such
// lobby exists. It is safe to call from any goroutine.
func (hub *GameHub) GetRoom(code string) *GameLobby {
	hub.LobbiesMutex.RLock()
	defer hub.LobbiesMutex.RUnlock()
	return hub.Lobbies[code]
}

// DeleteRoom removes the lobby with the given code from the hub. It is
// typically called by the lobby's own Run goroutine when the last player
// leaves. It is safe to call from any goroutine.
func (hub *GameHub) DeleteRoom(code string) {
	hub.LobbiesMutex.Lock()
	defer hub.LobbiesMutex.Unlock()
	delete(hub.Lobbies, code)
	logging.Hub.Info("room deleted",
		"code", code, "rooms_open", len(hub.Lobbies), "players_in_rooms", hub.totalPlayers())
}
