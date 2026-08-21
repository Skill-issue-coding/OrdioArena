package util

import (
	"math"
	"strings"
)

// Phase is a single node in a game-phase linked list.
// T is the phase-kind type specific to each game mode
// (e.g. ImpostorPhaseType, AntiMatchPhaseType).
// A nil Next terminates the chain; a non-nil Next that points back into the
// chain creates a loop, break it by relinking Next before stopping the game.
type Phase[T any] struct {
	Phase T
	Next  *Phase[T]
}

// CosineDistance computes the cosine distance between two equal-length float64
// vectors. Returns a value in [0, 2] where 0 means identical direction and 2
// means opposite direction. Returns math.NaN() if either vector is empty,
// they differ in length, or either has zero magnitude.
//
// This is the core similarity primitive used by all game modes to compare
// Swedish fastText word vectors.
func CosineDistance(vecA []float32, vecB []float32) float64 {
	if len(vecA) == 0 || len(vecB) == 0 || len(vecA) != len(vecB) {
		return math.NaN()
	}

	var dot, normA, normB float64

	for i := range vecA {
		a, b := float64(vecA[i]), float64(vecB[i])
		dot += a * b
		normA += a * a
		normB += b * b
	}

	if normA == 0 || normB == 0 {
		return math.NaN()
	}

	cosineSimilarity := dot / (math.Sqrt(normA) * math.Sqrt(normB))
	return 1 - cosineSimilarity
}

// IsValidWordSubmission reports whether s is a valid word submission:
// non-empty after trimming leading/trailing whitespace.
func IsValidWordSubmission(s string) bool {
	return strings.TrimSpace(s) != ""
}
