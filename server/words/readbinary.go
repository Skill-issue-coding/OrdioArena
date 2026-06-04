package words

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"log"
	"math"
	"os"
	"path/filepath"
)

const DEFAULT_WORD_FILES_DIRECTORY string = "wordfiles/"

type binaryMeta struct {
	N    int  `json:"n"`
	Dims int  `json:"dims"`
	Dual bool `json:"dual"`
}

var (
	META_PATH    string = filepath.Join(DEFAULT_WORD_FILES_DIRECTORY, "meta.json")
	VOCAB_JSON   string = filepath.Join(DEFAULT_WORD_FILES_DIRECTORY, "vocab.json")
	VOCAB_BIN    string = filepath.Join(DEFAULT_WORD_FILES_DIRECTORY, "vocab.bin")
	SOURCES_JSON string = filepath.Join(DEFAULT_WORD_FILES_DIRECTORY, "sources.json")
	TARGETS_JSON string = filepath.Join(DEFAULT_WORD_FILES_DIRECTORY, "targets.json")
)

// ReadBinaryFiles loads vocab.bin + vocab.json + meta.json produced by stage 6.
// Returns nil if the required binary files are absent (caller falls back to CSV loader).
func ReadBinaryFiles() map[string]WordEntry {
	for _, p := range []string{META_PATH, VOCAB_JSON, VOCAB_BIN} {
		if _, err := os.Stat(p); os.IsNotExist(err) {
			return nil
		}
	}

	// ── meta.json ────────────────────────────────────────────────────────────
	metaBytes, err := os.ReadFile(META_PATH)
	if err != nil {
		log.Printf("words: could not read meta.json: %v", err)
		return nil
	}
	var meta binaryMeta
	if err := json.Unmarshal(metaBytes, &meta); err != nil {
		log.Printf("words: could not parse meta.json: %v", err)
		return nil
	}
	if meta.N <= 0 || meta.Dims <= 0 {
		log.Printf("words: meta.json has invalid dimensions: %+v", meta)
		return nil
	}

	// ── vocab.json ───────────────────────────────────────────────────────────
	vocabBytes, err := os.ReadFile(VOCAB_JSON)
	if err != nil {
		log.Printf("words: could not read vocab.json: %v", err)
		return nil
	}
	var vocab []string
	if err := json.Unmarshal(vocabBytes, &vocab); err != nil {
		log.Printf("words: could not parse vocab.json: %v", err)
		return nil
	}
	if len(vocab) != meta.N {
		log.Printf("words: vocab.json has %d entries but meta.json says N=%d", len(vocab), meta.N)
		return nil
	}

	// ── vocab.bin ────────────────────────────────────────────────────────────
	f, err := os.Open(VOCAB_BIN)
	if err != nil {
		log.Printf("words: could not open vocab.bin: %v", err)
		return nil
	}
	defer f.Close()

	expectedBytes := int64(meta.N) * int64(meta.Dims) * 4
	info, err := f.Stat()
	if err != nil || info.Size() != expectedBytes {
		log.Printf("words: vocab.bin size mismatch (got %d, want %d)", info.Size(), expectedBytes)
		return nil
	}

	raw := make([]float32, meta.N*meta.Dims)
	if err := binary.Read(f, binary.LittleEndian, raw); err != nil && err != io.EOF {
		log.Printf("words: error reading vocab.bin: %v", err)
		return nil
	}

	// ── Load sources.json for category metadata (optional) ───────────────────
	var sources []string
	if data, err := os.ReadFile(SOURCES_JSON); err == nil {
		_ = json.Unmarshal(data, &sources)
	}

	// ── Build WordMap ─────────────────────────────────────────────────────────
	wordMap := make(map[string]WordEntry, meta.N)
	for i, word := range vocab {
		key := normalizeWordKey(word)
		if key == "" {
			continue
		}

		wordType := "general"
		if i < len(sources) && sources[i] != "" {
			wordType = sources[i]
		}

		// Slice directly into the raw backing array — no per-word allocation.
		// Sanitize any NaN/Inf in-place before storing.
		row := raw[i*meta.Dims : (i+1)*meta.Dims]
		for j, v := range row {
			if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
				row[j] = 0
			}
		}

		entry := WordEntry{
			Word:       word,
			Type:       wordType,
			WordVector: row,
		}

		wordMap[key] = entry
	}

	log.Printf("words: loaded %d entries from binary files (dims=%d)", len(wordMap), meta.Dims)
	return wordMap
}

// LoadTargets reads targets.json — the curated Contexto target word list
// produced by stage 7. Returns nil if the file is absent (callers fall back
// to SetRandomActiveWord over the full dictionary).
// Accepts both the new format ([{"word":"…","type":"…"}]) and the legacy
// format (["word",…]) — legacy entries get type "general".
// NotabilityScore values are re-normalised so the highest score in the list
// maps to 1.0, regardless of what the preprocessing pipeline produced.
func LoadTargets() []Target {
	data, err := os.ReadFile(TARGETS_JSON)
	if err != nil {
		return nil
	}

	// Try new format first.
	var targets []Target
	if err := json.Unmarshal(data, &targets); err == nil && len(targets) > 0 {
		normalizeNotabilityScores(targets)
		log.Printf("words: loaded %d Contexto targets", len(targets))
		return targets
	}

	// Fall back to legacy flat string list.
	var legacy []string
	if err := json.Unmarshal(data, &legacy); err != nil {
		log.Printf("words: could not parse targets.json: %v", err)
		return nil
	}
	targets = make([]Target, len(legacy))
	for i, w := range legacy {
		targets[i] = Target{Word: w, Type: "general"}
	}
	log.Printf("words: loaded %d Contexto targets (legacy format)", len(targets))
	return targets
}

// normalizeNotabilityScores rescales NotabilityScore in-place so the maximum
// value across all targets becomes 1.0. Scores of 0 (general vocabulary words
// with no Wikidata/Maktbarometern data) are left at 0.
func normalizeNotabilityScores(targets []Target) {
	maxScore := 0.0
	for _, t := range targets {
		if t.NotabilityScore > maxScore {
			maxScore = t.NotabilityScore
		}
	}
	if maxScore <= 0 {
		return
	}
	for i := range targets {
		targets[i].NotabilityScore /= maxScore
	}
}

// LoadLemmaMap reads lemma_map.json produced by stage 5/6.
// It maps lowercased surface forms to their canonical lemma, e.g. "bilar" → "bil".
// Returns nil if the file is absent (callers treat nil as no-op).
func LoadLemmaMap() map[string]string {
	p := filepath.Join(DEFAULT_WORD_FILES_DIRECTORY, "lemma_map.json")
	data, err := os.ReadFile(p)
	if err != nil {
		return nil
	}
	var m map[string]string
	if err := json.Unmarshal(data, &m); err != nil {
		log.Printf("words: could not parse lemma_map.json: %v", err)
		return nil
	}
	log.Printf("words: loaded %d lemma mappings", len(m))
	return m
}
