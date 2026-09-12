# BUG-012 — persisted onboarding resume test plan

Date: 2026-09-07. Scope is local/disposable verification only. This plan does
not authorize a production migration, deploy, production data mutation, commit,
push, tag, or version change.

## Outcome and boundaries

- New users automatically enter onboarding after first-password completion.
- The server owns a bounded seven-step resume cursor and completion timestamp.
- Reload/new login resumes the saved step; complete/close prevents another
  automatic open; Profile restart clears completion and returns to step 0.
- Tutorial creation remains single-flight and isolated from shared history;
  leaving it returns to the final onboarding step.
- Q-ONB-001 remains open: tutorial success does not auto-complete onboarding in
  this item. Visual redesign, full GAP-009 help content and production rollout
  are non-goals.

## Red evidence

On Node 24.19.0:

- `onboarding.integration.test.ts`: 3/3 failed. Auth responses had no persisted
  fields and `PATCH /api/v1/me/onboarding` returned 404, including invalid-step
  validation and restart.
- `onboarding-resume.test.tsx`: 2/2 failed. An incomplete user stayed on Home
  instead of the saved onboarding step, and Profile exposed only a plain link
  rather than an authoritative restart action.

## Verification matrix

| Layer | Evidence |
|---|---|
| Migration | fresh/current PGlite schema contains bounded `onboarding_step`; migration ledger remains exact/no-op; legacy completed accounts are not forced into onboarding |
| API | auth/login/me expose step + completion; set-step persists across login; invalid step is `400 VALIDATION` with no write; complete and restart converge to documented state |
| Component | incomplete route auto-opens saved step, next/skip persists before render, remount resumes, completed Profile restart opens step 0, onboarding actions remain single-flight |
| Tutorial | start URL is explicit tutorial judge flow; finish/normal exit returns to final onboarding step |
| Browser | local disposable user at desktop and 390x844; page identity, no overlay, console health, step transition, reload resume, complete/no-reopen and Profile restart |

## Handoff gates

- Focused Node 24.19.0 evidence is green: onboarding API/migration 4/4,
  migration/schema 4/4, web onboarding/single-flight/judge-return 26/26 and
  API/web typechecks.
- Full repository `pnpm run ci` on Node 24.19.0 exited 0: docs 59, shared 522,
  test-utils 4, web 116, API 136 passed + 7 guarded real-PostgreSQL skips;
  audits, lint, typecheck and API/web builds green. The known Vite large-chunk
  warning remains.
- Local Browser is green at desktop 1280x720 and mobile 390x844: auto-open,
  persisted reload resume, complete/no-reopen, Profile restart, all seven steps,
  tutorial launch and cancel back to the final step. No app console errors;
  existing React Router future-flag warnings remain.
- Real PostgreSQL migration test runs only with guarded disposable
  `TEST_DATABASE_URL`; otherwise record the skip and do not claim it.
- Production migration/deploy is a separate approval-gated operation.
