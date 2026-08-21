package handlers

import (
	"net/http/httptest"
	"server/events"
	"server/session"
	"server/token"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// testSecret is a fixed 32-byte key, matching the one token_test.go uses. Tests
// never call LoadSessionSecret: a signature test is only meaningful when the
// key is known, and the env fallback would hand every run a different one.
var testSecret = []byte("0123456789abcdef0123456789abcdef")

// otherSecret stands in for "a different process signed this", which is what a
// restart without OA_SESSION_SECRET produces for every stored token.
var otherSecret = []byte("fedcba9876543210fedcba9876543210")

// newBareHub builds the smallest GameHub the identity path reads. NewGameHub is
// avoided deliberately: it loads the word dictionary from wordfiles/, which the
// handshake never touches. Run() is NOT started, so this is only safe for the
// pure functions, resolveIdentity and below.
func newBareHub() *session.GameHub {
	return &session.GameHub{
		Clients:    make(map[*session.Client]bool),
		Lobbies:    make(map[string]*session.GameLobby),
		Sessions:   make(map[uuid.UUID]*session.SessionEntry),
		Secret:     testSecret,
		Register:   make(chan *session.Client),
		Unregister: make(chan *session.Client),
	}
}

// newRunningHub adds the Run goroutine. Anything that reaches HandleWebSocket
// needs it: hub.Register is unbuffered, so without a reader the handshake
// blocks forever rather than failing. Run has no shutdown path, so the
// goroutine outlives the test; that is acceptable here and nowhere else.
func newRunningHub(t *testing.T) *session.GameHub {
	t.Helper()
	hub := newBareHub()
	go hub.Run()
	return hub
}

// serveWebSocket exposes the real handler over a real socket and returns its
// ws:// URL. Using a gin engine rather than a hand-built context keeps the test
// on the same path production takes, including the upgrade.
func serveWebSocket(t *testing.T, hub *session.GameHub) string {
	t.Helper()
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.GET("/ws/game", func(c *gin.Context) { HandleWebSocket(c, hub) })

	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/game"
}

// dial opens a client socket and closes it when the test ends.
func dial(t *testing.T, wsURL string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

// sendResume writes the one frame the server waits for after the upgrade.
func sendResume(t *testing.T, conn *websocket.Conn, tok string) {
	t.Helper()
	b, err := events.PrepareEvent(events.ResumeRequestEvent, session.ResumeRequestPayload{Token: tok})
	if err != nil {
		t.Fatalf("encode resume: %v", err)
	}
	if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
		t.Fatalf("write resume: %v", err)
	}
}

// readEvent reads one frame and decodes its envelope, failing on anything that
// does not arrive within a second so a hung expectation cannot stall the suite.
func readEvent(t *testing.T, conn *websocket.Conn) events.Event {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(time.Second))

	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	ev, err := events.ParseEvent(raw)
	if err != nil {
		t.Fatalf("parse %q: %v", raw, err)
	}
	return ev
}

// readConnected reads the connected_to_hub frame that must be the first thing
// the server sends, and returns its payload.
func readConnected(t *testing.T, conn *websocket.Conn) session.ConnectedToHubPayload {
	t.Helper()
	ev := readEvent(t, conn)
	if ev.Type != events.ConnectedEvent {
		t.Fatalf("first frame: got %q, want %q", ev.Type, events.ConnectedEvent)
	}
	payload, err := events.DecodePayload[session.ConnectedToHubPayload](ev)
	if err != nil {
		t.Fatalf("decode connected_to_hub: %v", err)
	}
	return payload
}

