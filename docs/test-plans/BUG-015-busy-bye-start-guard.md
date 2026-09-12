# BUG-015 — busy player with bye tournament-start guard

## Scope

- Backlog: BUG-015.
- Requirements: TOURNAMENT-012/013 and AT-TRN-009/020.
- User-visible outcome: a busy registered organizer or participant cannot bypass
  the one-active-match invariant by receiving a bye.
- Non-goals: DB-level/concurrent cross-event exclusivity, bracket redesign,
  production/deploy/version bump.
- Permissions: local code, tests, docs and disposable PGlite only.
- Open questions: none.

## Red evidence

1. Generate a three-player compact SE bracket with a fixed RNG that places the
   busy organizer in the bye seed.
2. Expect HTTP 400 `PLAYER_ALREADY_IN_ACTIVE_MATCH` and unchanged tournament
   state.
3. Before the service change, the focused test returned HTTP 200 and failed the
   first acceptance assertion.

## Green / regression matrix

| Busy registered player | Opening position | Evidence |
|---|---|---|
| participating organizer | deterministic bye | AT-TRN-020 PGlite API test + audit command |
| participant, non-playing organizer | deterministic bye | AT-TRN-020 PGlite API test |
| organizer in opening pair | non-bye | existing AT-ADM-MATCH-003 / AT-MATCH-CANCEL-001 paths |

Every bye rejection checks status=`bracket_generated`, null `startedAt`, unchanged
bracket JSON/version and zero tournament matches. The full domain suite verifies
normal V1/V2 starts and start-after-standalone-release regressions.

## Gates

1. Focused AT-TRN-020 matrix and `pnpm audit:reproduce-busy-bye`.
2. Full `domain.integration.test.ts` and API typecheck.
3. Repository-wide Node 24 `pnpm run ci` because start materializes shared
   tournament/match state.
4. Documentation audit and `git diff --check`.
5. Guarded real-PostgreSQL focused execution when a disposable
   `TEST_DATABASE_URL` is available; do not use production.

## Evidence status

- Red: 1/1 expected failure captured (HTTP 200 received instead of 400).
- Focused Green: AT-TRN-020 2/2; audit command green; full domain 33/33; API
  typecheck green.
- Full Node 24.19.0 CI: combined `pnpm run ci` exited 0 — docs 59, shared 522,
  test-utils 4, web 116, API 136 passed + 7 guarded real-PostgreSQL skips;
  audits, lint, typecheck and API/web builds green.
- Real PostgreSQL: skipped; no disposable `TEST_DATABASE_URL` was available.
