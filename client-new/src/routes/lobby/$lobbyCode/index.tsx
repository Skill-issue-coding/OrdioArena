import { createFileRoute } from "@tanstack/react-router"
import { LobbyPage } from "@/pages/LobbyPage"

export const Route = createFileRoute("/lobby/$lobbyCode/")({
  component: LobbyPage,
})
