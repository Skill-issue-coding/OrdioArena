package session

import (
	"regexp"
	"server/events"
	"server/token"
	"testing"
	"time"

	"github.com/google/uuid"
)

// newTestHub builds a GameHub with only the maps the session registry touches.
// NewGameHub is deliberately not used: it loads the whole word dictionary from
// wordfiles/, which would make every registry test depend on large binaries at
// a relative path. Nothing on the registry path reads Dictionary, and both
// mutexes are usable at their zero value.
func newTestHub() *GameHub {
	return &GameHub{
		Clients:  make(map[*Client]bool),
		Lobbies:  make(map[string]*GameLobby),
		Sessions: make(map[uuid.UUID]*SessionEntry),
		// Both are unbuffered in production and must exist even for the tests
		// that never start Run: a nil channel is not an error, it simply blocks
		// forever, so omitting them turns a wiring mistake into a hang.
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
	}
}

// newTestClient is the smallest thing the registry accepts. TouchSession and
// ClearSessionClient only ever compare and store the pointer, never dereference
// it, so no socket, no channels and no hub back-reference are needed.
func newTestClient(id uuid.UUID) *Client {
	return &Client{UserId: id}
}

// testProfile keeps assertions readable: the username carries the case being
// tested, so a mismatch says which write went missing rather than just failing.
func testProfile(id uuid.UUID, username string) UserProfile {
	return UserProfile{UserId: id, Username: username, Background: "#123456"}
}

// TestSessionRegistry is the aggregate entry point for the hub's session
// registry. Each group runs as a real subtest via t.Run, so a failure in one
// does not abort the others and a single group can be selected with
// `-run 'TestSessionRegistry/touch session'`.
func TestSessionRegistry(t *testing.T) {
	t.Run("touch session", testTouchSession)
	t.Run("clear session", testClearSessionClient)
	t.Run("lookup session", testLookupSession)
	t.Run("sweep sessions", testSweepSessions)
}

// testTouchSession covers the displacement matrix. TouchSession answers two
// questions at once, "who owns this identity now" and "who did", and the second
// answer is load-bearing: the handshake feeds it straight into hub.Unregister,
// so a wrong non-nil return tears down a live socket.
func testTouchSession(t *testing.T) {
	t.Run("new id creates an entry and displaces nobody", func(t *testing.T) {
		hub := newTestHub()
		id := uuid.New()
		client := newTestClient(id)
		profile := testProfile(id, "Bävern")

		before := time.Now()
		displaced := hub.TouchSession(id, client, profile, "abcd-1234")

		// The regression this guards: returning the caller here made every
		// first connect displace itself, so nobody could ever connect at all.
		if displaced != nil {
			t.Fatalf("a first touch has no predecessor, got displaced=%p", displaced)
		}

		entry, ok := hub.Sessions[id]
		if !ok {
			t.Fatal("entry was not created")
		}
		if entry.Client != client {
			t.Errorf("Client: got %p, want %p", entry.Client, client)
		}
		if entry.Profile != profile {
			t.Errorf("Profile: got %+v, want %+v", entry.Profile, profile)
		}
		if entry.LobbyCode != "abcd-1234" {
			t.Errorf("LobbyCode: got %q, want %q", entry.LobbyCode, "abcd-1234")
		}
		if entry.LastSeen.Before(before) {
			t.Errorf("LastSeen was not stamped at the time of the call: %v", entry.LastSeen)
		}
	})

	t.Run("the owner re-touching is not its own predecessor", func(t *testing.T) {
		hub := newTestHub()
		id := uuid.New()
		client := newTestClient(id)

		hub.TouchSession(id, client, testProfile(id, "Bävern"), "")
		displaced := hub.TouchSession(id, client, testProfile(id, "Bävern"), "abcd-1234")

		// A non-nil return here would have hub.Run unregister the very socket
		// that just won the identity.
		if displaced != nil {
			t.Fatalf("re-touch by the owner must not displace, got %p", displaced)
		}
		if hub.Sessions[id].Client != client {
			t.Error("owner lost the entry to itself")
		}
	})

	t.Run("a second socket displaces the first", func(t *testing.T) {
		hub := newTestHub()
		id := uuid.New()

		// Same UserId, two sockets: the multi-tab case. Newest wins, and the
		// loser must come back so the caller can tear it down.
		first, second := newTestClient(id), newTestClient(id)

		hub.TouchSession(id, first, testProfile(id, "Bävern"), "abcd-1234")
		displaced := hub.TouchSession(id, second, testProfile(id, "Bävern"), "abcd-1234")

		if displaced != first {
			t.Fatalf("displaced: got %p, want the first client %p", displaced, first)
		}
		if hub.Sessions[id].Client != second {
			t.Error("newest socket did not take ownership")
		}
	})

	t.Run("reconnecting into a released entry displaces nobody", func(t *testing.T) {
		hub := newTestHub()
		id := uuid.New()
		old := newTestClient(id)

		hub.TouchSession(id, old, testProfile(id, "Bävern"), "abcd-1234")
		hub.ClearSessionClient(id, old) // ordinary disconnect, the entry survives

		fresh := newTestClient(id)
		displaced := hub.TouchSession(id, fresh, testProfile(id, "Bävern"), "abcd-1234")

		// The plain refresh path: the entry is still there, but nobody owns it,
		// so there is no socket to tear down.
		if displaced != nil {
			t.Fatalf("a released entry has no owner to displace, got %p", displaced)
		}
		if hub.Sessions[id].Client != fresh {
			t.Error("returning socket did not take ownership")
		}
	})

	t.Run("a later touch overwrites profile, lobby and LastSeen", func(t *testing.T) {
		hub := newTestHub()
		id := uuid.New()
		client := newTestClient(id)

		hub.TouchSession(id, client, testProfile(id, "Bävern"), "abcd-1234")
		firstSeen := hub.Sessions[id].LastSeen

		renamed := testProfile(id, "Älgen")
		hub.TouchSession(id, client, renamed, "")

		entry := hub.Sessions[id]
		if entry.Profile != renamed {
			t.Errorf("Profile: got %+v, want %+v", entry.Profile, renamed)
		}
		// "" is a real value, not "leave unchanged": it is how the handshake
		// self-heals an entry still naming a lobby the hub no longer holds.
		if entry.LobbyCode != "" {
			t.Errorf("LobbyCode: got %q, want it cleared", entry.LobbyCode)
		}
		if entry.LastSeen.Before(firstSeen) {
			t.Errorf("LastSeen went backwards: %v then %v", firstSeen, entry.LastSeen)
		}
	})
}

