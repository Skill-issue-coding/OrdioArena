import { cn } from "@/lib/utils"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Slider } from "@/components/ui/slider"
import { Timer, RefreshCw, Check, HatGlasses, RulerDimensionLine, Languages } from "lucide-react"
import { useState, useRef } from "react"
import { useEffect } from "react"
import { useWebsocketContext } from "@/hooks/websocket/Hook"
import { useUserContext } from "@/hooks/user/Hook"
import { useLobbyContext } from "@/hooks/lobby/Hook"
import type { GameMode } from "@/hooks/game/types"
import { BASE_GAME_MODES, getMode, MODE_SETTINGS } from "@/lib/game/config"
import type { LobbyState } from "@/hooks/lobby/types"

export function GameModeSelector() {
  const { sendEvent } = useWebsocketContext()
  const { user } = useUserContext()
  const { host, mode } = useLobbyContext()

  const isHost = user?.user_id === host
  const disabled = !isHost

  const handleModeChange = (newMode: GameMode) => {
    if (!isHost) return
    sendEvent("change_mode", { mode: newMode })
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {BASE_GAME_MODES.map((m) => {
          const active = mode === m.id
          const isValidMode = m.id === "anti_match" || m.id === "impostor"
          return (
            <button
              key={m.id}
              disabled={disabled && !isValidMode}
              onClick={() => handleModeChange(m.id)}
              className={cn(
                "relative flex items-center gap-3 rounded-lg border-2 p-3 text-left transition-all",
                active ? `border-current bg-card ${m.textClass} shadow-md` : "border-border bg-muted/40 hover:border-muted-foreground/40",
                disabled || !isValidMode ? "pointer-events-none cursor-not-allowed opacity-50" : "cursor-pointer opacity-80"
              )}
            >
              <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", `bg-game-${m.color}`)}><m.icon className="h-5 w-5 text-white" /></div>
              <div className="min-w-0 flex-1">
                <div className={cn("truncate font-display text-sm font-bold", active ? m.textClass : "text-foreground")}>{m.title}</div>
                <div className="truncate text-xs text-muted-foreground">{m.players}</div>
              </div>
              {active && (
                <div className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white", `bg-game-${m.color}`)}>
                  <Check className="h-4 w-4" />
                </div>
              )}
            </button>
          )
        })}
      </div>

      <div className="rounded-lg border-2 border-border bg-muted/40 p-3">
        <p className="text-sm leading-snug text-muted-foreground">{getMode(mode as LobbyState["mode"]).description}</p>
      </div>
    </>
  )
}

export function GameSettings() {
  const { settings, host, mode, users } = useLobbyContext()
  const { user } = useUserContext()
  const { sendEvent } = useWebsocketContext()

  const currentMode = (mode as GameMode) || "impostor"
  const settingsConfig = MODE_SETTINGS[currentMode]
  const modeColor = getMode(currentMode).color

  const playerCount = Object.keys(users ?? {}).length
  const maxImpostors = Math.max(1, Math.floor(playerCount / 3))

  const [localvalues, setLocalValues] = useState<Record<string, number>>({})
  const lastSendRef = useRef<Record<string, number>>({})

  const isHost = user?.user_id === host
  const disabled = !isHost

  const handleSettingUpdate = (key: string, value: number) => {
    if (!isHost) return
    sendEvent("update_setting", { key, value })
  }

  // Select lower impostor count if players leave when higher count is selected
  useEffect(() => {
    const currentImpostorCount = localvalues["impostor_count"] ?? (settings && "impostor_count" in settings ? settings.impostor_count : undefined)

    if (currentImpostorCount && currentImpostorCount > maxImpostors) {
      setLocalValues((prev) => ({ ...prev, impostor_count: maxImpostors }))
      handleSettingUpdate("impostor_count", maxImpostors)
    }
  }, [maxImpostors, settings, handleSettingUpdate])

  useEffect(() => {
    if (settings) {
      setLocalValues(settings as Record<string, number>)
    } else {
      const defaults = settingsConfig.reduce(
        (acc, setting) => {
          acc[setting.key] = setting.default
          return acc
        },
        {} as Record<string, number>
      )
      setLocalValues(defaults)
    }
  }, [settings, settingsConfig])

  const handleSliderDrag = (key: string, val: number) => {
    setLocalValues((prev) => ({ ...prev, [key]: val }))

    const now = Date.now()
    const lastSend = lastSendRef.current[key] || 0

    if (now - lastSend > 100) {
      handleSettingUpdate(key, val)
      lastSendRef.current[key] = now
    }
  }

  return (
    <div
      className={cn("grid w-full grid-cols-1 gap-8 md:grid-cols-2", disabled && "opacity-50")}
      style={{ "--primary": `var(--game-${modeColor})`, "--primary-foreground": "oklch(1 0 0)", "--ring": `var(--game-${modeColor})` } as React.CSSProperties}
    >
      {settingsConfig.map((setting) => {
        const currentValue = localvalues[setting.key] ?? setting.default
        return (
          <div key={setting.key} className="flex flex-1 flex-col gap-2.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {setting.key === "impostor_count" ? (
                <HatGlasses className="h-4 w-4 text-muted-foreground" />
              ) : setting.key.includes("duration") ? (
                <Timer className="h-4 w-4 text-muted-foreground" />
              ) : setting.key.includes("distance") ? (
                <RulerDimensionLine className="h-4 w-4 text-muted-foreground" />
              ) : setting.key.includes("word") ? (
                <Languages className="h-4 w-4 text-muted-foreground" />
              ) : (
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
              )}
              {setting.label}
            </div>

            {setting.type === "slider" ? (
              <div className={cn("flex items-center gap-4", disabled && "pointer-events-none")}>
                <Slider
                  disabled={disabled}
                  min={setting.min}
                  max={setting.max}
                  step={setting.step}
                  value={[currentValue]}
                  onValueChange={([v]) => handleSliderDrag(setting.key, v)}
                  onValueCommit={([v]) => handleSettingUpdate(setting.key, v)}
                  className="flex-1"
                />
                <span className="w-8 text-right text-sm font-bold tabular-nums">
                  {localvalues[setting.key] ?? setting.default}
                  {setting.key.includes("duration") ? "s" : ""}
                </span>
              </div>
            ) : (
              <ToggleGroup
                disabled={disabled}
                type="single"
                spacing={2}
                size="sm"
                value={String(currentValue)}
                //onValueChange={(v) => v && onSettingUpdate(setting.key, Number(v))}
                /**/
                onValueChange={(v) => {
                  if (!v) return
                  const nextValue = Number(v)
                  setLocalValues((prev) => ({ ...prev, [setting.key]: nextValue }))
                  handleSettingUpdate(setting.key, nextValue)
                }}
                /**/
                className={cn(disabled && "pointer-events-none")}
              >
                {setting.options?.map((opt) => {
                  const isOptionDisabled = setting.key === "impostor_count" && Number(opt.value) > maxImpostors
                  return (
                    <ToggleGroupItem
                      key={opt.value}
                      value={String(opt.value)}
                      disabled={isOptionDisabled}
                      className={
                        "flex-1 cursor-pointer border-2 border-border bg-muted/40 px-4.5 font-display font-bold text-muted-foreground transition-all hover:border-muted-foreground/40 hover:bg-muted/60 disabled:cursor-not-allowed data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:opacity-100 data-[state=on]:shadow-md"
                      }
                    >
                      {opt.label}
                    </ToggleGroupItem>
                  )
                })}
              </ToggleGroup>
            )}
          </div>
        )
      })}
    </div>
  )
}
