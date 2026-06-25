import { createRootRoute, Outlet } from "@tanstack/react-router"
import { WebSocketProvider } from "@/hooks/websocket/Hook"
import { UserProvider } from "@/hooks/user/Hook"
import { UIOverlayProvider } from "@/hooks/ui/Hook"
import { TooltipProvider } from "@/components/ui/tooltip"
import ProfileButton from "@/components/user/ProfileButton"
import ThemedToaster from "@/components/themed-toaster"
import { NotFound } from "@/components/NotFound"
import { ErrorDisplay } from "@/components/ErrorDisplay"
import { LoadingSpinner } from "@/components/LoadingSpinner"

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: ErrorDisplay,
  pendingComponent: LoadingSpinner,
})

function RootLayout() {
  return (
    <WebSocketProvider>
      <UserProvider>
        <UIOverlayProvider>
          <TooltipProvider>
            <Outlet />
            <ProfileButton />
          </TooltipProvider>
          <ThemedToaster />
        </UIOverlayProvider>
      </UserProvider>
    </WebSocketProvider>
  )
}
