package game

import (
	"math"
	"server/events"
	"server/util"
	"server/words"
	"time"

	"github.com/google/uuid"
)

type AntiMatchPhaseType string

const (
	// Settings matching the client-side settings for Anti-match game
	ANTIMATCH_ROUND_DURATION_MIN int = 10
	ANTIMATCH_ROUND_DURATION_MAX int = 60

	ANTIMATCH_ROUNDS_MIN int8 = 1
	ANTIMATCH_ROUNDS_MAX int8 = 5

	AntiMatchPhaseInput       AntiMatchPhaseType = "input"
	AntiMatchPhaseRoundResult AntiMatchPhaseType = "round_result"
	AntiMatchPhaseResult      AntiMatchPhaseType = "result"

	SHOW_ROUND_RESULT_DURATION int = 10

	// defaultAntiMatchThreshold is the fallback cosine-distance cutoff used when
	// a target word has not been enriched by stage 9 (AntiHiveThreshold == 0).
	defaultAntiMatchThreshold = 0.5
)

// buildAntiMatchPhaseChain constructs the phase linked list and returns the
// entry node (input), the roundResult node (used to break the loop), and the
// terminal result node.
// The default wiring creates a circular loop between input and round_result.
// Break the loop by setting roundResult.Next = result before stopping.
func buildAntiMatchPhaseChain() (entry, roundResult, result *Phase[AntiMatchPhaseType]) {
	entry = &Phase[AntiMatchPhaseType]{Phase: AntiMatchPhaseInput}
	roundResult = &Phase[AntiMatchPhaseType]{Phase: AntiMatchPhaseRoundResult}
	result = &Phase[AntiMatchPhaseType]{Phase: AntiMatchPhaseResult}
	entry.Next = roundResult
	roundResult.Next = entry // circular: loops back until game ends
	return
}

// pickTarget selects a random target from the dictionary.
// It prefers targets enriched by stage 9 (AntiHiveThreshold > 0) so that the
// per-word threshold is available. Falls back to any target if none are enriched.
// Returns (Target{}, false) when the dictionary has no targets at all.
func pickAntiMatchTarget(dict *words.Dictionary) (words.Target, bool) {
	if len(dict.Targets) == 0 {
		return words.Target{}, false
	}

	entities := words.EntityTargets(dict.Targets)

	// Prefer entity targets enriched by stage 9 so the per-word threshold is available.
	enriched := make([]words.Target, 0, len(entities))
	for _, t := range entities {
		if t.AntiHiveThreshold > 0 {
			enriched = append(enriched, t)
		}
	}
	if len(enriched) > 0 {
		return words.WeightedPickTarget(enriched)
	}

	// Fall back to any entity target, then to the full list if none exist.
	if len(entities) > 0 {
		return words.WeightedPickTarget(entities)
	}
	return words.WeightedPickTarget(dict.Targets)
}

type AntiMatchSettings struct {
	InputDuration int  `json:"input_duration"`
	Rounds        int8 `json:"rounds"`
}

type RoundEntries struct {
	entries map[uuid.UUID]string
}

type AntiMatchGame struct {
	GameBase
	dict             *words.Dictionary
	target           words.Target // picked at Run() start; provides the match threshold
	players          map[uuid.UUID]bool
	rounds           []RoundEntries
	roundNumber      int
	settings         AntiMatchSettings
	phase            *Phase[AntiMatchPhaseType]
	roundResultPhase *Phase[AntiMatchPhaseType] // kept to break the loop on game over
	resultPhase      *Phase[AntiMatchPhaseType] // terminal node
	TotalScores      map[uuid.UUID]int
}

// matchThreshold returns the cosine-distance cutoff for this game's target word.
// Uses the per-word AntiHiveThreshold when available, otherwise the package default.
func (g *AntiMatchGame) matchThreshold() float64 {
	if g.target.AntiHiveThreshold > 0 {
		return g.target.AntiHiveThreshold
	}
	return defaultAntiMatchThreshold
}

