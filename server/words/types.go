package words

// SimRanks holds precomputed cosine similarity values at specific rank positions.
// Used by Contexto modes to show calibrated hot/warm/cold feedback per target.
type SimRanks struct {
	Rank10   float64 `json:"10"`
	Rank50   float64 `json:"50"`
	Rank100  float64 `json:"100"`
	Rank500  float64 `json:"500"`
	Rank1000 float64 `json:"1000"`
}

// Target is one entry from targets.json, a word with its category and
// precomputed per-target metadata produced by stage 9.
type Target struct {
	Word string `json:"word"`
	Type string `json:"type"`

	// NotabilityScore is a [0, 1] value computed by stage 7 from Wikidata
	// sitelinks and Maktbarometern scores. Higher means more recognisable.
	// Zero for general vocabulary words without Wikidata/Maktbarometern data.
	NotabilityScore float64 `json:"notability_score"`

	// SimAtRank is populated by stage 9. Zero value means not yet enriched.
	SimAtRank SimRanks `json:"sim_at_rank"`

	// AntiHiveThreshold is the cosine distance at rank 500 for this target.
	// Use this instead of the global MaxDistance constant in Anti-Hivemind mode.
	// Zero means not yet enriched; callers should fall back to their default.
	AntiHiveThreshold float64 `json:"antihive_threshold"`

	// ImpostorCandidates is a pre-validated list of words in the same category
	// with cosine similarity in [0.50, 0.80] relative to this target.
	// Impostor mode picks from here instead of running a runtime search.
	ImpostorCandidates []string `json:"impostor_candidates"`
}

type Dictionary struct {
	WordMap map[string]WordEntry
	// Targets is the curated Contexto target list from targets.json.
	// Nil means fall back to random selection from the full WordMap.
	Targets []Target
	// LemmaMap maps every surface form (lowercased) to its canonical lemma.
	// "bilar" → "bil", "röda" → "röd", etc.  Nil means no map was loaded.
	LemmaMap map[string]string
}

type WordEntry struct {
	Word       string
	Type       string
	WordVector []float32
}
