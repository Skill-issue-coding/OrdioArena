import { createFileRoute } from "@tanstack/react-router"
import { GamePage } from "@/pages/GamePage"

export const Route = createFileRoute("/lobby/$lobbyCode/game/")({
  component: GamePage,
})
