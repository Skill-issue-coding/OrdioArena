package session

import (
	"server/logging"
	"server/token"
	"server/util"
	"server/words"
	"time"

	"github.com/google/uuid"
)

// NewGameHub initialises and returns a GameHub with a loaded word dictionary.
// It returns an error if the dictionary files cannot be read or parsed.
// The hub's Run goroutine must be started separately by the caller.
func NewGameHub() (*GameHub, error) {
	dict, err := words.InitializeDictionary()
	if err != nil {
		return nil, err
	}

	secret, err := token.LoadSessionSecret()
	if err != nil {
		return nil, err
	}

	return &GameHub{
		Dictionary: dict,
		Clients:    make(map[*Client]bool),
		Lobbies:    make(map[string]*GameLobby),
		Secret:     secret,
		Sessions:   make(map[uuid.UUID]*SessionEntry),
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
				go func() {
					room.Unregister <- LeaveRequest{Client: client, Reason: ReasonDisconnect}
				}()
			}

			if _, ok := hub.Clients[client]; ok {
				delete(hub.Clients, client)
				close(client.Send) // signals WritePump to exit

				// Release the identity so sweepSessions can eventually expire
				// it. The guard inside makes this safe against the duplicate
				// unregister both pumps send, and against a displaced tab
				// whose unregister lands after the new one took ownership.
				hub.ClearSessionClient(client.UserId, client)

				hub.LobbiesMutex.RLock()
				openRooms, inRooms := len(hub.Lobbies), hub.totalPlayers()
				hub.LobbiesMutex.RUnlock()
				logging.Hub.Info("client disconnected",
					"id", client.UserId, "connected", len(hub.Clients), "rooms_open", openRooms, "players_in_rooms", inRooms)
			}

		case <-statusTicker.C:
			hub.sweepSessions(time.Now())

			hub.LobbiesMutex.RLock()
			openRooms, inRooms := len(hub.Lobbies), hub.totalPlayers()
			hub.LobbiesMutex.RUnlock()
			logging.Hub.Info("status",
				"rooms_open", openRooms, "players_in_rooms", inRooms, "connected_clients", len(hub.Clients))
		}
	}
}

// totalPlayers returns the total number of players across all active lobbies.
//
// It iterates the Lobbies map, so it must only be called while holding
// LobbiesMutex (in either mode). It reads each lobby's count through
// PlayerCount rather than len(room.Clients): that map belongs to the lobby's
// own Run goroutine, and LobbiesMutex says nothing about it.
//
// The count is a snapshot, and a lobby may gain or lose a player between two
// iterations of the loop. Every caller is a log line, so that is fine; do not
// build a decision on this number.
func (hub *GameHub) totalPlayers() int {
	total := 0
	for _, room := range hub.Lobbies {
		total += room.PlayerCount()
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

// LookupSession returns a copy of id's registry entry. Safe from any goroutine.
//
// The return is a value, not the stored *SessionEntry, and that copy is
// load-bearing: resolveIdentity hands &entry.Profile to the new Client, so
// returning the pointer would alias every client onto one shared UserProfile
// and reintroduce the rename-aliasing bug the registry exists to remove.
func (hub *GameHub) LookupSession(id uuid.UUID) (SessionEntry, bool) {
	hub.SessionsMutex.RLock()
	defer hub.SessionsMutex.RUnlock()

	entry, ok := hub.Sessions[id]
	if !ok {
		return SessionEntry{}, false
	}
	return *entry, true
}

// TouchSession records id's identity and hands the session to client, returning
// whichever client previously held it, or nil. Single-connection policy: one
// live socket per identity, newest wins.
//
// The caller closes the displaced client. Doing it here would mean holding
// SessionsMutex across a channel send into hub.Run.
func (hub *GameHub) TouchSession(id uuid.UUID, client *Client, profile UserProfile, lobbyCode string) (displaced *Client) {
	hub.SessionsMutex.Lock()
	defer hub.SessionsMutex.Unlock()

	entry, ok := hub.Sessions[id]
	if !ok {
		// A fresh entry has a nil Client, so the guard below yields no
		// displacement without needing a special case for it.
		entry = &SessionEntry{}
		hub.Sessions[id] = entry
	}

	// Capture the previous owner BEFORE overwriting, and never report the
	// caller as its own displaced predecessor: hub.Run would then unregister
	// the socket that just won the identity.
	if entry.Client != client {
		displaced = entry.Client
	}

	entry.Client = client
	entry.Profile = profile
	entry.LobbyCode = lobbyCode
	entry.LastSeen = time.Now()

	return displaced
}

// SetSessionLobby records where id's seat is, or clears it with "". It is the
// lobby's half of the registry: GameLobby.Run is the only caller, just as
// hub.Run is the only caller of TouchSession and ClearSessionClient. Keeping
// one writer per field is what stops the two goroutines from fighting over an
// entry neither of them owns outright.
//
// This is what puts a code in connected_to_hub's lobby_code, so a reconnecting
// socket can be told where it was before it has joined anything, including from
// a reopened tab with no URL context at all.
//
// An unknown id is a no-op rather than an insert: a player with no session
// entry has nothing to return to, and inventing one here would resurrect an
// identity the sweep deliberately dropped.
func (hub *GameHub) SetSessionLobby(id uuid.UUID, lobbyCode string) {
	hub.SessionsMutex.Lock()
	defer hub.SessionsMutex.Unlock()

	entry, ok := hub.Sessions[id]
	if !ok {
		return
	}

	entry.LobbyCode = lobbyCode
	entry.LastSeen = time.Now()
}

// ClearSessionClient releases id's ownership, but only if client still holds
// it. Called from hub.Run's Unregister case. The identity check is what stops
// a displaced tab's late unregister from clearing the new tab's ownership.
func (hub *GameHub) ClearSessionClient(id uuid.UUID, client *Client) {
	hub.SessionsMutex.Lock()
	defer hub.SessionsMutex.Unlock()

	entry, ok := hub.Sessions[id]
	// The identity check is the whole point: a displaced tab's unregister
	// arrives after the new tab has taken ownership, and must not clear it.
	if !ok || entry.Client != client {
		return
	}

	entry.Client = nil
	// Restart the sweep clock at disconnect, not at connect. LastSeen is
	// otherwise never refreshed while a socket is live, and a long session
	// would look abandoned.
	entry.LastSeen = time.Now()
}

// sweepSessions drops registry entries nobody is coming back for. Called from
// hub.Run's ticker; now is a parameter so the expiry boundary is testable.
//
// An entry is kept while anything still depends on it: a live socket owns it,
// or it names a lobby the player can still be returned to. Only an entry that
// is both unowned and lobby-less ages out, after SESSION_TOKEN_TTL, at which
// point its token could not be honoured anyway.
//
// Without this, the WS handshake creates one entry per visitor who ever opens
// the site, and Sessions grows without bound for anyone who can open a socket.
func (hub *GameHub) sweepSessions(now time.Time) {
	hub.SessionsMutex.Lock()
	defer hub.SessionsMutex.Unlock()
	for id, entry := range hub.Sessions {
		if entry.Client != nil || entry.LobbyCode != "" {
			continue
		}
		if now.Sub(entry.LastSeen) < token.SESSION_TOKEN_TTL {
			continue
		}
		delete(hub.Sessions, id) // deleting during range is defined behaviour
		logging.Hub.Debug("session entry expired", "id", id)
	}
}
