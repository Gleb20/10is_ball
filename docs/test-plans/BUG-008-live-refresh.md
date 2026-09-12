# BUG-008 — visibility-aware live refresh

## Scope

- Home, match/tournament lists and active details use one 30-second visible-only
  client refresh strategy.
- Hidden → visible performs one immediate sync and starts one timer.
- In-flight timer/manual/visibility requests coalesce; unmount cleans up.
- Terminal details stop polling; manual refresh/retry remains available.
- A background error preserves the last valid screen.
- JudgePage retains the dedicated BUG-004/005 heartbeat+match loop.

## Non-goals

- WebSocket/SSE/server push, generic auth 401 handling, form submission policy,
  judge lifecycle redesign, production changes, deploy or version bump.

## Deterministic Red / Green matrix

| Level | Scenario | Evidence |
|---|---|---|
| Component/fake timer | 30-second visible cadence; hidden pause; one immediate resume; no duplicate timer; cleanup | `useVisibleRefresh.test.tsx` |
| Component/fake timer | overlapping manual/timer refresh coalesces; disabled polling still permits retry | `useVisibleRefresh.test.tsx` |
| Component/fake timer | changing a detail resource key starts the new request without waiting for the old route | `useVisibleRefresh.test.tsx` |
| Component | active match/tournament refresh to terminal and stop polling | `LiveStatePages.test.tsx` |
| Component | Home initial error retry; match/tournament lists refresh without navigation | `LiveStatePages.test.tsx` |
| Regression | Match/tournament actions and BUG-004/005 JudgePage remain green | existing page suites |
| Browser | desktop Home reflects a second-client match transition | local in-app Browser |
| Browser | 390×844 tournament detail reflects a second-client transition without overflow | local in-app Browser |

## Commands

- `pnpm --filter @tab10/web test -- src/useVisibleRefresh.test.tsx src/pages/LiveStatePages.test.tsx src/pages/MatchDetailPage.test.tsx src/pages/TournamentDetailPage.algorithm.test.tsx`
- `pnpm --filter @tab10/web typecheck`
- `pnpm --filter @tab10/web test`
- Node 24 `pnpm run ci`

## Actual evidence — 2026-09-07

- Pre-fix Red: focused suite failed to resolve the absent shared refresh module.
- Focused Green: 20/20; web typecheck passed.
- Local Browser at `http://localhost:5173`: two authenticated tabs on desktop
  showed Home `Ожидание → Идёт` after a match start in the second tab. At 390×844,
  tournament detail changed `Сбор → Отменён` after cancellation in the second tab;
  `scrollWidth === innerWidth === 390`. Page identity, nonblank content, no error
  overlay and target interactions passed. Console had only known React Router v7
  future warnings.
- Item bundled Node 24.19.0 / pnpm 9.15.0 `pnpm run ci`: green — docs,
  routes, secrets and busy-bye audits; lint/typecheck; shared 518, test-utils 4,
  web 97, API 128 + 7 guarded real-PostgreSQL skips; API/web builds. The existing
  Vite large-chunk warning remains.
- Combined root verification through BUG-006/007/008/009/010/014: Node 24.19.0
  `pnpm run ci` green; shared 522, test-utils 4, web 111, API 131 + 7 guarded
  PostgreSQL skips, audits/lint/typecheck and both builds green.

Residual: production/release not run; no server push by design. JudgePage remains
covered by its separate BUG-004/005 plan and loop.
