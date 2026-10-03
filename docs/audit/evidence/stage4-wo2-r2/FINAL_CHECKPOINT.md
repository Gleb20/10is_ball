# Stage 4 WO2 R2 final checkpoint

## Scope

- Work item: `BUG-029` judge score recovery.
- Base `HEAD` and `origin/main`: `8b9d2650f7991e121052634ace758f5991ef25b5`.
- Product version remains `4.1.1`.
- Source scope is limited to the four files copied under `source/`.
- No commit, push, deploy, version change, backend edit, shared-style edit, or public mutation was performed for WO2.

## Result

- Durable-storage failure leaves the old queue paused after storage becomes available again; only the explicit Continue or Discard action releases that queue.
- Accepting the displayed score requires a frozen score/serve confirmation and sends no score request. A later read invalidates a stale confirmation instead of rebasing it.
- An explicit new point is bound to the immutable reviewed version. Its success or its exact `409 VERSION_CONFLICT` fence resolves only eligible older accepted attempts and keeps unrelated work and the old queue paused.
- `400 VALIDATION` resolves only that request and is not treated as a fence. Other errors remain uncertain until exact read evidence is available.
- Recovery distinguishes sent, unknown, accepted, and unsent work; paused unsent work is not labeled as sending. The recovery summary receives focus only when it first appears.
- Leaving for Home and returning performs ownership/read recovery first and sends no automatic score request.
- Late responses cannot lower the displayed server version, and callbacks from an old mount are ignored.

## Verification

- Deterministic R2 Red: `logs/stage4-wo2-r2-red.log` records 6 failing cases before the fixes (53 passing, 59 total).
- Focused Green: `logs/stage4-wo2-r2-focused-green.log` records 69/69 passing tests in `JudgePage.test.tsx` and `judgeScoreRecovery.test.ts`.
- Full web tests: `logs/stage4-wo2-r2-full-web.log` records 323/323 passing tests across 43 files.
- Web typecheck: `logs/stage4-wo2-r2-typecheck.log` passed. The first R2 typecheck exposed an incomplete local error type annotation; `logs/stage4-wo2-r2-typecheck-red.log` preserves that failure, which was corrected before the passing run.
- `git diff --check` passed; see `logs/diff-check.log`.
- `git apply --reverse --check final-checkpoint/rollback.patch` passed against the frozen source state; see `final-checkpoint/rollback-check.log`.
- `final-checkpoint/source.sha256` binds the four source copies. `final-checkpoint/wo1-integrity.sha256` confirms the accepted WO1 API files remained byte-for-byte at their required hashes.

## Deferred acceptance

- Browser runtime and layout checks, real PostgreSQL concurrency checks, and repository-wide gates remain assigned to WO5. This package does not claim those checks.
- R2 remains subject to coordinator and independent reviewer acceptance.

## Evidence history

The older `docs/audit/evidence/stage4-wo2/` package is historical R1/R1b evidence and was not modified during this R2 freeze. Its R1b aggregate was previously found incoherent because `rollback.patch` did not match its manifest, so it is not cited as accepted evidence. This R2 package is a new source-bound snapshot under `docs/audit/evidence/stage4-wo2-r2/`.
