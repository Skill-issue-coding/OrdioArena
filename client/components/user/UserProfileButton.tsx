"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sun, Check, Moon } from "lucide-react";
import { BACKGROUND_COLOR_PALETTE, cn } from "@/lib/utils";
import { useEffect } from "react";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { useUserContext } from "@/hooks/usercontext";
import { popIn } from "@/lib/animation-util";
import { useLobbyContext } from "@/hooks/lobbycontext";

export default function UserProfileButton() {
  const { user, updateUser } = useUserContext();
  const { phase } = useLobbyContext();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState(BACKGROUND_COLOR_PALETTE[0]);
  const { resolvedTheme, setTheme } = useTheme();

  const handleOpen = (v: boolean) => {
    if (v && user) {
      setDraftName(user.username);
      setDraftColor(user.background);
    }
    setOpen(v);
  };

  const handleSave = () => {
    const trimmed = draftName.trim().slice(0, 16);
    updateUser({ username: trimmed !== "" ? trimmed : user?.username, background: draftColor });
    setOpen(false);
  };

  useEffect(() => {
    setMounted(true);
    if (user) {
      setDraftName(user.username);
      setDraftColor(user.background);
    }
  }, [user]);
  if (!mounted || !user) return null;
  const toggleTheme = () => setTheme(resolvedTheme === "dark" ? "light" : "dark");

  const displayName = user?.username ?? "?";
  const displayColor = user?.background ?? BACKGROUND_COLOR_PALETTE[0];
  const visible = phase !== "game_started" && !location.pathname.endsWith("/game");

  if (!visible) return null;

  return (
    <>
      <motion.button
        {...popIn(0.1)}
        onClick={() => user && handleOpen(true)}
        aria-label="Edit profile"
        aria-disabled={!user}
        className="fixed z-50 flex items-center justify-center text-xl font-bold text-white border-4 rounded-full cursor-pointer bottom-6 left-6 w-14 h-14 font-body border-card transition-transform hover:scale-110 active:scale-95 disabled:opacity-70 disabled:hover:scale-100"
        style={{
          backgroundColor: displayColor,
          boxShadow: `0 4px 0 0 ${displayColor}88, 0 8px 20px oklch(0.2738 0.0358 274.66 / 0.2)`,
        }}>
        {displayName.charAt(0).toUpperCase()}
      </motion.button>

      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogContent className="border-2">
          <DialogHeader>
            <DialogTitle className="flex items-center text-2xl font-bold font-display gap-2">Din Profil</DialogTitle>
            <DialogDescription className="font-semibold font-display">Välj ett namn och en färg andra spelare får se.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center py-2 gap-4">
            <div
              className="flex items-center justify-center w-24 h-24 text-4xl font-bold text-white border-4 rounded-full font-body border-card"
              style={{
                backgroundColor: draftColor,
                boxShadow: `0 4px 0 0 ${draftColor}88`,
              }}>
              {(draftName || "?").charAt(0).toUpperCase()}
            </div>

            <div className="w-full">
              <label className="block mb-2 text-xs font-bold tracking-wider uppercase font-display text-muted-foreground">Användarnamn</label>
              <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Skriv in ett användarnamn" maxLength={16} className="h-12 text-lg font-bold text-center border-2 rounded-lg font-body bg-muted" autoFocus />
              <p className="mt-1 text-xs text-right text-muted-foreground font-display">{draftName.length}/16</p>
            </div>

            <div className="w-full">
              <label className="block mb-2 text-xs font-bold tracking-wider uppercase font-display text-muted-foreground">Avatar Färg</label>
              <div className="grid grid-cols-8 gap-2">
                {BACKGROUND_COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    onClick={() => setDraftColor(c)}
                    className={cn("aspect-square rounded-lg flex items-center justify-center transition-transform hover:scale-110 cursor-pointer", draftColor === c && "ring-2 ring-offset-2 ring-offset-background ring-foreground scale-110")}
                    style={{ backgroundColor: c }}
                    aria-label={`Color ${c}`}>
                    {draftColor === c && <Check className="w-4 h-4 text-white" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="w-full">
              <label className="block mb-2 text-xs font-bold tracking-wider uppercase font-display text-muted-foreground">Tema</label>

              <Button variant="glass" onClick={toggleTheme} className="justify-start w-full h-12 font-bold font-body gap-3">
                {resolvedTheme === "light" ? (
                  <>
                    <Sun className="w-5 h-5 text-game-yellow" />
                    Ljust Läge
                    <span className="ml-auto text-xs text-muted-foreground">Tryck för att byta</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-5 h-5 text-game-blue" />
                    Mörkt Läge
                    <span className="ml-auto text-xs text-muted-foreground">Tryck för att byta</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="glass" onClick={() => setOpen(false)} className="flex-1 font-bold font-body">
              Avbryt
            </Button>
            <Button onClick={handleSave} disabled={!draftName.trim()} className="flex-1 font-bold font-body">
              Spara
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
