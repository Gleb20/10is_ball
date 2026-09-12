# DATA-003 — versioned migrations test plan

Date: 2026-09-07. Scope is local/disposable verification only. This plan does
not authorize a production migration, deploy, reset, truncate, restore, seed, or
configuration change.

## Outcome and boundaries

- Replace ad-hoc `CREATE/ALTER` code with ordered, reviewable, forward-only SQL
  migrations and a durable migration ledger.
- Make PostgreSQL API startup read-only with respect to schema: a missing,
  pending, unexpected, or checksum-mismatched migration must fail startup before
  bootstrap/FAQ writes and before listen.
- Preserve the current supported schema and existing legacy rows while adopting
  an unversioned schema created by the historical boot DDL.
- Keep PGlite as a PostgreSQL-compatible local/test adapter, not a SQLite path.
- Do not add DATA-001/DATA-004 business constraints or implement DATA-002
  transactions in this work item.

## Red evidence

1. Upgrade the historical schema fixture and require a migration-ledger row.
   Current `applySchemaSql` updates columns/data but has no ledger, so the query
   for `drizzle.__drizzle_migrations` must fail before implementation.
2. Assert that `apps/api/src/index.ts` contains no `applySchemaSql` or
   `MIGRATE_ON_BOOT` path. The current entrypoint violates this policy.

Record the exact failing command/output in DATA-003 and `CHANGELOG_DEV.md` after
the reproduction is run.

## Verification matrix

| Target | Fresh schema | Historical upgrade | Startup fail-safe | Repeat run |
|---|---|---|---|---|
| Disposable PGlite | apply every migration; inspect tables/indexes/ledger | seed historical DDL + sentinel row; migrate; verify columns, backfill and row preservation | unmigrated/pending/checksum mismatch reject; current ledger accepts | no extra ledger rows; no data loss |
| Ephemeral PostgreSQL 16 | reset only the guarded loopback test schema; migrate; run smoke | seed historical DDL + sentinel row; migrate; compare required shape | API schema preflight is read-only and accepts only the exact ledger | second migration run is a no-op |

PostgreSQL checks must use `resolveTestDatabaseUrl`: `NODE_ENV=test`, explicit
loopback `TEST_DATABASE_URL` whose database name contains a standalone `test`
segment, `DATABASE_URL` unset, and `ALLOW_TEST_DATABASE_RESET=1`.

## Forward/rollback strategy

Migrations are forward-only and transactional. Already published SQL files are
immutable; a defect is corrected by a new migration. Deployment order is
explicit migration command first, then application artifact. If migration fails,
the transaction rolls back and the old application remains in service. If the
application fails after a successful compatible migration, roll back only the
application artifact; leave additive schema in place and ship a forward fix.
Any future destructive or non-backward-compatible change requires its own plan,
backup/restore evidence, and explicit production authorization.

## Handoff gates

- focused migration/policy tests green on PGlite;
- API typecheck green;
- repository `pnpm ci` green because this is a migration change;
- PostgreSQL lane green when a disposable service is available; otherwise keep
  DATA-003 below `verified_local` and record the exact skipped command/reason;
- data-model as-built, deployment as-built, backlog/status/traceability and
  reverse-chronological changelog synchronized.

## Execution evidence 2026-09-07

- Red command: 2/2 failed for absent ledger and boot-time DDL policy.
- Focused PGlite/policy command: 5 files, 14/14 passed.
- API suite: 90 passed; 5 PostgreSQL-only tests skipped.
- Persistent PGlite CLI: first apply and second no-op both verified; migrated
  runtime reached listen after ledger preflight; unmigrated runtime failed before
  listen with the expected sanitized message.
- Drizzle snapshot check: `No schema changes, nothing to migrate`.
- Full Node 24.19.0 `pnpm run ci`: passed through audits, lint, typecheck, all
  local tests and builds.
- Ephemeral PostgreSQL 16: not executed locally because neither Docker nor
  PostgreSQL binaries are available. The guarded hosted job now runs both new
  migration tests before the three existing critical-flow tests, serially.
- Production migration/deploy/config/data: not authorized and not performed.
