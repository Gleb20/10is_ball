# BUG-013 — notification read/lifecycle test plan

## Scope

- Backlog: `BUG-013`; dependency: `DATA-004`.
- Requirements: `NOTIF-001`, `NOTIF-004`, `NOTIF-005`.
- Acceptance: `AT-NOTIF-001..005`.
- User-visible outcome: opening the currently rendered notification set clears
  its unread state without hiding a still-actionable invitation; expired or
  revoked invitations remain history-only and show a reason plus timestamp.
- Non-goals: new notification event types, popup delivery, pagination, redesign,
  production release/deploy, schema migration, and GAP-008's complete event
  matrix.
- Permissions: local code/docs, disposable PGlite, synthetic loopback browser
  data only. No production or external services.

## Deterministic Red

The pre-fix API/component runs showed four defects: individual read used the wall
clock; the batch route returned 404; terminal DTO fields were absent; and the UI
never submitted visible unread IDs or showed timestamps.

## API/integration matrix

1. Single read uses the injected UTC clock and retry preserves the first `readAt`.
2. Batch rejects unauthenticated/invalid requests and updates only the actor's
   requested unread rows without creating notification events.
3. A read pending invitation stays actionable but leaves the unread count.
4. DATA-004 expiry/cancel remains atomic and terminal.
5. Expiry exposes `timeout`; cancellation exposes `invitation_revoked`; both
   expose `lifecycleAt` and no actions.

## Component/browser matrix

1. Actual view automatically marks its unread IDs once.
2. Returned `readAt` changes status to `Прочитано` without hiding an actionable
   invitation.
3. History renders created and terminal times/reason with no terminal actions.
4. Home badge clears after the visit.
5. Browser: 1280×800 and 390×844, meaningful DOM, no app console errors, no
   horizontal overflow.

## Gates

- Focused BUG-013 + DATA-004 API tests and notification component tests.
- API/web typechecks and `git diff --check`.
- Root Node 24 `pnpm run ci` because this crosses the API/web contract.
- No new real-PostgreSQL gate: schema/concurrency contracts did not change.