// TestResolveIdentity covers the branch every connection passes through: what
// the server decides you are, given whatever token you claimed. It is pure, so
// no socket and no hub goroutine are involved.
func TestResolveIdentity(t *testing.T) {
	t.Run("no token mints a fresh identity", func(t *testing.T) {
		hub := newBareHub()

		self := resolveIdentity(hub, "")

		if self.Resumed {
			t.Error("a client with no token cannot have resumed anything")
		}
		if self.Id == uuid.Nil {
			t.Error("Id was not minted")
		}
		if self.LobbyCode != nil {
			t.Errorf("LobbyCode: got %q, want nil", *self.LobbyCode)
		}
		// The profile the client is handed must describe the id it was issued,
		// or the roster and the seat disagree from the first frame onward.
		if self.Profile.UserId != self.Id {
			t.Errorf("Profile.UserId %s does not match Id %s", self.Profile.UserId, self.Id)
		}
		if self.Profile.Username == "" || self.Profile.Background == "" {
			t.Errorf("fresh profile was not populated: %+v", self.Profile)
		}
	})

	// Every rejection resolves the same way for the user, a brand-new identity,
	// and none of them may surface as an error. Only the log level differs.
	rejected := []struct {
		name  string
		token func(id uuid.UUID) string
	}{
		{"garbage is not a token", func(uuid.UUID) string { return "not-a-token" }},
		{"wrong number of parts", func(uuid.UUID) string { return "aaa.bbb" }},
		{"expired", func(id uuid.UUID) string {
			// TTL is 12h, so minting 13h ago puts expiry an hour in the past.
			return token.MintSessionToken(testSecret, id, time.Now().Add(-13*time.Hour))
		}},
		{"signed by another secret", func(id uuid.UUID) string {
			return token.MintSessionToken(otherSecret, id, time.Now())
		}},
	}

	for _, c := range rejected {
		t.Run(c.name+" mints a fresh identity", func(t *testing.T) {
			hub := newBareHub()
			claimed := uuid.New()

			// Seed a registry entry for the claimed id. A rejected token must
			// not reach it, which is the whole point of checking the signature.
			hub.Sessions[claimed] = &session.SessionEntry{
				Profile:   session.UserProfile{UserId: claimed, Username: "Bävern"},
				LobbyCode: "abcd-1234",
			}
			hub.Lobbies["abcd-1234"] = &session.GameLobby{ID: "abcd-1234"}

			self := resolveIdentity(hub, c.token(claimed))

			if self.Id == claimed {
				t.Fatalf("a rejected token was honoured: got the claimed id %s", claimed)
			}
			if self.Resumed {
				t.Error("Resumed must be false for a rejected token")
			}
			if self.LobbyCode != nil {
				t.Errorf("a rejected token reached a lobby: %q", *self.LobbyCode)
			}
			if self.Profile.Username == "Bävern" {
				t.Error("a rejected token reached the stored profile")
			}
		})
	}

	t.Run("a valid token with no registry entry keeps the id but is not a resume", func(t *testing.T) {
		hub := newBareHub()
		id := uuid.New()

		self := resolveIdentity(hub, token.MintSessionToken(testSecret, id, time.Now()))

		// The signature proves we minted this id, so the seat it names is this
		// client's to take back even though the sweep dropped the entry.
		if self.Id != id {
			t.Fatalf("Id: got %s, want %s", self.Id, id)
		}
		// But it is not a resume: the client would otherwise announce
		// "Återansluten" over a freshly randomised name.
		if self.Resumed {
			t.Error("Resumed must be false when the entry is gone")
		}
		if self.Profile.UserId != id {
			t.Errorf("Profile.UserId %s does not match the recovered id %s", self.Profile.UserId, id)
		}
	})

	t.Run("a valid token with an entry resumes the stored profile", func(t *testing.T) {
		hub := newBareHub()
		id := uuid.New()
		stored := session.UserProfile{UserId: id, Username: "Bävern", Background: "#123456"}
		hub.Sessions[id] = &session.SessionEntry{Profile: stored}

		self := resolveIdentity(hub, token.MintSessionToken(testSecret, id, time.Now()))

		if self.Id != id {
			t.Fatalf("Id: got %s, want %s", self.Id, id)
		}
		if !self.Resumed {
			t.Error("Resumed must be true when the entry was found")
		}
		if *self.Profile != stored {
			t.Errorf("Profile: got %+v, want %+v", *self.Profile, stored)
		}
		if self.LobbyCode != nil {
			t.Errorf("LobbyCode: got %q, want nil for an entry naming no lobby", *self.LobbyCode)
		}
	})

	t.Run("a lobby the hub still holds is offered", func(t *testing.T) {
		hub := newBareHub()
		id := uuid.New()
		hub.Sessions[id] = &session.SessionEntry{
			Profile:   session.UserProfile{UserId: id, Username: "Bävern"},
			LobbyCode: "abcd-1234",
		}
		hub.Lobbies["abcd-1234"] = &session.GameLobby{ID: "abcd-1234"}

		self := resolveIdentity(hub, token.MintSessionToken(testSecret, id, time.Now()))

		if self.LobbyCode == nil {
			t.Fatal("a live lobby was not offered to the returning client")
		}
		if *self.LobbyCode != "abcd-1234" {
			t.Errorf("LobbyCode: got %q, want %q", *self.LobbyCode, "abcd-1234")
		}
	})

	t.Run("a lobby the hub no longer holds is withheld", func(t *testing.T) {
		hub := newBareHub()
		id := uuid.New()
		// The registry outlives the GameLobby it names. Handing this code back
		// would send the client into "Hittade inget rum med den koden."
		hub.Sessions[id] = &session.SessionEntry{
			Profile:   session.UserProfile{UserId: id, Username: "Bävern"},
			LobbyCode: "dead-0000",
		}

		self := resolveIdentity(hub, token.MintSessionToken(testSecret, id, time.Now()))

		if !self.Resumed {
			t.Error("the entry was found, so this is still a resume")
		}
		if self.LobbyCode != nil {
			t.Errorf("a stale lobby code was offered: %q", *self.LobbyCode)
		}
	})

	t.Run("the returned profile is not aliased to the registry", func(t *testing.T) {
		hub := newBareHub()
		id := uuid.New()
		hub.Sessions[id] = &session.SessionEntry{
			Profile: session.UserProfile{UserId: id, Username: "Bävern"},
		}

		self := resolveIdentity(hub, token.MintSessionToken(testSecret, id, time.Now()))

		// A rename on the returned profile must not reach the registry. This is
		// the aliasing bug the value-copy in LookupSession exists to prevent.
		self.Profile.Username = "Älgen"
		if hub.Sessions[id].Profile.Username != "Bävern" {
			t.Fatalf("renaming the returned profile reached the registry: %q", hub.Sessions[id].Profile.Username)
		}
	})
}

