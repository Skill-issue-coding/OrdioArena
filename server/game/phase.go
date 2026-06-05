package game

// Phase is a single node in a game-phase linked list.
// T is the phase-kind type specific to each game mode
// (e.g. ImpostorPhaseType, AntiMatchPhaseType).
// A nil Next terminates the chain; a non-nil Next that points back into the
// chain creates a loop — break it by relinking Next before stopping the game.
type Phase[T any] struct {
	Phase T
	Next  *Phase[T]
}
