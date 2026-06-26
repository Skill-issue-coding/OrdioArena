package main

import (
	"log"
	"server/handlers"
	"server/logging"
	"server/session"

	"github.com/gin-gonic/gin"
)

func main() {
	logging.Init()
	defer logging.Close()
	handleServerStartup()
	// // Create a Gin router with default middleware (logger and recovery)
	// r := gin.Default()

	// // Define a simple GET endpoint
	// r.GET("/ping", func(c *gin.Context) {
	// 	// Return JSON response
	// 	c.JSON(http.StatusOK, gin.H{
	// 		"message": "pong",
	// 	})
	// })

	// // Start server on port 8080 (default)
	// // Server will listen on 0.0.0.0:8080 (localhost:8080 on Windows)
	// r.Run()
}

// corsMiddleware allows cross-origin requests from the browser dev/app origin.
// Without it, preflight OPTIONS requests for JSON POSTs (e.g. /api/log,
// /api/game/username) fail and the browser never sends the actual request.
// It reflects the request Origin so localhost dev ports and the deployed
// frontend both work; tighten the allowlist before production if needed.
func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		if origin != "" {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type")
			c.Header("Access-Control-Max-Age", "86400")
		}
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

func handleServerStartup() {
	router := gin.Default()
	router.Use(corsMiddleware())

	gameHub, err := session.NewGameHub()
	if err != nil {
		log.Fatalf("Could not initialize game hub: %v", err)
	}

	go gameHub.Run()

	api := router.Group("/api")
	{
		api.GET("/status", handlers.HandleStatus)
		api.POST("/game/username", func(c *gin.Context) { handlers.NewUsername(c, gameHub) })
		api.POST("/log", handlers.HandleClientLog)
	}

	ws := router.Group("/ws")
	{
		ws.GET("/game", func(c *gin.Context) { handlers.HandleWebSocket(c, gameHub) })
	}

	// Catch-all OPTIONS so CORS preflight requests match a route and run the
	// corsMiddleware (which short-circuits them with 204 + the CORS headers).
	// Without a matching route, gin returns 404 and the browser blocks the POST.
	router.OPTIONS("/*path", func(c *gin.Context) { c.Status(204) })

	log.Println("Server running on http://localhost:8080")
	router.Run(":8080")
	// terminalTesting(gameHub)
}

// func terminalTesting(gameHub *lobby.GameHub) {
// 	scanner := bufio.NewScanner(os.Stdin)

// 	fmt.Println("Game terminal started. Type a word and press Enter (type 'exit' to quit):")
// 	fmt.Printf("Loaded %d words\n", len(gameHub.Dictionary.WordMap))
// 	fmt.Printf("Active word for this round: %s\n", gameHub.Dictionary.ActiveWord)
// 	fmt.Println("Type 'new' to start a new round with a random active word")

// 	for {
// 		fmt.Print("> ")

// 		if !scanner.Scan() {
// 			break
// 		}

// 		input := scanner.Text()

// 		input = strings.TrimSpace(input)

// 		if input == "exit" {
// 			fmt.Println("Shutting down...")
// 			break
// 		}

// 		if input == "new" {
// 			if err := gameHub.SetRandomActiveWord(); err != nil {
// 				log.Printf("Could not start new round: %v\n", err)
// 				continue
// 			}

// 			fmt.Printf("New active word: %s\n", gameHub.Dictionary.ActiveWord)
// 			continue
// 		}

// 		if wordEntry, exists := gameHub.GetWordEntry(input); exists {
// 			log.Printf("Word exists: %s, Beginning of vector: %.6f \n", wordEntry.Word, wordEntry.WordVector[0])
// 			distance := gameHub.Dictionary.CalculateDistance(input)
// 			similarity := 1 - distance
// 			log.Printf("Distance to active word '%s': %.6f\n", gameHub.Dictionary.ActiveWord, distance)
// 			log.Printf("Similarity to active word '%s': %.6f\n", gameHub.Dictionary.ActiveWord, similarity)
// 		} else {
// 			log.Printf("Word not in dictionary: %s\n", input)
// 		}

// 		fmt.Printf("Backend processed word: '%s'\n", input)
// 	}

// 	if err := scanner.Err(); err != nil {
// 		fmt.Println("Error reading input:", err)
// 	}
// }
