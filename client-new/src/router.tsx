import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router"
import { Suspense } from "react"
import { WebSocketProvider } from "@/hooks/websocket/Hook"
import { UserProvider } from "@/hooks/user/Hook"
import { LobbyContextProvider } from "@/hooks/lobby/Hook"
import { GameContextProvider } from "@/hooks/game/Hook"
import { LoadingSpinner } from "@/components/LoadingSpinner"
import { NotFound } from "@/components/NotFound"
import { LobbyChat } from "@/components/lobby/LobbyChat"
import ThemedToaster from "@/components/themed-toaster"
import { TooltipProvider } from "@/components/ui/tooltip"
import ProfileButton from "@/components/user/ProfileButton"
import { HomePage } from "@/pages/HomePage"
import { LobbyPage } from "@/pages/LobbyPage"
import { GamePage } from "@/pages/GamePage"
import { ResultPage } from "@/pages/ResultPage"

// Mirrors app/layout.tsx
function RootLayout() {
  return (
    <WebSocketProvider>
      <UserProvider>
        <TooltipProvider>
          <Outlet />
          <ProfileButton />
        </TooltipProvider>
        <ThemedToaster />
      </UserProvider>
    </WebSocketProvider>
  )
}

// Mirrors app/lobby/[lobbyCode]/layout.tsx
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

// Mirrors app/lobby/[lobbyCode]/game/layout.tsx (passthrough)
function GameLayout() {
  return <Outlet />
}

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFound })

// /
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
})

// /lobby/$lobbyCode  — layout route (mirrors lobby/[lobbyCode]/layout.tsx)
const lobbyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/lobby/$lobbyCode",
  component: LobbyLayout,
})

// /lobby/$lobbyCode  — index page (mirrors lobby/[lobbyCode]/page.tsx)
const lobbyIndexRoute = createRoute({
  getParentRoute: () => lobbyRoute,
  path: "/",
  component: LobbyPage,
})

// /lobby/$lobbyCode/game  — layout route (mirrors lobby/[lobbyCode]/game/layout.tsx)
const gameRoute = createRoute({
  getParentRoute: () => lobbyRoute,
  path: "/game",
  component: GameLayout,
})

// /lobby/$lobbyCode/game  — index page (mirrors lobby/[lobbyCode]/game/page.tsx)
const gameIndexRoute = createRoute({
  getParentRoute: () => gameRoute,
  path: "/",
  component: GamePage,
})

// /lobby/$lobbyCode/game/result  (mirrors lobby/[lobbyCode]/game/result/page.tsx)
const resultRoute = createRoute({
  getParentRoute: () => gameRoute,
  path: "/result",
  component: ResultPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  lobbyRoute.addChildren([
    lobbyIndexRoute,
    gameRoute.addChildren([gameIndexRoute, resultRoute]),
  ]),
])

export const router = createRouter({ routeTree, defaultPendingComponent: LoadingSpinner })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
