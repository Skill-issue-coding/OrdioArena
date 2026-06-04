Host goes back to lobby changes mode, client 2 stays on result page

client 2 gets this error and gets disconnected

## Error Type

Console Error

## Error Message

The final argument passed to useEffect changed size between renders. The order and size of this array must remain constant.

Previous: []
Incoming: [[object Object]]

    at createConsoleError (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_0ifwd0~._.js:2873:71)
    at handleConsoleError (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_0ifwd0~._.js:3659:54)
    at console.error (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_0ifwd0~._.js:3806:57)
    at areHookInputsEqual (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_react-dom_058-ah~._.js:4604:56)
    at updateEffectImpl (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_react-dom_058-ah~._.js:5300:50)
    at Object.useEffect (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_react-dom_058-ah~._.js:15568:13)
    at exports.useEffect (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_0.4_mz-._.js:1722:36)
    at FinalScorePhase (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/_0k3l1db._.js?id=%255Bproject%255D%252Fcomponents%252Fgame%252Fantimatch%252FFinalScorePhase.tsx+%255Bapp-client%255D+%2528ecmascript%2529:75:180)
    at Object.react_stack_bottom_frame (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_react-dom_058-ah~._.js:15037:24)
    at renderWithHooksAgain (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_react-dom_058-ah~._.js:4675:24)
    at renderWithHooks (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_react-dom_058-ah~._.js:4626:28)
    at updateFunctionComponent (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_react-dom_058-ah~._.js:6081:21)
    at beginWork (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_react-dom_058-ah~._.js:6691:24)
    at runWithFiberInDEV (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_react-dom_058-ah~._.js:965:74)
    at performUnitOfWork (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_react-dom_058-ah~._.js:9555:97)
    at workLoopSync (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_react-dom_058-ah~._.js:9449:40)
    at renderRootSync (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_react-dom_058-ah~._.js:9433:13)
    at performWorkOnRoot (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_react-dom_058-ah~._.js:9061:186)
    at performSyncWorkOnRoot (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_react-dom_058-ah~._.js:10263:9)
    at flushSyncWorkAcrossRoots_impl (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_react-dom_058-ah~._.js:10179:316)
    at flushSyncWork$1 (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_react-dom_058-ah~._.js:9230:86)
    at Object.scheduleRefresh (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_react-dom_058-ah~._.js:299:13)
    at <unknown> (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_0.4_mz-._.js:391:33)
    at Set.forEach (<anonymous>:null:null)
    at Object.performReactRefresh (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_0.4_mz-._.js:384:38)
    at applyUpdate (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_0.4_mz-._.js:878:31)
    at <unknown> (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_dist_compiled_0.4_mz-._.js:886:13)
    at ResultPage (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/_0k3l1db._.js:3289:237)
    at ClientPageRoot (file:///Users/emildjurson/Documents/GitHub/WordGame - TDDD27 Project/client/.next/dev/static/chunks/node_modules_next_0jgxde0._.js:4620:50)

Next.js version: 16.2.6 (Turbopack)