func TestDerefOrEmpty(t *testing.T) {
	if got := derefOrEmpty(nil); got != "" {
		t.Errorf("nil: got %q, want empty", got)
	}
	code := "abcd-1234"
	if got := derefOrEmpty(&code); got != code {
		t.Errorf("set: got %q, want %q", got, code)
	}
}

// handshakeResult carries readResumeHandshake's return values out of the server
// goroutine so the test can assert on them.
type handshakeResult struct {
	token string
	ok    bool
}

// serveRawHandshake stands up a socket whose handler runs readResumeHandshake
// and nothing else, so the function's contract is testable without dragging in
// the identity resolution and client wiring that follow it.
func serveRawHandshake(t *testing.T) (string, chan handshakeResult) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	results := make(chan handshakeResult, 4)
	router := gin.New()
	router.GET("/ws/game", func(c *gin.Context) {
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			return
		}
		tok, ok := readResumeHandshake(conn)
		results <- handshakeResult{token: tok, ok: ok}
	})

	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/game", results
}

// awaitHandshake blocks for the server's verdict, failing rather than hanging.
func awaitHandshake(t *testing.T, results chan handshakeResult, within time.Duration) handshakeResult {
	t.Helper()
	select {
	case got := <-results:
		return got
	case <-time.After(within):
		t.Fatal("readResumeHandshake never returned")
		return handshakeResult{}
	}
}

