package words

import (
	"fmt"
	"math"
	"math/rand/v2"
	"strings"
)

func normalizeWordKey(word string) string {
	return strings.ToLower(strings.TrimSpace(word))
}

// inferType returns a generic type string; without per-word type metadata in
// the binary format we fall back to "general". Entities (proper nouns /
// named things) also end up here as "general", which is acceptable for
// random-word selection.
func inferType(_ string, _ map[string]WordEntry) string {
	return "general"
}

// ErrNoBinaryFiles is returned when the binary word files are absent or malformed.
var ErrNoBinaryFiles = fmt.Errorf("binary wordfiles not found")

// EntityTargets returns the subset of targets that are named entities
// (company, celebrity, game, culture, …), i.e. everything except the
// general Korp vocabulary. These are the words that should be used as
// the secret/target word in game modes; general words exist only so
// player guesses are registered.
func EntityTargets(targets []Target) []Target {
	result := make([]Target, 0, len(targets))
	for _, t := range targets {
		if t.Type != "general" {
			result = append(result, t)
		}
	}
	return result
}

// WeightedPickTarget selects a target using power-law weighting on NotabilityScore.
// Notable entities (high sitelinks / Maktbarometern score) are picked much more
// often, while general vocabulary words (score = 0) still get baseline probability
// via the epsilon term so they are never completely excluded.
//
// Returns (Target{}, false) when targets is empty.
func WeightedPickTarget(targets []Target) (Target, bool) {
	if len(targets) == 0 {
		return Target{}, false
	}

	const alpha = 2.0   // exponent, higher values concentrate picks on top entries
	const epsilon = 0.1 // baseline weight so score-0 words still get picked

	weights := make([]float64, len(targets))
	total := 0.0
	for i, t := range targets {
		w := math.Pow(t.NotabilityScore+epsilon, alpha)
		weights[i] = w
		total += w
	}

	r := rand.Float64() * total
	cum := 0.0
	for i, w := range weights {
		cum += w
		if r < cum {
			return targets[i], true
		}
	}
	return targets[len(targets)-1], true
}
