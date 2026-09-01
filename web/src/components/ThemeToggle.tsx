import { useTheme } from '#/hooks/theme-provider'
import type { Theme } from '#/hooks/theme-provider'

const NEXT_MODE: Record<Theme, Theme> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
}

const LABEL: Record<Theme, string> = {
  light: 'Ljust',
  dark: 'Mörkt',
  system: 'System',
}

/**
 * Cycles light → dark → system. Holds no theme state of its own: the class on
 * <html>, the localStorage write and the system-preference listener are all
 * ThemeProvider's job, so there is exactly one place where a theme is decided.
 */
export default function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  const label =
    theme === 'system'
      ? 'Tema: system. Klicka för att välja ljust.'
      : `Tema: ${LABEL[theme].toLowerCase()}. Klicka för att byta.`

  return (
    <button
      type="button"
      onClick={() => setTheme(NEXT_MODE[theme])}
      aria-label={label}
      title={label}
      className="border-border bg-card text-foreground btn-3d rounded-full border-2 px-3 py-1.5 text-sm font-semibold transition hover:-translate-y-0.5"
    >
      {LABEL[theme]}
    </button>
  )
}
