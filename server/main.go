package main

import (
	"log"
	"server/handlers"
	"server/logging"
	"server/session"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func init() {
	_ = godotenv.Load(".env.local")
}

func main() {
	logging.Init()
	defer logging.Close()
	handleServerStartup()
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
}