func testClearSessionClient(t *testing.T) {
	t.Run("the owner releases the entry but does not delete it", func(t *testing.T) {
		hub := newTestHub()
		id := uuid.New()
		client := newTestClient(id)

		hub.TouchSession(id, client, testProfile(id, "Bävern"), "abcd-1234")

		before := time.Now()
		hub.ClearSessionClient(id, client)

		entry, ok := hub.Sessions[id]
		if !ok {
			t.Fatal("releasing the owner deleted the entry; the grace window and the sweep both need it to outlive the socket")
		}
		if entry.Client != nil {
			t.Errorf("Client: got %p, want nil", entry.Client)
		}
		if entry.LastSeen.Before(before) {
			t.Errorf("LastSeen was not restamped at release: %v", entry.LastSeen)
		}
		// The contract is "release ownership, not identity": a reconnect inside
		// the grace window must still find its name and its lobby.
		if entry.Profile.Username != "Bävern" || entry.LobbyCode != "abcd-1234" {
			t.Errorf("release wiped identity: %+v", entry)
		}
	})

	t.Run("a non-owner is ignored", func(t *testing.T) {
		hub := newTestHub()
		id := uuid.New()
		firstClient, secondClient := newTestClient(id), newTestClient(id)
		firstProfile, secondProfile := testProfile(id, "Bävern"), testProfile(id, "Uttern")

		hub.TouchSession(id, firstClient, firstProfile, "abcd-1234")
		entry := hub.Sessions[id]
		if entry.Client != firstClient || entry.Profile != firstProfile {
			t.Fatalf("the first touch failed to give ownership")
		}

		hub.TouchSession(id, secondClient, secondProfile, "efgh-5678")
		if entry.Client != secondClient || entry.Profile != secondProfile {
			t.Fatalf("the second touch failed to give ownership")
		}

		hub.ClearSessionClient(id, firstClient)

		if hub.Sessions[id].Client != secondClient {
			t.Fatalf("a displaced tab's unregister cleared the new owner")
		}
	})

	t.Run("an unknown id is a no-op", func(t *testing.T) {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("clearing an unknown id panicked: %v", r)
			}
		}()
		hub := newTestHub()
		id := uuid.New()

		// The realistic failure is a nil dereference: drop the `!ok` guard in
		// ClearSessionClient and hub.Sessions[id] hands back a nil *SessionEntry
		// that the next line writes through. Calling it is the test.
		hub.ClearSessionClient(id, newTestClient(id))

		if len(hub.Sessions) != 0 {
			t.Fatalf("clearing an unknown id created the entry it failed to find: %d entries", len(hub.Sessions))
		}
	})

	t.Run("clearing twice is idempotent", func(t *testing.T) {
		hub := newTestHub()
		id := uuid.New()
		client := newTestClient(id)
		profile := testProfile(id, "Bävern")

		hub.TouchSession(id, client, profile, "abcd-1234")
		hub.ClearSessionClient(id, client)

		entry, ok := hub.Sessions[id]
		if !ok {
			t.Fatal("release deleted the entry")
		}
		if entry.Client != nil {
			t.Fatalf("first clear left an owner: %p", entry.Client)
		}
		releasedAt := entry.LastSeen

		// Both pumps send to hub.Unregister, so every client is cleared twice.
		// The second call finds entry.Client == nil, fails the ownership check
		// and must return without touching anything.
		hub.ClearSessionClient(id, client)

		entry, ok = hub.Sessions[id]
		if !ok {
			t.Fatal("second clear deleted the entry")
		}
		if entry.Client != nil {
			t.Errorf("second clear resurrected an owner: %p", entry.Client)
		}
		if !entry.LastSeen.Equal(releasedAt) {
			t.Errorf("second clear restamped LastSeen: %v then %v", releasedAt, entry.LastSeen)
		}
		if entry.Profile.Username != "Bävern" || entry.LobbyCode != "abcd-1234" {
			t.Errorf("second clear wiped identity: %+v", entry)
		}
	})
}

