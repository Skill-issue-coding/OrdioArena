package main

// import (
// 	"bufio"
// 	"fmt"
// 	"log"
// 	"math"
// 	"os"
// 	"sort"
// 	"strings"

// 	"server/words"
// )

// const (
// 	colorReset  = "\033[0m"
// 	colorRed    = "\033[31m"
// 	colorYellow = "\033[33m"
// 	colorGreen  = "\033[32m"
// 	colorBold   = "\033[1m"
// 	colorDim    = "\033[2m"
// )

// // rankOf returns how many vocabulary words are MORE similar to the active word
// // than the given guess is. Rank 1 = the target itself.
// func rankOf(dict *words.Dictionary, guessDistance float64) int {
// 	activeKey := strings.ToLower(strings.TrimSpace(dict.ActiveWord))
// 	target, ok := dict.WordMap[activeKey]
// 	if !ok || len(target.WordVector) == 0 {
// 		return -1
// 	}
// 	guessSim := 1.0 - guessDistance
// 	rank := 1
// 	for _, entry := range dict.WordMap {
// 		// Use query vector for ranking when available (asymmetric E5 encoding).
// 		entryVec := entry.QueryVector
// 		if len(entryVec) == 0 {
// 			entryVec = entry.WordVector
// 		}
// 		if len(entryVec) != len(target.WordVector) {
// 			continue
// 		}
// 		var dot float64
// 		for i, v := range target.WordVector {
// 			dot += float64(v) * float64(entryVec[i])
// 		}
// 		if dot > guessSim {
// 			rank++
// 		}
// 	}
// 	return rank
// }

// func rankColor(rank, total int) string {
// 	pct := float64(rank) / float64(total)
// 	switch {
// 	case pct <= 0.05:
// 		return colorGreen
// 	case pct <= 0.20:
// 		return colorYellow
// 	default:
// 		return colorRed
// 	}
// }

// func rankBar(rank, total int) string {
// 	const width = 20
// 	progress := 1.0 - float64(rank-1)/float64(total)
// 	filled := int(progress * float64(width))
// 	if filled > width {
// 		filled = width
// 	}
// 	if filled < 0 {
// 		filled = 0
// 	}
// 	return strings.Repeat("█", filled) + strings.Repeat("░", width-filled)
// }

// // nearestWords returns the top N vocab words ranked by their similarity to the
// // current target, using the same passage(target)·query(candidate) scoring as
// // the player-facing CalculateDistance / rankOf.
// func nearestWords(dict *words.Dictionary, n int) []string {
// 	activeKey := strings.ToLower(strings.TrimSpace(dict.ActiveWord))
// 	target, ok := dict.WordMap[activeKey]
// 	if !ok || len(target.WordVector) == 0 {
// 		return nil
// 	}

// 	type scored struct {
// 		word string
// 		sim  float64
// 	}

// 	results := make([]scored, 0, len(dict.WordMap))
// 	for _, entry := range dict.WordMap {
// 		candidateVec := entry.QueryVector
// 		if len(candidateVec) == 0 {
// 			candidateVec = entry.WordVector
// 		}
// 		if len(candidateVec) != len(target.WordVector) {
// 			continue
// 		}
// 		var dot float64
// 		for i, v := range target.WordVector {
// 			dot += float64(v) * float64(candidateVec[i])
// 		}
// 		results = append(results, scored{entry.Word, dot})
// 	}

// 	sort.Slice(results, func(i, j int) bool {
// 		return results[i].sim > results[j].sim
// 	})

// 	out := make([]string, 0, n)
// 	for i, r := range results {
// 		if i >= n {
// 			break
// 		}
// 		out = append(out, r.word)
// 	}
// 	return out
// }

// func foo() {
// 	fmt.Println("Laddar ordbok…")
// 	dict, err := words.InitializeDictionary()
// 	if err != nil {
// 		log.Fatalf("Kunde inte ladda ordbok: %v", err)
// 	}

// 	total := len(dict.WordMap)
// 	fmt.Printf("Laddade %d ord\n", total)

