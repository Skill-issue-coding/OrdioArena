import type { GameMode } from "@/hooks/game/types"

export type GameModeColor = "green" | "pink" | "blue" | "yellow" | "red"

export type SettingType = "choice" | "slider" | "boolean"

export type GameModeConfig = {
  id: GameMode
  title: string
  description: string
  icon: string
  players: string
  min_players: number
  color: GameModeColor
  textClass: string
}

export interface GameSettingConfig {
  key: string
  label: string
  type: SettingType
  options?: { value: string | number; label: string }[]
  min?: number
  max?: number
  step?: number
  default: number
}

export const BASE_GAME_MODES: GameModeConfig[] = [
  {
    id: "impostor",
    title: "Hitta Impostern",
    description: "En spelare får ett unikt ord. Försök att tillsammans hitta impostern innan det är försent!",
    icon: "🕵️",
    players: "3-12 spelare",
    min_players: 3,
    color: "red",
    textClass: "text-game-red",
  },
  {
    id: "contexto_battle",
    title: "Kontext Strid",
    description: "Tävla om att hitta det dålda ordet. Semantiska likheter leder dig närmare och närmare det rätta ordet!",
    icon: "🧠",
    players: "2-12 spelare",
    min_players: 2,
    color: "blue",
    textClass: "text-game-blue",
  },
  {
    id: "synonym_duel",
    title: "Synonym Duell",
    description: "Ange den bästa synonymen varje runda. Den som svarar med den sämsta åker ut!",
    icon: "⚔️",
    players: "3-12 spelare",
    min_players: 3,
    color: "green",
    textClass: "text-game-green",
  },
  {
    id: "anti_match",
    title: "Anti-matchning",
    description: "Tänk anorlunda! Skriv en synonym men var försiktig så det inte matchar någon annans, då får båda noll poäng!",
    icon: "🎯",
    players: "3-12 spelare",
    min_players: 3,
    color: "yellow",
    textClass: "text-game-yellow",
  },
]

export const getMode = (id: GameMode): GameModeConfig => BASE_GAME_MODES.find((m) => m.id === id) ?? BASE_GAME_MODES[0]

export const MODE_SETTINGS: Record<GameMode, GameSettingConfig[]> = {
  impostor: [
    {
      key: "impostor_count",
      label: "Antal Impostors",
      type: "choice",
      options: [
        { value: 1, label: "1" },
        { value: 2, label: "2" },
        { value: 3, label: "3" },
        { value: 4, label: "4" },
      ],
      default: 1,
    },
    {
      key: "input_duration",
      label: "Betänketid",
      type: "slider",
      min: 10,
      max: 60,
      step: 5,
      default: 30,
    },
    {
      key: "discussion_duration",
      label: "Diskussionstid",
      type: "slider",
      min: 30,
      max: 150,
      step: 5,
      default: 45,
    },
    {
      key: "vote_duration",
      label: "Röstningstid",
      type: "slider",
      min: 10,
      max: 60,
      step: 5,
      default: 30,
    },
  ],
  contexto_battle: [
    {
      key: "word_type",
      label: "Typ av ord",
      type: "choice",
      options: [
        { value: 1, label: "Vanliga" },
        { value: 2, label: "Kreativa" },
      ],
      default: 1,
    },
    {
      key: "round_duration",
      label: "Betänketid",
      type: "slider",
      min: 60,
      max: 600,
      step: 60,
      default: 120,
    },
    {
      key: "rounds",
      label: "Antal rundor",
      type: "slider",
      min: 1,
      max: 5,
      step: 1,
      default: 3,
    },
  ],
  synonym_duel: [
    {
      key: "word_type",
      label: "Typ av ord",
      type: "choice",
      options: [
        { value: 1, label: "Vanliga" },
        { value: 2, label: "Kreativa" },
      ],
      default: 1,
    },
    {
      key: "round_duration",
      label: "Betänketid",
      type: "slider",
      min: 10,
      max: 60,
      step: 10,
      default: 20,
    },
    {
      key: "rounds",
      label: "Antal rundor",
      type: "slider",
      min: 1,
      max: 5,
      step: 1,
      default: 3,
    },
  ],
  anti_match: [
    {
      key: "input_duration",
      label: "Betänketid",
      type: "slider",
      min: 10,
      max: 60,
      step: 10,
      default: 20,
    },
    {
      key: "rounds",
      label: "Antal rundor",
      type: "slider",
      min: 1,
      max: 5,
      step: 1,
      default: 3,
    },
  ],
}
