import { BASE_GAME_MODES } from "@/lib/game/config"
import type { GameModeGuide, ModeInfo } from "./types"
import { impostorGuide } from "./modes/impostor"
import { antiMatchGuide } from "./modes/antimatch"

const GUIDE_DESCRIPTIONS: Record<string, string> = {
  impostor: "En spion gömmer sig bland er, avslöja vem!",
  anti_match: "Skriv en synonym, men va unik.",
  contexto_battle: "Hitta det hemliga ordet via semantisk distans.",
  synonym_duel: "Duellera med synonymer mot dina motståndare.",
}

export const ALL_MODES: ModeInfo[] = BASE_GAME_MODES.map((m) => ({
  mode: m.id,
  label: m.title,
  description: GUIDE_DESCRIPTIONS[m.id] ?? m.description,
  cssVar: `--game-${m.color}`,
  icon: m.icon,
}))

export const GUIDE_REGISTRY: GameModeGuide[] = [
  impostorGuide,
  antiMatchGuide,
  // contextoBattleGuide,
  // synonymDuelGuide,
]