func testLookupSession(t *testing.T) {
	t.Run("a miss returns the zero value and false", func(t *testing.T) {
		hub := newTestHub()
		entry, ok := hub.LookupSession(uuid.New())

		if ok {
			t.Fatalf("session registry is supposed to be empty, found: %d", len(hub.Sessions))
		}

		// The guard: a caller that forgets to check ok must not end up holding
		// something that looks populated. resolveIdentity checks, but the
		// contract has to hold for the next caller that doesn't.
		if entry != (SessionEntry{}) {
			t.Errorf("a miss leaked a populated entry: %+v", entry)
		}
	})

	t.Run("a hit returns what was touched", func(t *testing.T) {
		hub := newTestHub()
		id := uuid.New()
		client := newTestClient(id)
		profile := testProfile(id, "Bävern")
		lobbyCode := "abcd-1234"

		// Return value is the displaced predecessor, nil on a first touch.
		// Discard it; the inputs are what this case compares against.
		hub.TouchSession(id, client, profile, lobbyCode)

		got, ok := hub.LookupSession(id)
		if !ok {
			t.Fatal("lookup session failed")
		}

		// UserProfile is comparable, so one == covers UserId, Username and
		// Background at once.
		if got.Profile != profile {
			t.Errorf("profiles dont match: %+v and %+v", got.Profile, profile)
		}
		if got.LobbyCode != lobbyCode {
			t.Errorf("lobby codes do not match: %s and %s", got.LobbyCode, lobbyCode)
		}
		// Client is a shallow copy: deliberately the same pointer, since only
		// Profile needed decoupling. The next subtest is what pins that.
		if got.Client != client {
			t.Errorf("clients dont match: %+v and %+v", got.Client, client)
		}
		if got.LastSeen.IsZero() {
			t.Fatal("last seen is zero")
		}
	})

	t.Run("the returned entry is a copy, not the stored one", func(t *testing.T) {
		hub := newTestHub()
		id := uuid.New()
		client := newTestClient(id)
		profile := testProfile(id, "Bävern")
		lobbyCode := "abcd-1234"

		// Return value is the displaced predecessor, nil on a first touch.
		// Discard it; the inputs are what this case compares against.
		hub.TouchSession(id, client, profile, lobbyCode)

		got, ok := hub.LookupSession(id)
		if !ok {
			t.Fatal("lookup session failed")
		}

		// touch with "Bävern", look up, then mutate the returned copy:
		got.Profile.Username = "Älgen"

		again, _ := hub.LookupSession(id)
		if again.Profile.Username != "Bävern" {
			t.Fatalf("mutating the returned entry reached the registry: %q", again.Profile.Username)
		}
		// Note for whoever reads this later: Client is deliberately still the
		// same pointer. Only Profile had to be decoupled, resolveIdentity hands
		// &entry.Profile to a new Client, and a shared one would alias every
		// player onto one profile struct.
	})
}

