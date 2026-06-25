import { createContext, useContext, useState } from "react"
import type { ReactNode } from "react"

interface UIOverlayContextValue {
  isOverlayActive: boolean
  setOverlayActive: (active: boolean) => void
}

const UIOverlayContext = createContext<UIOverlayContextValue | null>(null)

export function UIOverlayProvider({ children }: { children: ReactNode }) {
  const [isOverlayActive, setOverlayActive] = useState(false)
  return (
    <UIOverlayContext.Provider value={{ isOverlayActive, setOverlayActive }}>
      {children}
    </UIOverlayContext.Provider>
  )
}

export function useUIOverlay() {
  const ctx = useContext(UIOverlayContext)
  if (!ctx) throw new Error("useUIOverlay must be used within UIOverlayProvider")
  return ctx
}
