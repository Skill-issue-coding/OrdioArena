import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

/**
 * Theme state for the app. Ported from frontend/src/hooks/theme-provider.tsx.
 *
 * The class on <html> is set before first paint by THEME_INIT_SCRIPT in
 * routes/__root.tsx, not by this provider. That split matters under SSR: the
 * server has no localStorage and no matchMedia, so it cannot know the resolved
 * theme, and a provider that decided it during render would paint light and
 * then flip. The script owns the first paint; this provider owns everything
 * after it and exists so components can *read* the current mode.
 */
type Theme = 'dark' | 'light' | 'system'
type ResolvedTheme = 'dark' | 'light'

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  disableTransitionOnChange?: boolean
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)'
const THEME_VALUES: Array<Theme> = ['dark', 'light', 'system']

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(
  undefined,
)

function isTheme(value: string | null): value is Theme {
  if (value === null) return false

  return THEME_VALUES.includes(value as Theme)
}

function getSystemTheme(): ResolvedTheme {
  if (window.matchMedia(COLOR_SCHEME_QUERY).matches) return 'dark'

  return 'light'
}

/**
 * Suppresses transitions for one frame so a theme switch snaps instead of
 * cross-fading every colour on the page. The forced reflow is deliberate: it
 * flushes the stylesheet before the double rAF removes it again.
 */
function disableTransitionsTemporarily() {
  const style = document.createElement('style')
  style.appendChild(
    document.createTextNode(
      '*,*::before,*::after{-webkit-transition:none!important;transition:none!important}',
    ),
  )
  document.head.appendChild(style)

  return () => {
    window.getComputedStyle(document.body)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        style.remove()
      })
    })
  }
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'theme',
  disableTransitionOnChange = true,
  ...props
}: ThemeProviderProps) {
  // Always starts at defaultTheme, on the server *and* on the client's first
  // render, because those two have to produce identical markup or hydration
  // fails. Reading localStorage in this initialiser would satisfy the server
  // (guarded) and still break the client: a stored 'dark' would render 'dark'
  // against SSR's 'system'. The stored value arrives in the effect below.
  const [theme, setThemeState] = useState<Theme>(defaultTheme)

  // Nothing may touch <html> until the stored value is known. Until then the
  // class THEME_INIT_SCRIPT painted is the correct one, and overwriting it
  // with defaultTheme's resolution would flash the wrong theme for a frame.
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(storageKey)
    setThemeState(isTheme(storedTheme) ? storedTheme : defaultTheme)
    setHydrated(true)
  }, [defaultTheme, storageKey])

  const setTheme = useCallback(
    (nextTheme: Theme) => {
      window.localStorage.setItem(storageKey, nextTheme)
      setThemeState(nextTheme)
    },
    [storageKey],
  )

  const applyTheme = useCallback(
    (nextTheme: Theme) => {
      const root = document.documentElement
      const resolvedTheme =
        nextTheme === 'system' ? getSystemTheme() : nextTheme
      const restoreTransitions = disableTransitionOnChange
        ? disableTransitionsTemporarily()
        : null

      root.classList.remove('light', 'dark')
      root.classList.add(resolvedTheme)
      // Native controls and scrollbars follow this, not the class.
      root.style.colorScheme = resolvedTheme

      if (restoreTransitions) {
        restoreTransitions()
      }
    },
    [disableTransitionOnChange],
  )

  useEffect(() => {
    if (!hydrated) return undefined

    applyTheme(theme)

    if (theme !== 'system') return undefined

    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY)
    const handleChange = () => {
      applyTheme('system')
    }

    mediaQuery.addEventListener('change', handleChange)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [theme, applyTheme, hydrated])

  // Keeps two tabs in agreement. Without it, switching theme in one tab leaves
  // the other on its old class until a reload.
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage) return

      if (event.key !== storageKey) return

      if (isTheme(event.newValue)) {
        setThemeState(event.newValue)
        return
      }

      setThemeState(defaultTheme)
    }

    window.addEventListener('storage', handleStorageChange)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [defaultTheme, storageKey])

  const value = useMemo(
    () => ({
      theme,
      setTheme,
    }),
    [theme, setTheme],
  )

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error('useTheme must be used within a ThemeProvider')

  return context
}

export type { Theme }
