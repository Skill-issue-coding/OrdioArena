import { RoundResultPhase } from "@/components/game/antimatch/RoundResultPhase";
import { AnimatePresence } from "framer-motion";

export default function TestPage() {
  return (
    <div className="w-full px-8 pt-5">
      <div className="w-full space-y-6">
        <AnimatePresence mode="wait">
          <RoundResultPhase key="round-result" />
        </AnimatePresence>
      </div>
    </div>
  );
}
