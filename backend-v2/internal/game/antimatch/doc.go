// Package antimatch implements Anti-matchning.
//
// Every player submits a word related to the target; the point is to say
// something related that nobody else says. Exact duplicates, compared after
// lemma resolution, score 0 for everyone involved. Unique words score
// max(0, 100 - cosine_distance*100). A new target is picked each round, and the
// round ends early once every active seat has submitted.
//
// "Active" means online or within the disconnect grace period, a player
// reconnecting within ten seconds must not be skipped, and a grace expiry must
// immediately re-evaluate early advance rather than letting the round run to its
// deadline.
//
// The per-target antihive threshold from targets.json is applied here. In the
// previous codebase it was loaded and then never used, so a word with no
// relationship to the target scored the same as a thoughtful distant one.
//
// Snapshot must never contain another player's unrevealed submission, that is
// the entire game, so public and private state live in separate fields.
//
// Scaffold only. See docs/design/S7-anti-match.md, issues #87-#93.
package antimatch