func testSweepSessions(t *testing.T) {
	base := time.Date(2026, 3, 14, 15, 9, 26, 0, time.UTC)

	cases := []struct {
		name      string
		hasClient bool
		lobbyCode string
		age       time.Duration
		wantKept  bool
	}{
		{"a live socket is kept at any age", true, "", 48 * time.Hour, true},
		{"a named lobby is kept at any age", false, "abcd-1234", 48 * time.Hour, true},
		{"unowned and lobbyless but young is kept", false, "", time.Minute, true},
		{"unowned, lobbyless and expired is dropped", false, "", 48 * time.Hour, false},
		// Pins < against <=. Exactly at the TTL the token could no longer be
		// honoured, so the entry goes; without this the boundary is whatever
		// the last edit happened to leave.
		{"exactly at the TTL is dropped", false, "", token.SESSION_TOKEN_TTL, false},
		{"an owned entry inside a lobby is kept", true, "abcd-1234", 48 * time.Hour, true},
		// The other half of the boundary. Without this, < and <= both pass the
		// "exactly at the TTL" row only by accident of which side you tested.
		{"one nanosecond under the TTL is kept", false, "", token.SESSION_TOKEN_TTL - time.Nanosecond, true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			hub := newTestHub()
			id := uuid.New()

			// Built by hand, not through TouchSession: TouchSession stamps
			// LastSeen from the wall clock, so it cannot produce an aged entry.
			entry := &SessionEntry{
				Profile:   testProfile(id, "Bävern"),
				LobbyCode: c.lobbyCode,
				LastSeen:  base.Add(-c.age),
			}
			if c.hasClient {
				entry.Client = newTestClient(id)
			}
			hub.Sessions[id] = entry

			hub.sweepSessions(base)

			if _, kept := hub.Sessions[id]; kept != c.wantKept {
				t.Errorf("kept = %v, want %v (client=%v, lobby=%q, age=%v)",
					kept, c.wantKept, c.hasClient, c.lobbyCode, c.age)
			}
		})
	}

	t.Run("a mixed map loses only the expired entries", func(t *testing.T) {
		hub := newTestHub()

		var doomed, survivors []uuid.UUID

		// Unowned, lobbyless and past the TTL: nothing depends on it any more.
		addDoomed := func() {
			id := uuid.New()
			hub.Sessions[id] = &SessionEntry{
				Profile:  testProfile(id, "Bävern"),
				LastSeen: base.Add(-48 * time.Hour),
			}
			doomed = append(doomed, id)
		}

		// Every survivor is deliberately just as expired. They must be kept on
		// their keep reason alone, never because they happen to be young.
		addSurvivor := func(owned bool, lobbyCode string) {
			id := uuid.New()
			entry := &SessionEntry{
				Profile:   testProfile(id, "Bävern"),
				LobbyCode: lobbyCode,
				LastSeen:  base.Add(-48 * time.Hour),
			}
			if owned {
				entry.Client = newTestClient(id)
			}
			hub.Sessions[id] = entry
			survivors = append(survivors, id)
		}

		addDoomed()
		addSurvivor(true, "") // a live socket
		addDoomed()
		addSurvivor(false, "abcd-1234") // a seat still worth returning to
		addDoomed()
		addSurvivor(true, "efgh-5678") // both reasons at once
		addDoomed()
		addDoomed()

		// Go randomises map iteration order on every range, so each run deletes
		// from a different starting point. That is what actually exercises the
		// delete-during-range claim in sweepSessions; the single-entry table
		// rows above never can.
		hub.sweepSessions(base)

		for _, id := range doomed {
			if _, kept := hub.Sessions[id]; kept {
				t.Errorf("expired entry survived the sweep: %s", id)
			}
		}
		for _, id := range survivors {
			if _, kept := hub.Sessions[id]; !kept {
				t.Errorf("entry with a keep reason was swept: %s", id)
			}
		}

		// Catches an entry that survived and belongs to neither list, which a
		// per-id loop alone would miss.
		if len(hub.Sessions) != len(survivors) {
			t.Errorf("after sweep: %d entries, want %d", len(hub.Sessions), len(survivors))
		}
	})
}

// startHub runs the hub's event loop. Anything that goes through Register or
// Unregister needs it: both channels are unbuffered, so without a reader a send
// blocks forever rather than failing. Run has no shutdown path, so the goroutine
// outlives the test.
func startHub(t *testing.T, hub *GameHub) {
	t.Helper()
	go hub.Run()
}

