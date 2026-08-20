import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"

import "./index.css"
import { ThemeProvider } from "@/hooks/theme-provider"
import { router } from "./router"
import { Background } from "./components/background/Background"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
      <Background />
    </ThemeProvider>
  </StrictMode>
)
