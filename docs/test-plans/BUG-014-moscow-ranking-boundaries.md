# BUG-014 — Moscow ranking boundaries

## Scope

- Backlog: BUG-014.
- Decision and requirements: D20, RANK-002, AT-RANK-002.
- User-visible outcome: weekly and monthly ranking switch at `00:00
  Europe/Moscow`, independently of browser or API host timezone.
- Non-goals: team/public-profile GAP-004, generic timestamp/default-title
  formatting (BUG-016), production/deploy/version bump.
- Permissions: local code, tests, docs and disposable PGlite only.
- Open questions: none.

## Red evidence

- Add table cases immediately before and at Moscow Monday/month boundaries.
- Expected initial result: all six cases fail because explicit Moscow helpers do
  not exist and the old helpers return UTC midnight.

## Green verification

1. Run shared ranking tests with host TZ `UTC`, `America/Los_Angeles` and
   `Asia/Tokyo`; all runs must return identical ISO instants.
2. Run PGlite API integration for `period=week` and `period=month`; a finished
   match one millisecond before the boundary must be excluded and a match exactly
   at the boundary must be included.
3. Run shared and API typechecks.
4. Run repository-wide `pnpm run ci` because the shared ranking contract crosses
   package boundaries.
5. Run documentation, route inventory and whitespace/conflict-marker checks.

## Evidence status

- Red: 6/6 expected failures captured.
- Focused Green: shared 13/13 in each of three host timezones; PGlite API 2/2;
  shared/API typechecks green.
- Combined CI: pending.