// sendClient hands a client to one of the hub's channels, failing instead of
// hanging when nothing is reading. A panic inside Run would otherwise turn
// every later send into a deadlock and the test into a timeout with no message.
func sendClient(t *testing.T, ch chan *Client, client *Client) {
	t.Helper()
	select {
	case ch <- client:
	case <-time.After(time.Second):
		t.Fatal("hub.Run is not reading its channel; the goroutine is gone")
	}
}

// awaitClosedSend blocks until the hub closes the client's Send channel, which
// is what signals WritePump to exit. Reading a closed channel is the natural
// sync point for "the Unregister case ran".
func awaitClosedSend(t *testing.T, client *Client) {
	t.Helper()
	select {
	case _, ok := <-client.Send:
		if ok {
			t.Fatal("expected Send to be closed, got a queued message")
		}
	case <-time.After(time.Second):
		t.Fatal("Send was never closed")
	}
}

// eventually polls until cond holds or the budget runs out. Needed because
// hub.Run closes Send before it releases the session entry, so observing the
// close does not prove the whole case body finished.
func eventually(t *testing.T, within time.Duration, cond func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(time.Millisecond)
	}
	return false
}

// sendLeave hands a departure to a lobby, failing instead of hanging when the
// lobby goroutine is gone. The reason is explicit at every call site because
// the two paths diverge once the grace period exists.
func sendLeave(t *testing.T, lobby *GameLobby, client *Client, reason LeaveReason) {
	t.Helper()
	select {
	case lobby.Unregister <- LeaveRequest{Client: client, Reason: reason}:
	case <-time.After(time.Second):
		t.Fatal("lobby.Run is not reading Unregister; the goroutine is gone")
	}
}

