import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sun, Check, Moon } from "lucide-react"
import { BACKGROUND_COLOR_PALETTE, cn } from "@/lib/utils"
import { useEffect } from "react"
import { useOptionalLobbyContext } from "@/hooks/lobby/Hook"
import { popIn } from "@/lib/animation-utils"
import { motion } from "motion/react"
import { useTheme } from "@/hooks/theme-provider"
import { useUserContext } from "@/hooks/user/Hook"
import { useUIOverlay } from "@/hooks/ui/Hook"

export default function ProfileButton() {
  const { user, updateUser } = useUserContext()
  const { isOverlayActive } = useUIOverlay()
  const lobby = useOptionalLobbyContext()
  const phase = lobby?.phase
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [draftName, setDraftName] = useState("")
  const [draftColor, setDraftColor] = useState(BACKGROUND_COLOR_PALETTE[0])
  const { theme, setTheme } = useTheme()

  const handleOpen = (v: boolean) => {
    if (v && user) {
      setDraftName(user.username)
      setDraftColor(user.background)
    }
    setOpen(v)
  }

  const handleSave = () => {
    const trimmed = draftName.trim().slice(0, 16)
    updateUser({ username: trimmed !== "" ? trimmed : user?.username, background: draftColor })
    setOpen(false)
  }

  useEffect(() => {
    setMounted(true)
    if (user) {
      setDraftName(user.username)
      setDraftColor(user.background)
    }
  }, [user])
  if (!mounted || !user) return null
  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark")

  const displayName = user?.username ?? "?"
  const displayColor = user?.background ?? BACKGROUND_COLOR_PALETTE[0]
  const visible = phase !== "game_started" && !location.pathname.endsWith("/game") && !isOverlayActive

  if (!visible) return null

  return (
    <>
      <motion.button
        {...popIn(0.1)}
        onClick={() => user && handleOpen(true)}
        aria-label="Edit profile"
        aria-disabled={!user}
        className="fixed bottom-6 left-6 z-50 flex h-14 w-14 cursor-pointer items-center justify-center rounded-full border-4 border-card font-body text-xl font-bold text-white transition-transform hover:scale-110 active:scale-95 disabled:opacity-70 disabled:hover:scale-100"
        style={{
          backgroundColor: displayColor,
          boxShadow: `0 4px 0 0 ${displayColor}88, 0 8px 20px oklch(0.2738 0.0358 274.66 / 0.2)`,
        }}
      >
        {displayName.charAt(0).toUpperCase()}
      </motion.button>

      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogContent className="border-2">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-2xl font-bold">Din Profil</DialogTitle>
            <DialogDescription className="font-display font-semibold">Välj ett namn och en färg andra spelare får se.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4 py-2">
            <div
              className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-card font-body text-4xl font-bold text-white"
              style={{
                backgroundColor: draftColor,
                boxShadow: `0 4px 0 0 ${draftColor}88`,
              }}
            >
              {(draftName || "?").charAt(0).toUpperCase()}
            </div>

            <div className="w-full">
              <label className="mb-2 block font-display text-xs font-bold tracking-wider text-muted-foreground uppercase">Användarnamn</label>
              <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Skriv in ett användarnamn" maxLength={16} className="h-12 rounded-lg border-2 bg-muted text-center font-body text-lg font-bold" autoFocus />
              <p className="mt-1 text-right font-display text-xs text-muted-foreground">{draftName.length}/16</p>
            </div>

            <div className="w-full">
              <label className="mb-2 block font-display text-xs font-bold tracking-wider text-muted-foreground uppercase">Avatar Färg</label>
              <div className="grid grid-cols-8 gap-2">
                {BACKGROUND_COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    onClick={() => setDraftColor(c)}
                    className={cn("flex aspect-square cursor-pointer items-center justify-center rounded-lg transition-transform hover:scale-110", draftColor === c && "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-background")}
                    style={{ backgroundColor: c }}
                    aria-label={`Color ${c}`}
                  >
                    {draftColor === c && <Check className="h-4 w-4 text-white" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="w-full">
              <label className="mb-2 block font-display text-xs font-bold tracking-wider text-muted-foreground uppercase">Tema</label>

              <Button variant="glass" onClick={toggleTheme} className="h-12 w-full justify-start gap-3 font-body font-bold">
                {theme === "light" ? (
                  <>
                    <Sun className="h-5 w-5 text-game-yellow" />
                    Ljust Läge
                    <span className="ml-auto text-xs text-muted-foreground">Tryck för att byta</span>
                  </>
                ) : (
                  <>
                    <Moon className="h-5 w-5 text-game-blue" />
                    Mörkt Läge
                    <span className="ml-auto text-xs text-muted-foreground">Tryck för att byta</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="glass" onClick={() => setOpen(false)} className="flex-1 font-body font-bold">
              Avbryt
            </Button>
            <Button onClick={handleSave} disabled={!draftName.trim()} className="flex-1 font-body font-bold">
              Spara
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
