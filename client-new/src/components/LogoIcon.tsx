type LogoVariant = "original" | "v1" | "v2" | "v3"

const srcMap: Record<LogoVariant, string> = {
  original: "/ordioarena.svg",
  v1: "/logo-v1.svg",
  v2: "/logo-v2.svg",
  v3: "/logo-v3.svg",
}

export function LogoIcon({ className, variant = "original" }: { className?: string; variant?: LogoVariant }) {
  return <img src={srcMap[variant]} className={className} alt="OrdioArena" />
}