// 	if err := dict.SetRandomContextoTarget(); err != nil {
// 		log.Fatalf("Kunde inte välja målord: %v", err)
// 	}

// 	guesses := 0

// 	fmt.Printf("\n%s╔══════════════════════════╗%s\n", colorBold, colorReset)
// 	fmt.Printf("%s║     C O N T E X T O      ║%s\n", colorBold, colorReset)
// 	fmt.Printf("%s╚══════════════════════════╝%s\n\n", colorBold, colorReset)
// 	fmt.Printf("Gissa det hemliga ordet! (%d ord i ordlistan)\n", total)
// 	fmt.Printf("%sKommandon:%s new · reveal · near · exit\n\n", colorDim, colorReset)

// 	scanner := bufio.NewScanner(os.Stdin)
// 	for {
// 		fmt.Printf("Gissning #%d › ", guesses+1)
// 		if !scanner.Scan() {
// 			break
// 		}
// 		input := strings.TrimSpace(scanner.Text())
// 		if input == "" {
// 			continue
// 		}

// 		switch strings.ToLower(input) {
// 		case "exit", "quit":
// 			fmt.Printf("\nSvaret var: %s%s%s\n", colorGreen+colorBold, dict.ActiveWord, colorReset)
// 			return

// 		case "reveal":
// 			fmt.Printf("  → Svaret är: %s%s%s\n\n", colorGreen+colorBold, dict.ActiveWord, colorReset)
// 			continue

// 		case "near":
// 			fmt.Printf("  Topp 20 närmaste ord till %s%s%s:\n", colorGreen+colorBold, dict.ActiveWord, colorReset)
// 			for i, w := range nearestWords(&dict, 20) {
// 				fmt.Printf("    %s#%2d%s  %s\n", colorDim, i+1, colorReset, w)
// 			}
// 			fmt.Println()
// 			continue

// 		case "new":
// 			old := dict.ActiveWord
// 			if err := dict.SetRandomContextoTarget(); err != nil {
// 				fmt.Println("  Kunde inte välja nytt ord.")
// 				continue
// 			}
// 			guesses = 0
// 			fmt.Printf("  Förra ordet var: %s%s%s, nytt ord valt!\n\n", colorGreen+colorBold, old, colorReset)
// 			continue
// 		}

// 		// Win check (case-insensitive)
// 		if strings.EqualFold(input, dict.ActiveWord) {
// 			guesses++
// 			fmt.Printf("\n%s🎉  Rätt svar! Du hittade '%s' på %d gissning", colorGreen+colorBold, dict.ActiveWord, guesses)
// 			if guesses != 1 {
// 				fmt.Print("ar")
// 			}
// 			fmt.Printf("!%s\n\n", colorReset)
// 			fmt.Print("Nytt ord? (j/n) › ")
// 			if scanner.Scan() && strings.ToLower(strings.TrimSpace(scanner.Text())) == "j" {
// 				dict.SetRandomContextoTarget()
// 				guesses = 0
// 				fmt.Printf("  Nytt ord valt!\n\n")
// 			}
// 			continue
// 		}

// 		if !dict.IsValid(input) {
// 			fmt.Printf("  %s'%s' finns inte i ordlistan.%s\n", colorDim, input, colorReset)
// 			continue
// 		}

// 		distance := dict.CalculateDistance(input)
// 		if math.IsNaN(distance) {
// 			fmt.Printf("  Kunde inte beräkna avstånd för '%s'.\n", input)
// 			continue
// 		}

// 		guesses++
// 		sim := 1.0 - distance
// 		rank := rankOf(&dict, distance)
// 		col := rankColor(rank, total)

// 		fmt.Printf("  %s%-22s%s  %s%s%s  sim %s%.4f%s  rank %s#%d / %d%s\n",
// 			colorBold, input, colorReset,
// 			col, rankBar(rank, total), colorReset,
// 			col, sim, colorReset,
// 			col, rank, total, colorReset,
// 		)
// 	}

// 	if err := scanner.Err(); err != nil {
// 		fmt.Println("Läsfel:", err)
// 	}
// }
