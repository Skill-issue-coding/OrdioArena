import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import { ThemeProvider } from '#/hooks/theme-provider'
import { Background } from '#/components/background/Background'
import appCss from '../styles.css?url'

/**
 * Runs before first paint, ahead of React and ahead of the stylesheet's own
 * cascade, so the page never renders light and then flips to dark. It is the
 * only theme code that can do this: the server cannot read localStorage, and
 * anything React does happens after the first frame.
 *
 * Kept in sync with ThemeProvider by hand — same storage key, same three
 * values, same resolution rule. A mismatch shows up as exactly one frame of
 * the wrong theme, which is easy to miss and annoying to trace.
 */
const THEME_INIT_SCRIPT = `(function(){try{var s=window.localStorage.getItem('theme');var mode=(s==='light'||s==='dark'||s==='system')?s:'system';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='system'?(prefersDark?'dark':'light'):mode;var r=document.documentElement;r.classList.remove('light','dark');r.classList.add(resolved);r.style.colorScheme=resolved;}catch(e){}})();`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'OrdioArena',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: THEME_INIT_SCRIPT mutates <html>'s class and
    // colorScheme before React hydrates, so the server markup deliberately
    // does not match. Scoped to this element only.
    <html lang="sv" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      {/* Font and antialiasing come from the base layer in styles.css. */}
      <body className="h-full wrap-anywhere">
        <ThemeProvider>
          {children}
          <Background />
        </ThemeProvider>
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