func createPlayerMap(players []uuid.UUID) map[uuid.UUID]bool {
	playersMap := make(map[uuid.UUID]bool, len(players))
	for _, player := range players {
		playersMap[player] = true
	}
	return playersMap
}

func NewAntimatchGame(
	settings AntiMatchSettings,
	dict *words.Dictionary,
	outputs chan GameOutput,
	players []uuid.UUID,
	onDone func(),
) *AntiMatchGame {
	entry, roundResult, result := buildAntiMatchPhaseChain()

	rounds := make([]RoundEntries, settings.Rounds)

	for i := range rounds {
		rounds[i] = RoundEntries{entries: make(map[uuid.UUID]string)}
	}

	return &AntiMatchGame{
		GameBase:         newGameBase(outputs, onDone),
		dict:             dict,
		settings:         settings,
		phase:            entry,
		roundResultPhase: roundResult,
		resultPhase:      result,
		rounds:           rounds,
		roundNumber:      0,
		players:          createPlayerMap(players),
		TotalScores:      make(map[uuid.UUID]int),
	}
}

// Run starts the AntiMatch game loop. It must be called in its own goroutine.
func (g *AntiMatchGame) Run() {
	target, ok := pickAntiMatchTarget(g.dict)
	if !ok {
		return
	}
	g.target = target

	// Start the first round's timer!
	g.StartPhase(g.settings.InputDuration)
	g.sendInputPhase()

	g.startTime = time.Now()
	defer func() { g.endTime = time.Now() }()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	defer g.onDone()

	// TODO: notify players of target word and phase start

	for {
		select {
		case <-g.stop:
			return
		// case id := <-g.playerLeft:
		// g.handlePlayerLeft(id) TODO: implement function when player leaves
		case input := <-g.inputs:
			g.processInput(input)
		case <-ticker.C:
			// TODO: advance phase when timer expires
			if !time.Now().Before(g.endTime) {
				g.advancePhase()
			}
		}
	}
}

// phaseTimers builds a GamePhasePayload from the current phase timestamps.
func (g *AntiMatchGame) phaseTimers() GamePhasePayload {
	return GamePhasePayload{
		StartTime: g.startTime.UnixMilli(),
		ReadyTime: g.startTime.Add(SYNC_DELAY).UnixMilli(),
		EndTime:   g.endTime.UnixMilli(),
	}
}

// sendInputPhase broadcasts the start of an input phase with timers and the target word.
func (g *AntiMatchGame) sendInputPhase() {
	g.Broadcast(events.AntiMatchInputPhaseEvent, AntiMatchInputPhasePayload{
		GamePhasePayload: g.phaseTimers(),
		Phase:            string(AntiMatchPhaseInput),
		TargetWord:       g.target.Word,
		CurrentRound:     g.roundNumber + 1,
		TotalRounds:      int(g.settings.Rounds),
	})
}

// sendRoundResultPhase broadcasts round scores. No sync delay — results display starts immediately.
func (g *AntiMatchGame) sendRoundResultPhase(results map[uuid.UUID]AntiMatchPlayerResult, winner *uuid.UUID) {
	g.Broadcast(events.AntiMatchRoundResultEvent, AntiMatchRoundResultPayload{
		GamePhasePayload: GamePhasePayload{
			StartTime: g.startTime.UnixMilli(),
			ReadyTime: g.startTime.UnixMilli(),
			EndTime:   g.endTime.UnixMilli(),
		},
		Phase:        string(AntiMatchPhaseRoundResult),
		TargetWord:   g.target.Word,
		Results:      results,
		Winner:       winner,
		CurrentRound: g.roundNumber + 1,
		TotalRounds:  int(g.settings.Rounds),
	})
}

