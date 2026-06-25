import { createFileRoute, Outlet } from "@tanstack/react-router"
import { Suspense } from "react"
import { LobbyContextProvider } from "@/hooks/lobby/Hook"
import { GameContextProvider } from "@/hooks/game/Hook"
import { LobbyChat } from "@/components/lobby/LobbyChat"

export const Route = createFileRoute("/lobby/$lobbyCode")({
  component: LobbyLayout,
})

function LobbyLayout() {
  return (
    <LobbyContextProvider>
      <GameContextProvider>
        <Outlet />
      </GameContextProvider>
      <Suspense fallback={null}>
        <LobbyChat />
      </Suspense>
    </LobbyContextProvider>
  )
}
