import { createFileRoute, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/lobby/$lobbyCode/game")({
  component: () => <Outlet />,
})
