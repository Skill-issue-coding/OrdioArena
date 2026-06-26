import { Link } from "@tanstack/react-router"

export function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6">
      <p className="font-display font-bold text-8xl text-game-purple mb-4">404</p>
      <p className="font-display font-semibold text-xl text-foreground mb-2">Sidan hittades inte</p>
      <p className="font-display text-sm text-muted-foreground mb-8">Den här sidan finns inte eller har flyttats.</p>
      <Link to="/" className="font-display font-semibold text-sm text-game-purple hover:underline">
        Tillbaka till startsidan
      </Link>
    </div>
  )
}