func (g *AntiMatchGame) advancePhase() {
	switch g.phase.Phase {
	case AntiMatchPhaseInput:
		// TODO: score submissions against matchThreshold(), broadcast round result

		// Count word frequencies to find duplicates
		entries := g.rounds[g.roundNumber].entries
		wordCounts := make(map[string]int)
		for _, word := range entries {
			wordCounts[word]++
		}

		results := make(map[uuid.UUID]AntiMatchPlayerResult)
		var roundWinner *uuid.UUID
		highestScore := -1

		// The target's vector for calculating distance
		targetEntry, _ := g.dict.Lookup(g.target.Word)
		targetVec := targetEntry.WordVector

		for id, word := range entries {
			isDuplicate := wordCounts[word] > 1
			score := 0

			if !isDuplicate {
				wordEntry, exists := g.dict.Lookup(word)
				if !exists {
					continue
				}
				wordVec := wordEntry.WordVector
				// CosineDistance returns [0, 2]. 0 is identical, 2 is opposite.
				dist := util.CosineDistance(targetVec, wordVec)

				// Scale distance to a 0-100 point score.
				// Example: dist of 0.15 becomes 100 - 15 = 85 points.
				score = int(math.Max(0, 100.0-(dist*100.0)))
			}

			g.TotalScores[id] += score

			// Determine the winner
			if score > highestScore && !isDuplicate {
				highestScore = score
				winnerID := id
				roundWinner = &winnerID
			}

			results[id] = AntiMatchPlayerResult{
				Word:        word,
				Score:       score,
				IsDuplicate: isDuplicate,
				TotalScore:  g.TotalScores[id],
			}
		}

		// Fill in zeros for non submitings
		for id := range g.players {
			if _, submitted := entries[id]; !submitted {
				results[id] = AntiMatchPlayerResult{
					Word:        "-",
					Score:       0,
					IsDuplicate: false,
					TotalScore:  g.TotalScores[id],
				}
			}
		}

		g.phase = g.phase.Next                   // → round_result
		g.StartPhase(SHOW_ROUND_RESULT_DURATION) // Start timer for results
		g.sendRoundResultPhase(results, roundWinner)
	case AntiMatchPhaseRoundResult:
		g.roundNumber++

		if g.roundNumber >= int(g.settings.Rounds) {
			// Transition to Final Result
			g.phase = g.resultPhase
			g.advancePhase()
		} else {
			// Start next round
			g.phase = g.phase.Next
			target, _ := pickAntiMatchTarget(g.dict)
			g.target = target
			g.StartPhase(g.settings.InputDuration)
			g.sendInputPhase()
		}
	case AntiMatchPhaseResult:
		for id := range g.players {
			if _, ok := g.TotalScores[id]; !ok {
				g.TotalScores[id] = 0
			}
		}

		payload := AntiMatchGameResultPayload{
			TotalScores: g.TotalScores,
		}

		g.Broadcast(events.GameResultEvent, payload)
		g.Stop()
	}
}

func (g *AntiMatchGame) processInput(input GameInput) {
	switch g.phase.Phase {
	case AntiMatchPhaseInput:
		if input.Event.Type != events.GameSubmitWordRequestEvent {
			return
		}

		payload, err := events.DecodePayload[GameSubmitWordPayload](input.Event)
		if err != nil || payload.Word == "" {
			return
		}

		word := payload.Word
		_, exists := g.dict.WordMap[word]

		if !exists && g.dict.LemmaMap != nil {
			if lemma, ok := g.dict.LemmaMap[word]; ok {
				word = lemma
				_, exists = g.dict.WordMap[word]
			}
		}

		if !exists {
			g.Send(&input.ClientId, events.ErrorEvent, map[string]string{"message": "Ordet finns inte i vår ordbok. Försök med ett annat!"})
			return
		}

		g.rounds[g.roundNumber].entries[input.ClientId] = word
		g.Broadcast(events.AntiMatchSubmissionUpdateEvent, AntiMatchSubmissionUpdatePayload{PlayerID: input.ClientId, HasSubmitted: true})

		if len(g.rounds[g.roundNumber].entries) == len(g.players) {
			g.advancePhase()
		}
	}
}
