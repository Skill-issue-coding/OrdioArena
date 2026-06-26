# Project Context & AI Coding Guidelines

You are an expert full-stack developer specializing in modern React ecosystems.
Below are the strict technical boundaries and architectural patterns for this project.

## Core Tech Stack

- **Framework:** React 19
- **Language:** TypeScript 6 (Strict Mode)
- **Build Tool:** Vite 8 (ESM)
- **Routing:** TanStack Router (`@tanstack/react-router` v1)
- **Styling:** Tailwind CSS v4
- **UI Components:** Shadcn UI + Radix UI
- **Animations:** Motion (`motion` v12) + TW Animate CSS
- **Icons:** Lucide React (`lucide-react`)
- **Network:** Axios
- **Notifications:** Sonner

## Development Rules & Conventions

### 1. React 19 & TypeScript

- Write modern React 19 code. Utilize new hooks and features where appropriate, and avoid deprecated React 18 patterns.
- Always use strict TypeScript. Define precise interfaces/types for all component props, API responses, and state.
- Avoid `any`. Use `unknown` if the type is truly dynamic, and narrow it down.
- Prefer functional components with arrow functions.

### 2. Routing (TanStack Router)

- **CRITICAL:** Do NOT use `react-router-dom`. All routing must strictly follow `@tanstack/react-router` conventions.
- Utilize type-safe routing, `Link` components, and route definitions specific to TanStack Router.

### 3. Styling & UI (Tailwind v4 + Shadcn)

- **CRITICAL:** This project uses **Tailwind CSS v4**. Do not generate `tailwind.config.js` or `postcss.config.js` files unless explicitly asked. Rely on CSS variables and v4 utility patterns.
- For conditional classes, always use the `cn` utility (which wraps `clsx` and `tailwind-merge`).
- Build UIs using Shadcn UI patterns and Radix UI primitives.
- Use `@fontsource-variable/figtree` and `@fontsource-variable/space-grotesk` for typography.

### 4. Animations & Icons

- For complex animations, use the modern `motion` package (do not import from `framer-motion` unless required by specific API changes in v12).
- For simple CSS animations, utilize Tailwind utilities and `tw-animate-css`.
- Exclusively use `lucide-react` for icons.

### 5. Formatting & Linting

- The project uses ESLint v10 and Prettier. Ensure all generated code adheres to standard Prettier formatting.
- Write clean, self-documenting code. Keep components small and focused.

### 6. Navigation (TanStack Router)

- **NEVER** import from `next/navigation`. This is **not** Next.js.
- Navigation: `import { useNavigate } from "@tanstack/react-router"` → `const navigate = useNavigate()` → `navigate({ to: "/path" })`.
- No routes are defined yet — route tree (`routeTree.gen.ts`) has not been generated. String paths work but are not type-safe until routes are scaffolded.

### 7. Animations (`motion` v12)

- Import types from `motion/react`, **not** `framer-motion`. Example: `import type { MotionProps } from "motion/react"`.

### 8. No `"use client"` Directives

- **Never** add `"use client"` — that is a Next.js/RSC directive. This project is plain Vite + React 19 (client-only). All components are client components by default.

### 9. Hook & WebSocket Type Architecture

Each domain under `src/hooks/<domain>/` has a `Hook.tsx` (context provider + consumer hooks) and `types.ts` (domain types).

WS event types under `src/hooks/websocket/`:

- `types.ts` — master union (`WSReceivedEvent`, `WSReceivedPayloadMap`, `WSSendPayloadMap`, `WSSendEventType`)
- `game/impostor.ts` — `ImpostorWSReceivedEvent` union (S→C)
- `game/antimatch.ts` — `AntiMatchWSReceivedEvent` union (S→C)
- Lobby WS events (`LobbyWSReceivedEvent`, `LobbyWSSendPayloadMap`) live in `hooks/lobby/types.ts`
- C→S game events (`GameWSSendPayloadMap`) live in `hooks/game/shared.ts`

`SendMessageType` must constrain on `WSSendEventType` (string key), **not** `WSSendEvent` (full union object):

```ts
export type SendMessageType = <T extends WSSendEventType>(type: T, payload: WSSendPayloadMap[T]) => void
```

### 10. Environment Variables

- Use `import.meta.env.VITE_*` — **not** `process.env.NEXT_PUBLIC_*`.
- WS URL: `VITE_WS_PATH`, backend URL: `VITE_PUBLIC_BACKEND_PATH`.
