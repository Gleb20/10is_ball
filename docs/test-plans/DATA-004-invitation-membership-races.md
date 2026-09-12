# DATA-004 — invitation and membership races

## Scope and expected outcome

- Requirements: TEAM-004/005, TOURNAMENT-005/007/018, NOTIF-001/002/005/006.
- Acceptance: AT-TEAM-001/002/007, AT-TRN-004/019, AT-NOTIF-001/002/003/005.
- One pending invitation and one active user membership/participant may exist for
  each team/tournament + user pair.
- Invite replay returns the existing pending invitation without a second
  notification. Respond replay returns the committed terminal outcome.
- Invite, response/membership, expiry, and their notification lifecycle change
  are atomic. Rejection by the wrong actor/entity has no side effects.
- Expired and cancelled invitation notifications are neither actionable nor new.

## Non-goals and permissions

- No UI redesign, generic notification model redesign, production migration,
  deploy, external Neon branch, commit, tag, push, or version bump.
- Only disposable PGlite and a guarded loopback `TEST_DATABASE_URL` may be
  mutated. Absence of the latter is reported as skipped.

## Deterministic verification

1. Red: parallel same-pair invite/accept and direct-add/accept reproduce duplicate
   rows; an injected notification failure exposes partial invitation/membership
   state; expired/cancelled notifications remain new.
2. Migration: fresh and historical migration paths produce four partial unique
   indexes after deterministic duplicate cleanup.
3. Green PGlite: parallel results converge to one row, retries are stable, fault
   injection rolls back every related row, wrong actor/user/entity is a no-op,
   and notification list/home inputs exclude terminal invites.
4. Guarded PostgreSQL: repeat the same concurrent pair invariants on an explicitly
   disposable loopback test database.
5. Run focused API tests and typecheck, then full repository `pnpm run ci` on
   Node 24. (`pnpm ci` is not a pnpm command in this repository.)

## Evidence 2026-09-07

- Red: `data-004.integration.test.ts` failed 4/4 before the fix: duplicate team
  and tournament invitation IDs, two active team memberships, and an expired
  notification still reported as `new`.
- Green: DATA-004 PGlite 4/4; migration/schema-drift 4/4; notification component
  1/1; API and web typechecks passed.
- Integrated: bundled Node 24.19.0 with pnpm 9.15.0, full `pnpm run ci` passed
  docs/routes/secrets/busy-bye audits, lint, typecheck, shared 518, test-utils 4,
  web 79, API 127 with 7 guarded PostgreSQL tests skipped, and API/web builds.
- PostgreSQL: `TEST_DATABASE_URL` was absent, so the two DATA-004 real-PostgreSQL
  concurrency cases were reported as skipped. No external Neon branch,
  production migration, configuration change, or deploy was performed.