// TestRoomRegistry covers the lobby map: creation, lookup, deletion and the
// player count derived from it. All three entry points are mutex-guarded and
// safe from any goroutine, so no hub loop is involved.
func TestRoomRegistry(t *testing.T) {
	t.Run("a created room is registered and reachable", func(t *testing.T) {
		hub := newTestHub()

		// CreateUniqueRoom also starts the lobby's Run goroutine, which has no
		// shutdown path and so outlives the test. It stays idle: nothing is
		// registered into it here.
		code := hub.CreateUniqueRoom()

		room := hub.GetRoom(code)
		if room == nil {
			t.Fatalf("the room just created is not reachable by its code %q", code)
		}
		if room.ID != code {
			t.Errorf("room.ID: got %q, want %q", room.ID, code)
		}
		if room != hub.Lobbies[code] {
			t.Error("GetRoom returned a different lobby than the one registered")
		}
	})

	t.Run("codes are lowercase xxxx-xxxx", func(t *testing.T) {
		hub := newTestHub()

		// join_lobby lowercases the client's input before lookup, so a code
		// that was not already lowercase would never be findable.
		shape := regexp.MustCompile(`^[a-z0-9]{4}-[a-z0-9]{4}$`)
		for range 20 {
			if code := hub.CreateUniqueRoom(); !shape.MatchString(code) {
				t.Fatalf("code %q does not match the shape the frontend and join_lobby assume", code)
			}
		}
	})

	t.Run("codes do not collide", func(t *testing.T) {
		hub := newTestHub()

		const rooms = 50
		for range rooms {
			hub.CreateUniqueRoom()
		}
		// Every code is a distinct map key, so a collision shows up as a
		// missing lobby rather than an error.
		if len(hub.Lobbies) != rooms {
			t.Errorf("created %d rooms, registry holds %d", rooms, len(hub.Lobbies))
		}
	})

	t.Run("an unknown code returns nil", func(t *testing.T) {
		hub := newTestHub()
		hub.CreateUniqueRoom()

		// The graceful miss the deployment constraints depend on: there is no
		// create-by-code path, so a code nobody created must stay nil and the
		// client must land on "Hittade inget rum med den koden."
		if room := hub.GetRoom("zzzz-9999"); room != nil {
			t.Errorf("an uncreated code produced a lobby: %+v", room)
		}
	})

	t.Run("deleting removes the room", func(t *testing.T) {
		hub := newTestHub()
		code := hub.CreateUniqueRoom()

		hub.DeleteRoom(code)

		if room := hub.GetRoom(code); room != nil {
			t.Error("the room is still reachable after deletion")
		}
		if _, ok := hub.Lobbies[code]; ok {
			t.Error("the room is still in the registry after deletion")
		}
	})

	t.Run("deleting an unknown code is a no-op", func(t *testing.T) {
		hub := newTestHub()
		code := hub.CreateUniqueRoom()

		hub.DeleteRoom("zzzz-9999")

		if hub.GetRoom(code) == nil {
			t.Error("deleting an unknown code removed an unrelated room")
		}
		if len(hub.Lobbies) != 1 {
			t.Errorf("registry holds %d rooms, want 1", len(hub.Lobbies))
		}
	})

	t.Run("totalPlayers sums the rosters", func(t *testing.T) {
		hub := newTestHub()

		// Built by hand rather than through CreateUniqueRoom, and seeded through
		// playerCount rather than Clients: totalPlayers deliberately never
		// touches the Clients map, because that one belongs to the lobby's own
		// Run goroutine.
		withPlayers := func(code string, n int64) *GameLobby {
			lobby := &GameLobby{ID: code, Clients: make(map[*Client]bool)}
			lobby.playerCount.Store(n)
			return lobby
		}
		hub.Lobbies["aaaa-1111"] = withPlayers("aaaa-1111", 2)
		hub.Lobbies["bbbb-2222"] = withPlayers("bbbb-2222", 1)
		hub.Lobbies["cccc-3333"] = withPlayers("cccc-3333", 0)

		if got := hub.totalPlayers(); got != 3 {
			t.Errorf("totalPlayers: got %d, want 3", got)
		}
	})

	t.Run("PlayerCount tracks register and unregister", func(t *testing.T) {
		hub := newTestHub()
		startHub(t, hub)

		code := hub.CreateUniqueRoom()
		lobby := hub.GetRoom(code)
		if got := lobby.PlayerCount(); got != 0 {
			t.Fatalf("a new lobby reports %d players, want 0", got)
		}

		// Go through the real channels: playerCount is only correct if Run
		// restamps it on every Clients mutation, which is exactly what a future
		// edit that adds a third mutation site would break.
		first := &Client{UserId: uuid.New(), Profile: &UserProfile{Username: "Bävern"}, Hub: hub, Send: make(chan []byte, 8)}
		second := &Client{UserId: uuid.New(), Profile: &UserProfile{Username: "Uttern"}, Hub: hub, Send: make(chan []byte, 8)}

		sendClient(t, lobby.Register, first)
		sendClient(t, lobby.Register, second)
		if !eventually(t, time.Second, func() bool { return lobby.PlayerCount() == 2 }) {
			t.Fatalf("after two joins PlayerCount is %d, want 2", lobby.PlayerCount())
		}

		sendLeave(t, lobby, second, ReasonLeave)
		if !eventually(t, time.Second, func() bool { return lobby.PlayerCount() == 1 }) {
			t.Fatalf("after one leave PlayerCount is %d, want 1", lobby.PlayerCount())
		}

		// And the hub's aggregate, read from a different goroutine than the one
		// that owns the roster, agrees with it.
		hub.LobbiesMutex.RLock()
		total := hub.totalPlayers()
		hub.LobbiesMutex.RUnlock()
		if total != 1 {
			t.Errorf("totalPlayers: got %d, want 1", total)
		}
	})

	t.Run("totalPlayers is zero with no rooms", func(t *testing.T) {
		if got := newTestHub().totalPlayers(); got != 0 {
			t.Errorf("totalPlayers: got %d, want 0", got)
		}
	})
}

