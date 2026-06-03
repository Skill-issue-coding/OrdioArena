"use client";

import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Slider } from "@/components/ui/slider";
import { Timer, RefreshCw, Check, HatGlasses, RulerDimensionLine, Languages } from "lucide-react";
import { useState, useRef } from "react";
import { GAME_MODES, getMode, MODE_SETTINGS } from "@/lib/game/gameModes";
import { useEffect } from "react";
import { useLobbyContext } from "@/hooks/lobbycontext";
import { useUserContext } from "@/hooks/usercontext";
import { useWebsocketContext } from "@/hooks/websocketcontext";
import { GameMode, LobbyState } from "@/lib/game/types";

export function GameModeSelector() {
  const { sendEvent } = useWebsocketContext();
  const { user } = useUserContext();
  const { host, mode } = useLobbyContext();

  const isHost = user?.user_id === host;
  const disabled = !isHost;

  const handleModeChange = (newMode: GameMode) => {
    if (!isHost) return;
    sendEvent("change_mode", { mode: newMode });
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {GAME_MODES.map((m) => {
          const active = mode === m.id;
          const isValidMode = m.id === "anti_match" || m.id === "impostor";
          return (
            <button
              key={m.id}
              disabled={disabled && !isValidMode}
              onClick={() => handleModeChange(m.id)}
              className={cn(
                "relative text-left rounded-lg border-2 p-3 transition-all flex items-center gap-3",
                active
                  ? `bg-card border-current ${m.textClass} shadow-md`
                  : "bg-muted/40 border-border hover:border-muted-foreground/40",
                disabled || !isValidMode
                  ? "cursor-not-allowed pointer-events-none opacity-50"
                  : "cursor-pointer opacity-80",
              )}>
              <div
                className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center text-2xl shrink-0",
                  `bg-game-${m.color}`,
                )}>
                {m.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className={cn("font-display font-bold text-sm truncate", active ? m.textClass : "text-foreground")}>
                  {m.title}
                </div>
                <div className="text-xs truncate text-muted-foreground">{m.players}</div>
              </div>
              {active && (
                <div
                  className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-white shrink-0",
                    `bg-game-${m.color}`,
                  )}>
                  <Check className="w-4 h-4" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="p-3 border-2 rounded-lg bg-muted/40 border-border">
        <p className="text-sm leading-snug text-muted-foreground">{getMode(mode as LobbyState["mode"]).description}</p>
      </div>
    </>
  );
}

export function GameSettings() {
  const { settings, host, mode, users } = useLobbyContext();
  const { user } = useUserContext();
  const { sendEvent } = useWebsocketContext();

  const currentMode = (mode as GameMode) || "impostor";
  const settingsConfig = MODE_SETTINGS[currentMode];

  const playerCount = Object.keys(users ?? {}).length;
  const maxImpostors = Math.max(1, Math.floor(playerCount / 3));

  const [localvalues, setLocalValues] = useState<Record<string, number>>({});
  const lastSendRef = useRef<Record<string, number>>({});

  const isHost = user?.user_id === host;
  const disabled = !isHost;

  const handleSettingUpdate = (key: string, value: number) => {
    if (!isHost) return;
    sendEvent("update_setting", { key, value });
  };

  // Select lower impostor count if players leave when higher count is selected
  useEffect(() => {
    const currentImpostorCount =
      localvalues["impostor_count"] ?? (settings && "impostor_count" in settings ? settings.impostor_count : undefined);

    if (currentImpostorCount && currentImpostorCount > maxImpostors) {
      setLocalValues((prev) => ({ ...prev, impostor_count: maxImpostors }));
      handleSettingUpdate("impostor_count", maxImpostors);
    }
  }, [maxImpostors, settings, handleSettingUpdate]);

  useEffect(() => {
    if (settings) {
      setLocalValues(settings as Record<string, number>);
    } else {
      const defaults = settingsConfig.reduce(
        (acc, setting) => {
          acc[setting.key] = setting.default;
          return acc;
        },
        {} as Record<string, number>,
      );
      setLocalValues(defaults);
    }
  }, [settings, settingsConfig]);

  const handleSliderDrag = (key: string, val: number) => {
    setLocalValues((prev) => ({ ...prev, [key]: val }));

    const now = Date.now();
    const lastSend = lastSendRef.current[key] || 0;

    if (now - lastSend > 100) {
      handleSettingUpdate(key, val);
      lastSendRef.current[key] = now;
    }
  };

  return (
    <div className={cn("grid grid-cols-1 md:grid-cols-2 gap-8 w-full", disabled && "opacity-50")}>
      {settingsConfig.map((setting) => {
        const currentValue = localvalues[setting.key] ?? setting.default;
        return (
          <div key={setting.key} className="flex flex-col gap-2.5 flex-1">
            <div className="flex items-center text-sm font-semibold gap-2 text-foreground">
              {setting.key === "impostor_count" ? (
                <HatGlasses className="w-4 h-4 text-muted-foreground" />
              ) : setting.key.includes("duration") ? (
                <Timer className="w-4 h-4 text-muted-foreground" />
              ) : setting.key.includes("distance") ? (
                <RulerDimensionLine className="w-4 h-4 text-muted-foreground" />
              ) : setting.key.includes("word") ? (
                <Languages className="w-4 h-4 text-muted-foreground" />
              ) : (
                <RefreshCw className="w-4 h-4 text-muted-foreground" />
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
                <span className="w-8 text-sm font-bold text-right tabular-nums">
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
                  if (!v) return;
                  const nextValue = Number(v);
                  setLocalValues((prev) => ({ ...prev, [setting.key]: nextValue }));
                  handleSettingUpdate(setting.key, nextValue);
                }}
                /**/
                className={cn(disabled && "pointer-events-none")}>
                {setting.options?.map((opt) => {
                  const isOptionDisabled = setting.key === "impostor_count" && Number(opt.value) > maxImpostors;
                  return (
                    <ToggleGroupItem
                      key={opt.value}
                      value={String(opt.value)}
                      disabled={isOptionDisabled}
                      className={
                        "flex-1 font-display font-bold px-4.5 border-2 transition-all cursor-pointer bg-muted/40 border-border text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/60 data-[state=on]:bg-primary data-[state=on]:border-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-md data-[state=on]:opacity-100 disabled:cursor-not-allowed"
                      }>
                      {opt.label}
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            )}
          </div>
        );
      })}
    </div>
  );
}