func TestReadResumeHandshake(t *testing.T) {
	t.Run("a resume frame yields its token", func(t *testing.T) {
		wsURL, results := serveRawHandshake(t)
		conn := dial(t, wsURL)
		sendResume(t, conn, "a-token")

		got := awaitHandshake(t, results, time.Second)
		if !got.ok {
			t.Fatal("a well-formed resume must leave the connection usable")
		}
		if got.token != "a-token" {
			t.Errorf("token: got %q, want %q", got.token, "a-token")
		}
	})

	// Three shapes of "nothing usable was claimed". All are forgiving by
	// design: the socket stays open and the client becomes someone new.
	tolerated := []struct {
		name  string
		write func(t *testing.T, conn *websocket.Conn)
	}{
		{"an empty token", func(t *testing.T, conn *websocket.Conn) {
			sendResume(t, conn, "")
		}},
		{"a first frame that is not a resume", func(t *testing.T, conn *websocket.Conn) {
			b, _ := events.PrepareEvent(events.CreateLobbyRequestEvent, nil)
			conn.WriteMessage(websocket.TextMessage, b)
		}},
		{"a malformed envelope", func(t *testing.T, conn *websocket.Conn) {
			conn.WriteMessage(websocket.TextMessage, []byte("{not json"))
		}},
	}

	for _, c := range tolerated {
		t.Run(c.name+" is tolerated as a fresh identity", func(t *testing.T) {
			wsURL, results := serveRawHandshake(t)
			conn := dial(t, wsURL)
			c.write(t, conn)

			got := awaitHandshake(t, results, time.Second)
			if !got.ok {
				t.Fatal("the connection must survive: a resume is never an error to the user")
			}
			if got.token != "" {
				t.Errorf("token: got %q, want empty", got.token)
			}
		})
	}

	t.Run("an oversized first frame is fatal", func(t *testing.T) {
		wsURL, results := serveRawHandshake(t)
		conn := dial(t, wsURL)

		// SOCKET_READ_LIMIT bounds the pre-auth frame. Without it an
		// unauthenticated client could make the server allocate at will.
		conn.WriteMessage(websocket.TextMessage, make([]byte, session.SOCKET_READ_LIMIT+1))

		if got := awaitHandshake(t, results, time.Second); got.ok {
			t.Error("a frame over the read limit must not leave the connection usable")
		}
	})

	t.Run("silence past the deadline is fatal", func(t *testing.T) {
		if testing.Short() {
			t.Skipf("costs a real %v", token.RESUME_DEADLINE)
		}
		wsURL, results := serveRawHandshake(t)
		conn := dial(t, wsURL)

		// Nothing is written. gorilla stores read errors on the connection
		// permanently, so a missed deadline poisons every later read; the
		// handshake must report the connection unusable rather than hand
		// ReadPump a socket that exits on its first iteration.
		got := awaitHandshake(t, results, token.RESUME_DEADLINE+2*time.Second)
		if got.ok {
			t.Fatal("a silent client must not be registered")
		}

		// And the server must have closed it, not merely walked away.
		conn.SetReadDeadline(time.Now().Add(time.Second))
		if _, _, err := conn.ReadMessage(); err == nil {
			t.Error("the connection was left open after a failed handshake")
		}
	})
}

func TestHandleWebSocket(t *testing.T) {
	t.Run("a first connect is issued a fresh identity and a token", func(t *testing.T) {
		hub := newRunningHub(t)
		conn := dial(t, serveWebSocket(t, hub))
		sendResume(t, conn, "")

		got := readConnected(t, conn)

		if got.Resumed {
			t.Error("a client with no token cannot have resumed")
		}
		if got.Token == "" {
			t.Fatal("no session token was issued")
		}
		if got.LobbyCode != nil {
			t.Errorf("LobbyCode: got %q, want null", *got.LobbyCode)
		}
		// The token must be the one that names this user, or the next connect
		// silently becomes somebody else.
		id, err := token.ParseSessionToken(hub.Secret, got.Token, time.Now())
		if err != nil {
			t.Fatalf("the issued token does not parse: %v", err)
		}
		if id != got.User.UserId {
			t.Errorf("token names %s, payload names %s", id, got.User.UserId)
		}
	})

	t.Run("replaying the token resumes the same identity", func(t *testing.T) {
		hub := newRunningHub(t)
		wsURL := serveWebSocket(t, hub)

		first := dial(t, wsURL)
		sendResume(t, first, "")
		issued := readConnected(t, first)
		first.Close()

		second := dial(t, wsURL)
		sendResume(t, second, issued.Token)
		resumed := readConnected(t, second)

		if !resumed.Resumed {
			t.Error("replaying a valid token must be reported as a resume")
		}
		if resumed.User.UserId != issued.User.UserId {
			t.Errorf("identity changed across reconnect: %s then %s", issued.User.UserId, resumed.User.UserId)
		}
		if resumed.User.Username != issued.User.Username {
			t.Errorf("name changed across reconnect: %q then %q", issued.User.Username, resumed.User.Username)
		}
		// Sliding expiry: every successful connect reissues.
		if resumed.Token == "" {
			t.Error("no fresh token was issued on resume")
		}
	})

	t.Run("a second socket on one token replaces the first", func(t *testing.T) {
		hub := newRunningHub(t)
		wsURL := serveWebSocket(t, hub)

		first := dial(t, wsURL)
		sendResume(t, first, "")
		issued := readConnected(t, first)

		// Same token, second tab. Single-connection policy: newest wins, and
		// the loser is told why before it is torn down.
		second := dial(t, wsURL)
		sendResume(t, second, issued.Token)
		readConnected(t, second)

		if ev := readEvent(t, first); ev.Type != events.SessionReplacedEvent {
			t.Fatalf("the displaced tab got %q, want %q", ev.Type, events.SessionReplacedEvent)
		}
	})
}