// TestHubRun covers the event loop's client lifecycle. hub.Clients is owned by
// the Run goroutine, so nothing here reads it directly; every assertion goes
// through an observable side effect instead, the closed Send channel or the
// mutex-guarded session registry.
func TestHubRun(t *testing.T) {
	t.Run("unregistering closes Send and releases the identity", func(t *testing.T) {
		hub := newTestHub()
		startHub(t, hub)

		id := uuid.New()
		client := &Client{UserId: id, Send: make(chan []byte, 4)}
		hub.TouchSession(id, client, testProfile(id, "Bävern"), "abcd-1234")

		sendClient(t, hub.Register, client)
		sendClient(t, hub.Unregister, client)

		awaitClosedSend(t, client)

		// The wiring this pins: without ClearSessionClient in the Unregister
		// case the entry keeps a dead pointer, and sweepSessions can then never
		// expire anything because entry.Client is never nil again.
		released := eventually(t, time.Second, func() bool {
			entry, ok := hub.LookupSession(id)
			return ok && entry.Client == nil
		})
		if !released {
			t.Fatal("the session entry still names the disconnected client")
		}

		// Releasing ownership must not destroy the identity: a reconnect inside
		// the grace window still needs its name and its lobby.
		entry, ok := hub.LookupSession(id)
		if !ok {
			t.Fatal("unregistering deleted the session entry")
		}
		if entry.Profile.Username != "Bävern" || entry.LobbyCode != "abcd-1234" {
			t.Errorf("unregistering wiped identity: %+v", entry)
		}
	})

	t.Run("a second unregister is a no-op and leaves the hub alive", func(t *testing.T) {
		hub := newTestHub()
		startHub(t, hub)

		client := &Client{UserId: uuid.New(), Send: make(chan []byte, 4)}
		sendClient(t, hub.Register, client)
		sendClient(t, hub.Unregister, client)
		awaitClosedSend(t, client)

		// Both pumps defer a send to hub.Unregister, so every client is
		// unregistered twice. Without the hub.Clients guard the second
		// close(client.Send) panics and takes the whole hub goroutine with it.
		sendClient(t, hub.Unregister, client)

		// Round-tripping another client proves Run survived: a panicked
		// goroutine would make this send time out instead.
		other := &Client{UserId: uuid.New(), Send: make(chan []byte, 4)}
		sendClient(t, hub.Register, other)
		sendClient(t, hub.Unregister, other)
		awaitClosedSend(t, other)
	})

	t.Run("unregistering a client the hub never saw leaves it open", func(t *testing.T) {
		hub := newTestHub()
		startHub(t, hub)

		stranger := &Client{UserId: uuid.New(), Send: make(chan []byte, 4)}
		sendClient(t, hub.Unregister, stranger)

		// Run processes its channels sequentially, so a full round trip by a
		// second client is a barrier: once this one is closed, the stranger's
		// Unregister has definitely been handled.
		barrier := &Client{UserId: uuid.New(), Send: make(chan []byte, 4)}
		sendClient(t, hub.Register, barrier)
		sendClient(t, hub.Unregister, barrier)
		awaitClosedSend(t, barrier)

		// A send on a closed channel panics, so this both asserts and explains:
		// the hub must not close a channel it never took ownership of.
		stranger.Send <- []byte("still open")
	})
}

// TestSetSessionLobby covers the lobby's half of the registry. Ownership of the
// Client pointer belongs to hub.Run and must survive every call here untouched.
func TestSetSessionLobby(t *testing.T) {
	t.Run("it records the lobby without disturbing ownership", func(t *testing.T) {
		hub := newTestHub()
		id := uuid.New()
		client := newTestClient(id)
		hub.TouchSession(id, client, testProfile(id, "Bävern"), "")

		hub.SetSessionLobby(id, "abcd-1234")

		entry, ok := hub.LookupSession(id)
		if !ok {
			t.Fatal("the entry disappeared")
		}
		if entry.LobbyCode != "abcd-1234" {
			t.Errorf("LobbyCode: got %q, want %q", entry.LobbyCode, "abcd-1234")
		}
		// One writer per field: the lobby may say where the seat is, never who
		// holds the socket.
		if entry.Client != client {
			t.Errorf("Client: got %p, want %p", entry.Client, client)
		}
		if entry.Profile.Username != "Bävern" {
			t.Errorf("Profile was disturbed: %+v", entry.Profile)
		}
	})

	t.Run("an empty code clears the lobby", func(t *testing.T) {
		hub := newTestHub()
		id := uuid.New()
		client := newTestClient(id)
		hub.TouchSession(id, client, testProfile(id, "Bävern"), "abcd-1234")

		hub.SetSessionLobby(id, "")

		entry, _ := hub.LookupSession(id)
		if entry.LobbyCode != "" {
			t.Errorf("LobbyCode: got %q, want it cleared", entry.LobbyCode)
		}
		if entry.Client != client {
			t.Errorf("clearing the lobby released the socket: %p", entry.Client)
		}
	})

	t.Run("an unknown id is a no-op", func(t *testing.T) {
		hub := newTestHub()

		hub.SetSessionLobby(uuid.New(), "abcd-1234")

		// Inserting here would resurrect an identity the sweep dropped.
		if len(hub.Sessions) != 0 {
			t.Errorf("an unknown id created an entry: %d entries", len(hub.Sessions))
		}
	})

	t.Run("joining and leaving a lobby moves the code both ways", func(t *testing.T) {
		hub := newTestHub()
		startHub(t, hub)

		code := hub.CreateUniqueRoom()
		lobby := hub.GetRoom(code)

		id := uuid.New()
		client := &Client{UserId: id, Profile: &UserProfile{UserId: id, Username: "Bävern"}, Hub: hub, Send: make(chan []byte, 16)}
		hub.TouchSession(id, client, *client.Profile, "")

		// A resident keeps the lobby alive: it deletes itself the moment
		// Clients hits zero, which would otherwise take the registry entry's
		// lobby with it before the assertion runs.
		resident := &Client{UserId: uuid.New(), Profile: &UserProfile{Username: "Uttern"}, Hub: hub, Send: make(chan []byte, 16)}
		sendClient(t, lobby.Register, resident)

		sendClient(t, lobby.Register, client)
		joined := eventually(t, time.Second, func() bool {
			entry, ok := hub.LookupSession(id)
			return ok && entry.LobbyCode == code
		})
		if !joined {
			entry, _ := hub.LookupSession(id)
			t.Fatalf("after joining, LobbyCode is %q, want %q", entry.LobbyCode, code)
		}

		sendLeave(t, lobby, client, ReasonLeave)
		left := eventually(t, time.Second, func() bool {
			entry, ok := hub.LookupSession(id)
			return ok && entry.LobbyCode == ""
		})
		if !left {
			entry, _ := hub.LookupSession(id)
			t.Fatalf("after leaving, LobbyCode is %q, want it cleared", entry.LobbyCode)
		}

		// Leaving a lobby is not disconnecting: the identity outlives it.
		entry, ok := hub.LookupSession(id)
		if !ok {
			t.Fatal("leaving the lobby deleted the session entry")
		}
		if entry.Client != client {
			t.Errorf("leaving the lobby released the socket: %p", entry.Client)
		}
	})
}

