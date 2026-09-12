# BUG-004/005 — judge exit and live-lock lifecycle

## Scope

- Back, setup Cancel and explicit exit await one best-effort judge release before route navigation and surface success or warning at the destination.
- Unmount/crash does not pretend to guarantee release; the documented 120-second TTL remains the fallback.
- Visible setup/scoring sends heartbeat and refreshes authoritative match on the 30-second cadence.
- Hidden documents run neither heartbeat nor judge polling; visible resume performs one immediate sync and starts one timer.
- Heartbeat `401`, `403`, `409`, `JUDGE_NOT_ACTIVE` or `JUDGE_REQUIRED` enters an explicit lost-lock state, clears queued score intents and disables score/Undo/finish actions.
- External terminal match state switches to read-only.

## Non-goals

- Server point transaction or BUG-003 FIFO semantics changes.
- Handover, WebSocket/SSE, generic runtime-401 redirect (BUG-007), redesign, production changes or release work.

## Deterministic Red / Green matrix

| Level | Scenario | Evidence |
|---|---|---|
| Component | Cancel waits for release; success notice after navigation | `JudgePage.test.tsx` |
| Component | Back waits for release | `JudgePage.test.tsx` |
| Component | Explicit release failure still navigates with warning | `JudgePage.test.tsx` |
| Component | Plain unmount does not call release | `JudgePage.test.tsx` |
| Component | Heartbeat 401/403/409 enters lost-lock, syncs score and hides mutations | `JudgePage.test.tsx` |
| Component | External terminal state becomes read-only | `JudgePage.test.tsx` |
| Component | hidden→visible immediate sync, one timer, cleanup | `JudgePage.test.tsx` |
| API/PGlite | Missing auth returns 401; expired/released lock returns 409 `JUDGE_NOT_ACTIVE`; another judge can acquire after release | `domain.integration.test.ts` |
| Browser | desktop and 390×844 exit/lost-lock rendering; two-client reacquire if fixture supports it | local Browser screenshots outside repo |

## Commands

- `corepack pnpm --filter @tab10/web test -- src/pages/JudgePage.test.tsx`
- `corepack pnpm --filter @tab10/api test -- src/domain.integration.test.ts`
- `corepack pnpm --filter @tab10/web typecheck`
- `corepack pnpm --filter @tab10/api typecheck`
- Node 24 `corepack pnpm run ci`

## Actual evidence — 2026-09-07

- Pre-fix Red: 8 of 18 focused web cases failed only for new lifecycle/live-sync expectations; API heartbeat expiry expected 409 but returned 400.
- Focused Green: `JudgePage.test.tsx` 18/18; `layout.test.tsx` is included in full web 87/87; API `domain.integration.test.ts` 32/32; API/web typechecks passed.
- Local in-app Browser at `http://localhost:5173`: 1280×800 Cancel, Back and explicit exit released the slot and showed destination success; 390×844 second-auth external cancel produced lost-lock with authoritative cancelled state and no score/Undo actions.
- Release failure and plain unmount are deterministic component checks; no production/external service was changed.
- Full bundled Node 24.19.0 `corepack pnpm run ci`: docs/audits, lint, typecheck, shared 518, test-utils 4, web 87, API 124 + 5 guarded PostgreSQL skips, and both builds passed. Existing Vite large-chunk warning remains. Bare pnpm 9.15.0 `pnpm ci` is not implemented and returned `ERR_PNPM_CI_NOT_IMPLEMENTED`; the repository script is the canonical gate.

Residual: browser/system Back, unload and crash deliberately rely on the 120-second TTL; handover and full two-human judge journey remain outside this item.

## Integration review — 2026-09-13

Queued score with already-open More menu now closes the menu and blocks release until the queue drains. A heartbeat 409 followed by authoritative terminal state renders readonly. Deterministic Red reproduced both failures; focused combined API-client/JudgePage suite23 and full web128 passed. Independent re-review passed the same23 tests. Browser gate remains pending.
