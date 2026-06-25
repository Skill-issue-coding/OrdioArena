# Porting from [NextJS](../client) to Vite

## Styling

| NextJS File       | Done | New File        | Notes                        |
| ----------------- | :--: | --------------- | ---------------------------- |
| `app/globals.css` |  ✓   | `src/index.css` |                              |
| `app/layout.tsx`  |  ✓   | `src/main.tsx`  | Fonts via fontsource instead |

## Routing & Pages

| NextJS File                                  | Done | New File                        | Notes |
| -------------------------------------------- | :--: | ------------------------------- | ----- |
| `app/page.tsx`                               |  ✓   | `pages/HomePage.tsx`            |       |
| `app/loading.tsx`                            |  ✓   | `components/LoadingSpinner.tsx` |       |
| `app/not-found.tsx`                          |  ✓   | `components/NotFound.tsx`       |       |
| `app/lobby/[lobbyCode]/page.tsx`             |  ✓   | `pages/LobbyPage.tsx`           |       |
| `app/lobby/[lobbyCode]/layout.tsx`           |  ✓   | `router.tsx`                    |       |
| `app/lobby/[lobbyCode]/game/page.tsx`        |  –   |                                 |       |
| `app/lobby/[lobbyCode]/game/layout.tsx`      |  ✓   | `router.tsx`                    |       |
| `app/lobby/[lobbyCode]/game/result/page.tsx` |  –   |                                 |       |

## Hooks

| NextJS File                  | Done | New File                       | Notes                            |
| ---------------------------- | :--: | ------------------------------ | -------------------------------- |
| `hooks/lobbycontext.tsx`     |  ✓   | `hooks/lobby/Hook.tsx`         | Probably need to rework the hook |
| `hooks/newgamecontext.tsx`   |  ✓   | `hooks/game/Hook.tsx`          |                                  |
| `hooks/gamecontext.tsx`      |  ✓   | `hooks/game/types.ts` + shared | Split across type files          |
| `hooks/timers.tsx`           |  ✓   | `hooks/game/timers/Timers.tsx` |                                  |
| `hooks/usercontext.tsx`      |  ✓   | `hooks/user/Hook.tsx`          |                                  |
| `hooks/websocketcontext.tsx` |  ✓   | `hooks/websocket/Hook.tsx`     |                                  |

## Components

| NextJS File                                      | Done | New File                            | Notes    |
| ------------------------------------------------ | :--: | ----------------------------------- | -------- |
| `components/background/background.tsx`           |  ✓   | `components/Background.tsx`         |          |
| `components/home/HomeView.tsx`                   |  ✓   | `pages/HomePage.tsx`                |          |
| `components/lobby/CodeDisplay.tsx`               |  ✓   | `components/lobby/CodeDisplay.tsx`  |          |
| `components/lobby/GameModeCard.tsx`              |  ×   |                                     | Not used |
| `components/lobby/GameSettings.tsx`              |  ✓   | `components/lobby/GameSettings.tsx` |          |
| `components/lobby/LobbyChat.tsx`                 |  ✓   | `components/lobby/LobbyChat.tsx`    |          |
| `components/lobby/LobbyView.tsx`                 |  ✓   | `pages/LobbyPage.tsx`               |          |
| `components/lobby/PlayerList.tsx`                |  ✓   | `components/lobby/PlayerList.tsx`   |          |
| `components/lobby/QuickGuide.tsx`                |  ✓   | `components/lobby/QuickGuide.tsx`   |          |
| `components/game/CountdownBar.tsx`               |  –   |                                     |          |
| `components/game/GameView.tsx`                   |  –   |                                     |          |
| `components/game/GetReadyScreen.tsx`             |  –   |                                     |          |
| `components/game/PhaseTransition.tsx`            |  –   |                                     |          |
| `components/game/gamemodes/AntiMatchView.tsx`    |  –   |                                     |          |
| `components/game/gamemodes/ContextoGameView.tsx` |  –   |                                     |          |
| `components/game/gamemodes/MainImposterView.tsx` |  –   |                                     |          |
| `components/game/gamemodes/SynonymDuelView.tsx`  |  –   |                                     |          |
| `components/game/impostor/DiscussionPhase.tsx`   |  –   |                                     |          |
| `components/game/impostor/InputPhase.tsx`        |  –   |                                     |          |
| `components/game/impostor/IntermediatePhase.tsx` |  –   |                                     |          |
| `components/game/impostor/ResultPhase.tsx`       |  –   |                                     |          |
| `components/game/impostor/RevealPhase.tsx`       |  –   |                                     |          |
| `components/game/impostor/StatsDialog.tsx`       |  –   |                                     |          |
| `components/game/impostor/VotePhase.tsx`         |  –   |                                     |          |
| `components/game/antimatch/FinalScorePhase.tsx`  |  –   |                                     |          |
| `components/game/antimatch/InputPhase.tsx`       |  –   |                                     |          |
| `components/game/antimatch/RoundResultPhase.tsx` |  –   |                                     |          |
| `components/user/UserProfileButton.tsx`          |  ✓   |                                     |          |
| `components/themed-toaster.tsx`                  |  ✓   | `components/themed-toaster.tsx`     |          |

## Lib

| NextJS File                       | Done | New File                            | Notes             |
| --------------------------------- | :--: | ----------------------------------- | ----------------- |
| `lib/utils.ts`                    |  ✓   | `lib/utils.ts`                      |                   |
| `lib/try-catch.ts`                |  ✓   | `lib/try-catch.ts`                  |                   |
| `lib/animation-util.ts`           |  ✓   | `lib/animation-utils.ts`            |                   |
| `lib/chart-colors.ts`             |  ✓   | `lib/game/chart-colors.ts`          |                   |
| `lib/toast-functions.tsx`         |  ✓   | `lib/ToastFunctions.tsx`            |                   |
| `lib/game/gameModes.ts`           |  ✓   | `lib/game/config.ts`                |                   |
| `lib/game/game.ts`                |  –   |                                     |                   |
| `lib/game/lobby.ts`               |  –   |                                     |                   |
| `lib/game/user.ts`                |  ✓   | `hooks/user/types.ts`               | Moved to hooks    |
| `lib/game/antimatch-types.ts`     |  ✓   | `hooks/game/antimatch/types.ts`     | Moved to hooks    |
| `lib/game/impostor-types.ts`      |  ✓   | `hooks/game/impostor/types.ts`      | Moved to hooks    |
| `lib/game/new-antimatch-types.ts` |  ✓   | `hooks/game/antimatch/types.ts`     | Merged with above |
| `lib/game/new-impostor-types.ts`  |  ✓   | `hooks/game/impostor/types.ts`      | Merged with above |
| `lib/websocket/types.ts`          |  ✓   | `hooks/websocket/types.ts`          | Moved to hooks    |
| `lib/websocket/game/antimatch.ts` |  ✓   | `hooks/websocket/game/antimatch.ts` | Moved to hooks    |
| `lib/websocket/game/impostor.ts`  |  ✓   | `hooks/websocket/game/impostor.ts`  | Moved to hooks    |
| `lib/websocket/game/shared.ts`    |  ✓   | `hooks/game/shared.ts`              | Moved to hooks    |
| `lib/websocket/lobby.ts`          |  ✓   | `hooks/lobby/types.ts`              | Moved to hooks    |
