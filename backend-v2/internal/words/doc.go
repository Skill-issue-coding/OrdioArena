// Package words loads and queries the word vectors produced by the Python
// preprocessing pipeline.
//
// The wordfiles contract is unchanged from the previous backend: raw
// little-endian float32 vectors in vocab.bin, an index-aligned vocab.json,
// meta.json, curated targets.json, lemma_map.json and sources.json. Startup
// fails loudly naming the missing file, the backend cannot function without
// them.
//
// Submissions resolve through the lemma map before lookup, so "bilar" and "bil"
// hit the same entry. Distance is cosine over 300-dimension vectors, range [0,2]
// where 0 is identical. Target selection is weighted by notability score, so
// recognisable words come up more often.
//
// The dictionary is read-only after load and therefore shared across every lobby
// with no synchronisation. It is the only large shared structure in the backend,
// so that property is load-bearing: do not add a mutating method.
//
// Scaffold only. See docs/design/S6-game-engine-registry.md, issue #85.
package words
