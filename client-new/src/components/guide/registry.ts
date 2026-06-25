import { Brain, Eye, Shuffle, Zap } from "lucide-react"
import type { GameModeGuide, ModeInfo } from "./types"
import { impostorGuide } from "./modes/impostor"
import { antiMatchGuide } from "./modes/antimatch"

export const ALL_MODES: ModeInfo[] = [
  {
    mode: "impostor",
    label: "Impostor",
    description: "En spion gömmer sig bland er, avslöja vem!",
    cssVar: "--game-purple",
    icon: Eye,
  },
  {
    mode: "anti_match",
    label: "Anti-Match",
    description: "Skriv en synonym, men va unik.",
    cssVar: "--game-orange",
    icon: Shuffle,
  },
  {
    mode: "contexto_battle",
    label: "Contexto Battle",
    description: "Hitta det hemliga ordet via semantisk distans.",
    cssVar: "--game-blue",
    icon: Brain,
  },
  {
    mode: "synonym_duel",
    label: "Synonym Duel",
    description: "Duellera med synonymer mot dina motståndare.",
    cssVar: "--game-green",
    icon: Zap,
  },
]

export const GUIDE_REGISTRY: GameModeGuide[] = [
  impostorGuide,
  antiMatchGuide,
  // contextoBattleGuide,
  // synonymDuelGuide,
]
