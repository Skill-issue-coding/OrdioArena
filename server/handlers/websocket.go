package handlers

import (
	"errors"
	"net/http"
	"server/events"
	"server/logging"
	"server/session"
	"server/token"
	"server/util"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// identity is the outcome of the resume handshake: who the server decided this
// socket is, and what it should be told about where it was.
type identity struct {
	Id      uuid.UUID
	Profile *session.UserProfile
	// LobbyCode is non-nil only when the hub still holds the lobby the session
	// registry names, so the client is never sent chasing a dead room code.
	LobbyCode *string
	// Resumed is true only when a registry entry was found, not merely when the
	// token's signature checked out. A valid token whose entry was swept keeps
	// its id but is not a resume: the client would otherwise show "Återansluten"
	// over a freshly randomised name.
	Resumed bool
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,

	// TODO: Implement propper checking
	CheckOrigin: func(r *http.Request) bool {
		// For development, allow all origins.
		return true
	},
}

// HandleWebSocket upgrades a /ws/game request and runs the full identity
// handshake before the client is allowed to speak. It runs on Gin's request
// goroutine and returns once ReadPump and WritePump own the connection.
//
// The client must send exactly one resume event within token.RESUME_DEADLINE.
// This is not optional tolerance: gorilla stores read errors on the connection
// permanently, so a missed deadline poisons every later read and ReadPump would
// exit on its first iteration. A client that stays silent is closed here rather
// than registered onto a socket that can never deliver anything.
//
// The token in that event is advisory, never authoritative about anything but
// the id it carries. Missing, malformed, expired or badly signed all resolve
// the same way, a brand-new identity, and none of them reach the user as an
// error: the zero-friction path is the product requirement, so the failure mode
// is always "you are someone new", never "something went wrong". Only the
// signature decides whether a claimed id is honoured, because without it any
// client could assert another player's id and take their seat, host rights or
// role reveal.
//
// connected_to_hub is queued before ReadPump starts, so it is always the first
// frame out and nothing the client sends can overtake it. It carries a freshly
// minted token (sliding expiry) and, when the hub still holds a live seat, the
// lobby code that seat belongs to, which is what lets a reconnect work from a
// reopened tab with no URL context at all.
func HandleWebSocket(c *gin.Context, hub *session.GameHub) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		logging.Hub.Error("upgrade failed", "err", err)
		return
	}

	resumeToken, ok := readResumeHandshake(conn)
	if !ok {
		return
	}

	self := resolveIdentity(hub, resumeToken)
	freshToken := token.MintSessionToken(hub.Secret, self.Id, time.Now())

	client := &session.Client{UserId: self.Id, Profile: self.Profile, Hub: hub, Conn: conn, Send: make(chan []byte, 256)}

	// Register before TouchSession: displacement unregisters the loser, and
	// hub.Run only closes Send for clients it already knows about. Publishing
	// to the session registry first opens a window where a second tab can
	// displace a client the hub has never seen, leaving it alive and orphaned.
	hub.Register <- client
	go client.WritePump()

	if old := hub.TouchSession(self.Id, client, *self.Profile, derefOrEmpty(self.LobbyCode)); old != nil {
		old.SendEvent(events.SessionReplacedEvent, nil)
		// Unregister, not Conn.Close: hub.Run owns Clients and is the only
		// place allowed to close Send. Async so a busy hub cannot stall this
		// handshake. Closing Send does not discard what is already buffered,
		// so WritePump still drains session_replaced before the close frame.
		go func() { hub.Unregister <- old }()
	}

	logging.Hub.Info("handshake complete", "id", self.Id, "resumed", self.Resumed, "lobby", derefOrEmpty(self.LobbyCode))

	// Queued before ReadPump exists, so nothing the client sends can land on
	// Send ahead of connected_to_hub.
	client.SendEvent(events.ConnectedEvent, session.ConnectedToHubPayload{
		User: *self.Profile, Token: freshToken, Resumed: self.Resumed, LobbyCode: self.LobbyCode,
	})

	go client.ReadPump()
}

// readResumeHandshake reads the one message a client must send immediately
// after upgrade. Returns the token (possibly "") and whether the connection
// is still usable.
//
// A read error here is fatal by design. gorilla stores read errors on the
// connection permanently, once the deadline is missed,
// every later ReadMessage returns the same error, so a "tolerated" timeout
// would hand ReadPump a socket that exits on its first iteration. Closing
// here makes that failure honest instead of a client stuck on a live-looking
// socket that never delivers anything.
func readResumeHandshake(conn *websocket.Conn) (string, bool) {
	conn.SetReadLimit(session.SOCKET_READ_LIMIT) // pre-auth frame must be bounded
	conn.SetReadDeadline(time.Now().Add(token.RESUME_DEADLINE))
	defer conn.SetReadDeadline(time.Time{}) // ReadPump re-arms with pongWait

	_, raw, err := conn.ReadMessage()
	if err != nil {
		logging.Hub.Warn("resume handshake failed, closing", "err", err)
		conn.Close()
		return "", false
	}

	ev, err := events.ParseEvent(raw)
	if err != nil {
		logging.Hub.Debug("resume envelope malformed", "err", err)
		return "", true
	}
	if ev.Type != events.ResumeRequestEvent {
		// Frontend contract violation: resume must be the first frame. The one
		// you will actually hit while working on the client.
		logging.Hub.Debug("first message was not resume", "type", string(ev.Type))
		return "", true
	}
	p, err := events.DecodePayload[session.ResumeRequestPayload](ev)
	if err != nil {
		logging.Hub.Debug("resume payload undecodable", "err", err)
		return "", true
	}
	return p.Token, true
}

// resolveIdentity turns a client-supplied resume token into the identity this
// socket will run as. It reads hub.Sessions and hub.Lobbies through their
// mutexes and mutates nothing; the caller commits the result with TouchSession.
func resolveIdentity(hub *session.GameHub, resumeToken string) identity {
	id := uuid.New()
	out := identity{Id: id, Profile: freshProfile(id)}

	if resumeToken == "" {
		return out // first-ever connect
	}

	parsedId, err := token.ParseSessionToken(hub.Secret, resumeToken, time.Now())
	if err != nil {
		switch {
		case errors.Is(err, token.ErrTokenBadSignature):
			// Worth seeing: either the process restarted with an ephemeral
			// secret and every stored token is now junk, or someone is forging.
			logging.Hub.Warn("resume token signature invalid", "err", err)
		default:
			// Expired or malformed. Routine, client-generated, spammable.
			logging.Hub.Debug("resume token rejected", "err", err)
		}
		return out
	}

	// The signature proves we minted this id, so it is this client's to take
	// back even when the registry entry is gone.
	out.Id = parsedId
	out.Profile.UserId = parsedId

	entry, found := hub.LookupSession(parsedId)
	if !found {
		return out
	}

	out.Profile, out.Resumed = &entry.Profile, true
	// The registry outlives the GameLobby it names; a stale code would send the
	// client straight into "Hittade inget rum med den koden."
	if entry.LobbyCode != "" && hub.GetRoom(entry.LobbyCode) != nil {
		out.LobbyCode = &entry.LobbyCode
	}
	return out
}

func freshProfile(id uuid.UUID) *session.UserProfile {
	return &session.UserProfile{
		UserId:     id,
		Username:   util.GenerateUsername(),
		Background: util.GenerateBackgroundColor(),
	}
}

// derefOrEmpty returns the pointed-to string, or "" when p is nil. LobbyCode
// is a *string on the wire so it serialises to JSON null rather than being
// omitted, but the session registry stores "" for "no lobby".
func derefOrEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
