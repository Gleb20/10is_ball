# BUG-006/009 — action errors and duplicate-submit resilience

## Scope and contracts

- Backlog: BUG-006, BUG-009.
- Requirements/acceptance: общие UI rules; AUTH-004, ADM-003, TEAM-001/004/005,
  TOURNAMENT-001/005, HELP-003, ONB-001/003; AT-UI-001/002,
  AT-TEAM-007, AT-TRN-019.
- User outcome: failed match action leaves loaded match context visible; scoped
  critical submits/actions issue one request and expose a disabled pending state.
- Server backstop: normalized user email remains unique and concurrent duplicate
  create returns `409 EMAIL_ALREADY_EXISTS`; DATA-004 invite/respond convergence
  remains one invitation, membership/participant transition and notification.
- Non-goals: new create idempotency schema/contracts, BUG-007/008, full product
  flow completion, redesign, production/external mutations, deployment, commit,
  push, tag or version bump.

## Red evidence

1. `SubmissionGuards.test.tsx` and `AdminPage.test.tsx`: sync double-submit called
   admin/team/tournament/feedback APIs twice; onboarding called tutorial twice and
   allowed competing skip.
2. `MatchDetailPage.test.tsx`: rejected Stop was bound to the page-wide error
   state, so the expected loaded title/score plus local alert could not coexist.
3. `auth.integration.test.ts`: two concurrent case-insensitive create-user
   requests produced `[200, 500]` despite `users_email_unique`.

## Deterministic component matrix

| Surface | Trigger | Expected while pending | Expected after reject/resolve |
|---|---|---|---|
| Match detail Stop | two sync clicks | one API call; submit disabled | local alert; loaded title/score stay visible; retry enabled |
| Admin create user | two sync submits | one API call; `Создание…` disabled | form re-enabled; normal success/error contract |
| Team/tournament create | two sync submits | one API call; `Создание…` disabled | retry or navigation after settle |
| First password | two sync submits | one API call; `Сохранение…` disabled | validation/error retained or onboarding navigation |
| Feedback | two sync submits | one API call; `Отправка…` disabled | local alert or success without losing FAQ |
| Onboarding | tutorial double click + skip | only tutorial request; both CTAs disabled | navigation or local alert |
| Invitation response | accept double click | one response request; response CTAs disabled | refreshed authoritative list or local alert |
| Tournament detail actions | competing sync action | shared single-flight guard | authoritative reload or action-local alert |

Deferred promises are controlled by the tests; no sleeps or retries are used.

## API/data matrix

- Concurrent normalized-email admin create: exact status multiset `[200, 409]`,
  canonical conflict code and exactly one persisted/listed user.
- Existing DATA-004 suite: concurrent team/tournament invite and respond retry,
  notification rollback, expiry/cancel lifecycle remain green.
- No schema migration is added: this item consumes the versioned
  `users_email_unique` and four DATA-004 partial unique indexes.

## Verification order

1. Focused web component suites and API `auth` + `data-004` integration suites.
2. `pnpm --filter @tab10/web typecheck` and
   `pnpm --filter @tab10/api typecheck`.
3. Repository `pnpm run ci` under Node 24 / pnpm 9.15.0.
4. Real in-app Browser at desktop and 390×844: loaded match → delayed/rejected
   Stop → action alert with card retained; delayed create/feedback action →
   disabled pending CTA and one network request; page identity, non-blank,
   framework overlay, console and screenshot checks.
5. Record PostgreSQL/production skips explicitly. Production and external state
   are never test fixtures for this item.

## Executed evidence — 2026-09-07

- Red: sync double-submit produced two calls on the scoped forms/onboarding;
  concurrent normalized-email create produced `[200,500]`; match Stop rejection
  could not coexist with the loaded card.
- Focused merged Green: eight web files 36/36; API auth + DATA-004 files 15/15;
  separate web/API typechecks and diff check passed. `JudgePage.test.tsx` retained
  deterministic timer-registration coverage through `waitFor`.
- In-app Browser, local in-memory `AUDIT_EPHEMERAL` only: on 1280×800 and
  390×844, a second tab made Stop stale; the first tab showed an action-local
  alert while retaining title, `0 : 0`, participants and navigation. Mobile had
  no horizontal overflow. Admin create `dblclick` yielded exactly one matching
  user row at both widths. Console contained only known React Router v7 future
  warnings and no errors.
- Repository-wide combined Node 24.19.0 / pnpm 9.15.0 `pnpm run ci` exited 0:
  docs/routes/secrets/busy-bye audits, lint and typecheck green; shared 522,
  test-utils 4, web 111, API 131 + 7 guarded PostgreSQL skips; API/web builds
  green. Existing Vite large-chunk warning remains.
- Not executed: 7 guarded real-PostgreSQL tests, because `TEST_DATABASE_URL` was
  absent. No production/external mutation, migration, deploy, commit, push, tag
  or version bump was performed.
