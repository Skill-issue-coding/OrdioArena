import { Loader2 } from "lucide-react"

export function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6">
      <Loader2 className="w-10 h-10 mb-4 animate-spin text-game-purple" />
      <p className="flex font-semibold font-display text-muted-foreground">
        Laddar
        <span className="flex w-6">
          <span className="animate-[loading_1.4s_infinite] ml-0.5">.</span>
          <span className="animate-[loading_1.4s_infinite_0.2s] ml-0.5">.</span>
          <span className="animate-[loading_1.4s_infinite_0.4s] ml-0.5">.</span>
        </span>
      </p>
    </div>
  )
}
