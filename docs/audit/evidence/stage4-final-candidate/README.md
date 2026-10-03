# Stage 4 final local candidate 4.1.2

This package records the accepted local checkpoint built from published base
`8b9d2650f7991e121052634ace758f5991ef25b5` (4.1.1).

## Acceptance

- `pnpm run ci`: 1442/1442, with zero failed, skipped, todo, or interrupted.
- Quality: 1275/1275.
- Disposable PostgreSQL: 84/84.
- Compiled production-like browser: 79/79, comprising 70 browser scenarios and
  9 foundation checks.
- Cleanup foundation: 4/4.
- Frozen source integrity before documentation finalization: 44/44 files matched.
- Independent Terra source review: PASS.
- Root forward/reverse manifest and rollback review: PASS.

The JSON files in this directory are copied safe summaries from the final gate.
Raw API logs, traces, credentials, and environment values are intentionally not
included. Historical R2 and diagnostic evidence remains immutable.

## Accepted scope

`BUG-029`, `BUG-031`, `BUG-039`, `BUG-036`, `BUG-037`, `GAP-014`, and
`GAP-016` are `verified_local`. `GAP-024` is unchanged.

## Remaining gates

Physical iPhone, pinned WebKit, and spoken assistive-technology checks were not
performed. Public 4.1.2 release parity remains pending; the published disposable
stand remains 4.1.1 until the release work order is executed.

## Files

- `local-summary.json`: aggregate final gate.
- `fast-summary.json`: quality and zero-skip fast suites.
- `postgres-summary.json`: disposable PostgreSQL lane.
- `browser-summary.json`: compiled production-like browser lane.
- `cleanup-summary.json`: disposable Compose cleanup behavior.
- `frozen-source-manifest.json`: normalized 44-file frozen source receipt.
- `independent-review.json`: review disposition supplied by the coordinator.
- `candidate-forward.patch`: application, test, and canonical-document delta;
  evidence package excluded to avoid a recursive artifact.
- `rollback.patch`: direct rollback patch for the same scope.
- `ROLLBACK.md`: tested application instructions and limits.
- `RELEASE_WORK_ORDER.md`: bounded 4.1.2 publication sequence.
- `visual/`: reviewed, synthetic screenshots without credentials.

The reviewed visuals comprise three Stage 4 states plus the original Stage 10
profile capture and an exact top crop. Correction focus, recovery, confirmation,
and the profile field error were legible without horizontal clipping at their
recorded sizes. The full-height portrait recovery overlay remains Stage 6 design
scope. Stage 13 has no retained screenshot because passing runner output was
cleaned; its functional browser scenarios are included in the 70/70 result.
