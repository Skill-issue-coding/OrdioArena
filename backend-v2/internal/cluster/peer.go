package cluster

type PeerID string

type Peer struct {
	ID    PeerID
	WSURL string // public, client-reachable; validated by config
}
