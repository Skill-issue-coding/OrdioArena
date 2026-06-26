import { motion } from "motion/react"
import type { ReactNode } from "react"

interface PhaseTransitionProps {
  phaseKey: string
  children: ReactNode
}

const PhaseTransition = ({ phaseKey, children }: PhaseTransitionProps) => (
  <motion.div
    key={phaseKey}
    initial={{ opacity: 0, y: 24, scale: 0.96 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: -24, scale: 0.96 }}
    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    className="flex w-full flex-col items-center"
  >
    {children}
  </motion.div>
)

export default PhaseTransition
