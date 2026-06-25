import { createRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"
import { LoadingSpinner } from "@/components/LoadingSpinner"
import { ErrorDisplay } from "@/components/ErrorDisplay"

export const router = createRouter({
  routeTree,
  defaultPendingComponent: LoadingSpinner,
  defaultErrorComponent: ErrorDisplay,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
