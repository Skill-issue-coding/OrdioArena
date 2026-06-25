import type { ComponentType } from "react"
import type { LucideIcon } from "lucide-react"

export interface GuideStepProps {
  onNext?: () => void
}

export interface GuideStep {
  id: string
  title: string
  icon: LucideIcon
  component: ComponentType<GuideStepProps>
}

export interface ModeInfo {
  mode: string
  label: string
  description: string
  cssVar: string
  icon: LucideIcon
}

export interface GameModeGuide extends ModeInfo {
  steps: GuideStep[]
}
