# OPS-003 — safe backup rehearsal and local seed

## Scope

- Backlog: `OPS-003`.
- Requirements/acceptance: NFR 7, `AT-OPS-SAFE-001/002`.
- Outcome: repository helper commands fail before any mutation when pointed at a
  remote, production-mode or ambiguously named target.
- Non-goals: production backup/restore, schedule, retention/storage, avatar
  backup, RPO/RTO, deploy, versioning and any real database operation.
- Permission boundary: tests use only generated fake `pg_dump`/`psql` executables
  and temporary files under the system temp directory.

## Red evidence

The first Node 24 run failed because the required validation boundary did not
exist. Review of the prior scripts additionally showed arbitrary remote source
URLs, interpolated restore DDL, a predictable shared temp directory without trap,
and a comment-only seed guard.

## Verification matrix

| Case | Expected evidence |
|---|---|
| Remote PostgreSQL source | rejected before `pg_dump`/`psql` |
| Ambiguous source database | rejected unless name explicitly marks test/local/dev/ci/rehearsal |
| Missing confirmation | rejected before tools |
| Malicious/space restore identifier | rejected by bounded allowlist |
| Valid fake rehearsal | unique `mktemp`, quoted psql variable, core-table verification and cleanup |
| Output | password is never echoed by helper/shell |
| Local seed | production mode and non-loopback API rejected before HTTP; loopback development accepted |

## Evidence

- `node --test scripts/ops-safety.test.mjs`: 7/7 passed on Node 24.19.0.
- `bash -n scripts/backup-rehearsal.sh`: passed.
- Repository `audit:check` now includes `test:ops-safety` so the boundary remains
  blocking in CI.
- Full combined CI will be recorded after the active backlog-chat wave merges.

## Residual risk

- No real PostgreSQL dump or restore was run; functional restore evidence remains
  part of the approval-gated future policy in Q-OPS-003.
- `psql`/`pg_dump` version compatibility and actual backup contents are not proven
  by the fake-tool safety harness.
