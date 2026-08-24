// Package impostor implements Hitta Impostern.
//
// Normal players get a secret word; impostors get a semantically similar but
// different word drawn from the target's impostor candidates. Phase chain:
// show_word, turn-based input, discussion, vote, intermediate, then loop or
// result. Impostors win when impostors >= normals; normals win when every
// impostor is gone.
//
// Roles and words are private state and never enter a broadcast. Turn order is
// stable across rounds and unaffected by disconnects, so a reconnecting player
// resumes their place rather than reshuffling the game every time someone's
// train enters a tunnel. A player who does not answer in time forfeits the turn
// rather than stalling the phase.
//
// This package is also the test of whether the mode registry paid for itself: it
// should ship without modifying any file outside itself. If it cannot, that is a
// finding against the engine design, not an excuse.
//
// Scaffold only. See docs/design/S9-impostor.md, issues #98-#102.
package impostor
