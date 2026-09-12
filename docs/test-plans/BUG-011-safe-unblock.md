# BUG-011 — safe admin unblock

## Scope

- Backlog: `BUG-011`.
- Requirements: `ADM-001`, `ADM-005`, `ADM-006`, `ADM-008`.
- Acceptance/decision: `AT-ADM-003`, `AT-ADM-006`, `AT-AUTH-004`,
  `AT-AUTH-008`, `D28`.
- Outcome: active admin can unblock a blocked target from the UI; self/last-admin
  protections and block-session revocation remain server-enforced.

## Non-goals and permissions

- Excludes ADM search/filter/profile edit, password-reset redesign, captain
  transfer atomicity, deployment, versioning and production/external mutation.
- Uses only repository edits, disposable in-memory PGlite and a disposable local
  browser fixture.

## Red evidence

1. `AdminPage.test.tsx`: self row exposed Block and blocked row had no Unblock.
2. `auth.integration.test.ts`: with a second active admin, direct self-block
   returned `200` and revoked the actor session instead of rejecting it.
3. Initial test command was correctly refused under shell Node 20 by the repo
   `24.x` engine; all behavioral Red/Green evidence uses bundled Node 24.19.0 and
   pnpm 9.15.0.

## Deterministic verification matrix

| Layer | Cases | Gate |
|---|---|---|
| Component | active→Block, blocked→Unblock, self hides Block/role change, explicit confirmation, single-flight, failure preserves context | `AdminPage.test.tsx` |
| API/PGlite | active-admin happy paths, active non-admin 403, revoked session 401, self 403, sole admin 409, block/unblock audit, old session remains revoked, fresh login succeeds | `auth.integration.test.ts` |
| Browser desktop | `/admin`, 1280×800, blocked status/action, self safeguards, confirmation and active result | required |
| Browser mobile | same flow at 390×844 plus horizontal overflow and console check | required |
| Quality | web/API typecheck, focused suites, `git diff --check`, docs audit, full Node 24 `pnpm run ci` | required |

## Evidence

- Focused Green: AdminPage 8/8; auth/admin integration 11/11; web/API typechecks
  passed on Node 24.19.0.
- Browser Green: in-app Browser on local ephemeral API at 1280×800 and 390×844;
  status-specific action, self guard, confirmation copy and server-refetched
  active state passed. Mobile `scrollWidth === innerWidth === 390`; no framework
  overlay/app error. Only known React Router v7 future warnings were logged.
- Full CI: combined Node 24.19.0 `pnpm run ci` exited 0 — docs 59, shared
  522, test-utils 4, web 116, API 136 passed + 7 guarded real-PostgreSQL skips;
  audits, lint, typecheck and API/web builds green. The known Vite large-chunk
  warning remains.

## Residual risk

- Production release/smoke is not authorized and remains unverified.
- Full ADM search/filter/edit/audit UI remains `GAP-010`.
- Browser evidence is local Chromium-based in-app coverage, not Safari/Firefox or
  a durable end-to-end suite.
