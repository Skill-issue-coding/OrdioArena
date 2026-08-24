package token

type Key struct {
	ID    string
	Bytes []byte
}

type Keyset struct {
	Current  Key            // signs
	Accepted map[string]Key // verifies: current + recently retired
}
