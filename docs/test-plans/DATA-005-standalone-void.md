# DATA-005/007 — result void verification plan

Scope: ADR D19/D24, MATCH-016, AT-MATCH-VOID-001..003 and
AT-ADM-MATCH-005/007 plus D33 and AT-MATCH-VOID-004. The observable outcome is a
retained sporting record marked `voided`, with one immutable
actor/prior-state/compensation audit record and one-time ranking compensation.

## Deterministic Red → Green

1. Prove the previous hard-delete endpoint accepts a finished standalone match,
   then require `MATCH_IMMUTABLE` with the match and rankings unchanged.
2. Prove the void endpoint and creator UI action are absent, then require the
   exact creator/active-admin actor matrix and explicit named confirmation.
3. Exercise finished and stopped sources, optional reason, participant/current
   or former judge/outsider rejection, stale version rejection and tournament
   fail-closed behavior.
4. Replay one UUID key concurrently and assert one version transition, one
   compensation and one audit row. Inject an audit insert failure and assert the
   match, rankings and ledger all roll back.
5. For a tournament result, compare bracket JSON/version, every downstream row,
   notifications and unrelated stats before/after; only target match, its own
   stats and audit may change, and replay returns the same outcome.
6. Attempt update and delete of the audit row and require database rejection;
   retain prior result, score, winner and event log in the source match.

## Verification layers

- PGlite acceptance/integration: `apps/api/src/data-005.integration.test.ts`.
- Existing domain/schema/migration regressions and API/web typecheck.
- Web components: confirmation/dismiss/request payload, permission visibility,
  history purge safeguard and `voided` label.
- Real browser at desktop and 390x844: dialog content, optional reason, dismiss
  no-op, completed state and terminal purge absence.
- Full repository `pnpm run ci` under the repository Node 24 runtime.
- Ephemeral PostgreSQL migration/integration lane when `TEST_DATABASE_URL` is
  available. Absence of that runtime must be reported, never treated as passed.

## Non-goals and safety

D33 intentionally does not replace/cascade/replay downstream tournament state.
This work does not make the generic `audit_logs` table immutable, reset or run a
down-migration, execute mutating public E2E, tag or bump a version.