// TestDisplacedTabDoesNotEvictSuccessor pins the ownership guard in the lobby's
// Unregister case: gap #2 in docs/design/0001-reconnect.md.
//
// A replaced tab is unregistered after its successor has already joined, and
// both sockets carry the same UserId. Keying the roster removal on the
// connection alone therefore evicts the player who is sitting there playing.
// Displacement fires the two events back to back by construction, so this is
// the ordinary multi-tab path, not a rare interleaving.
func TestDisplacedTabDoesNotEvictSuccessor(t *testing.T) {
	hub := newTestHub()
	startHub(t, hub)

	code := hub.CreateUniqueRoom()
	lobby := hub.GetRoom(code)

	// A resident keeps the lobby alive; it deletes itself at zero clients.
	resident := &Client{UserId: uuid.New(), Profile: &UserProfile{Username: "Uttern"}, Hub: hub, Send: make(chan []byte, 16)}
	sendClient(t, lobby.Register, resident)

	id := uuid.New()
	oldTab := &Client{UserId: id, Profile: &UserProfile{UserId: id, Username: "Bävern"}, Hub: hub, Send: make(chan []byte, 16)}
	newTab := &Client{UserId: id, Profile: &UserProfile{UserId: id, Username: "Bävern"}, Hub: hub, Send: make(chan []byte, 16)}

	hub.TouchSession(id, oldTab, *oldTab.Profile, "")
	sendClient(t, lobby.Register, oldTab)

	// The successor takes the identity and joins, exactly as the handshake
	// does: TouchSession first, then the lobby.
	if displaced := hub.TouchSession(id, newTab, *newTab.Profile, ""); displaced != oldTab {
		t.Fatalf("displaced: got %p, want the old tab %p", displaced, oldTab)
	}
	sendClient(t, lobby.Register, newTab)

	// Only now does the replaced tab's unregister land.
	sendLeave(t, lobby, oldTab, ReasonDisconnect)

	// The roster entry belongs to the new tab and must survive.
	seated := eventually(t, time.Second, func() bool {
		hub.LobbiesMutex.RLock()
		defer hub.LobbiesMutex.RUnlock()
		return lobby.PlayerCount() == 2
	})
	if !seated {
		t.Fatalf("PlayerCount is %d, want 2 (resident + successor)", lobby.PlayerCount())
	}

	// And the registry must still name the lobby: the successor is in it, so
	// clearing the code on the dead tab's way out would strand the next
	// reconnect.
	entry, ok := hub.LookupSession(id)
	if !ok {
		t.Fatal("the session entry disappeared")
	}
	if entry.LobbyCode != code {
		t.Errorf("LobbyCode: got %q, want %q", entry.LobbyCode, code)
	}
	if entry.Client != newTab {
		t.Errorf("Client: got %p, want the successor %p", entry.Client, newTab)
	}

	// The successor must still be able to act, which means being in Users. A
	// sync request is answered only for a client the lobby holds.
	sendClient(t, lobby.SyncRequest, newTab)
	select {
	case raw := <-newTab.Send:
		ev, err := events.ParseEvent(raw)
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		_ = ev
	case <-time.After(time.Second):
		t.Fatal("the successor was evicted: no state came back")
	}
}
