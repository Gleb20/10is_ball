#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ROOT,
  RUNTIME_TEST_DATABASE_ROLE,
  assertToolchain,
  capturePostgresVersion,
  ensureDir,
  pnpmCommand,
  resolveEvidenceDir,
  runCommand,
  validateDisposableDatabaseEnvironment,
  updateEnvironmentEvidence,
  writeJson,
} from "./lib.mjs";

const evidenceDir = await ensureDir(resolveEvidenceDir("migrations"));
const databaseUrl = validateDisposableDatabaseEnvironment();
await assertToolchain({ lane: "migrations", directory: evidenceDir });
const skipBuild = process.argv.includes("--skip-build");
const migrationLog = path.join(evidenceDir, "migrations.log");
let completed = 0;
let localInitChecks = 0;
let runtimeRoleChecks = 0;
let failure;
let postgresVersion;

try {
  if (!skipBuild) {
    await runCommand(
      pnpmCommand(),
      ["--filter", "@tab10/shared", "--filter", "@tab10/api", "run", "build"],
      { label: "Build compiled migration entrypoint" },
    );
  }
  const roleEnvironment = {
    ...process.env,
    NODE_ENV: "test",
    TEST_DATABASE_URL: databaseUrl,
    DATABASE_URL: "",
    ALLOW_TEST_DATABASE_RESET: "1",
    TAB10_RUNTIME_DATABASE_ROLE: RUNTIME_TEST_DATABASE_ROLE,
  };
  const localInitEvidenceDir = path.join(evidenceDir, "local-init");
  await runCommand(
    process.execPath,
    [path.join(ROOT, "scripts/verify/run-local-init-regression.mjs")],
    {
      env: { ...roleEnvironment, VERIFY_EVIDENCE_DIR: localInitEvidenceDir },
      label: "Exercise the checked-in local PostgreSQL role initializer",
    },
  );
  const localInitSummary = JSON.parse(
    await readFile(path.join(localInitEvidenceDir, "local-init-summary.json"), "utf8"),
  );
  if (
    localInitSummary.status !== "passed" ||
    localInitSummary.total !== 4 ||
    localInitSummary.passed !== 4 ||
    localInitSummary.failed !== 0 ||
    localInitSummary.skipped !== 0 ||
    localInitSummary.todo !== 0 ||
    localInitSummary.interrupted !== 0
  ) {
    throw new Error("Local init evidence did not satisfy the four-check zero-skip policy");
  }
  localInitChecks = localInitSummary.passed;

  const roleEvidenceDir = path.join(evidenceDir, "runtime-role");
  await runCommand(
    process.execPath,
    [path.join(ROOT, "scripts/verify/provision-runtime-role.mjs")],
    {
      env: { ...roleEnvironment, VERIFY_EVIDENCE_DIR: roleEvidenceDir },
      label: "Provision separate disposable migration and runtime roles",
    },
  );
  const migrationEnv = {
    ...roleEnvironment,
    MIGRATION_DATABASE_URL: databaseUrl,
    TAB10_ENVIRONMENT: "staging",
  };
  delete migrationEnv.DATABASE_URL;
  delete migrationEnv.TEST_DATABASE_URL;
  delete migrationEnv.ALLOW_TEST_DATABASE_RESET;
  delete migrationEnv.PGLITE_DATA_DIR;
  delete migrationEnv.AUDIT_EPHEMERAL;
  await runCommand(
    pnpmCommand(),
    ["run", "db:migrate", "--", "--mode=apply"],
    {
      env: migrationEnv,
      logFile: migrationLog,
      label: "Compiled PostgreSQL migration (idempotent pass)",
    },
  );
  completed = 1;
  await runCommand(
    process.execPath,
    [path.join(ROOT, "scripts/verify/assert-runtime-role.mjs")],
    {
      env: { ...roleEnvironment, VERIFY_EVIDENCE_DIR: roleEvidenceDir },
      label: "Verify limited runtime DML and denied DDL/ledger writes",
    },
  );
  const roleSummary = JSON.parse(
    await readFile(path.join(roleEvidenceDir, "runtime-role-summary.json"), "utf8"),
  );
  if (
    roleSummary.status !== "passed" ||
    roleSummary.total !== 4 ||
    roleSummary.passed !== 4 ||
    roleSummary.failed !== 0 ||
    roleSummary.skipped !== 0 ||
    roleSummary.todo !== 0 ||
    roleSummary.interrupted !== 0
  ) {
    throw new Error("Runtime role evidence did not satisfy the four-check zero-skip policy");
  }
  runtimeRoleChecks = roleSummary.passed;
  postgresVersion = await capturePostgresVersion(databaseUrl);
  await updateEnvironmentEvidence(evidenceDir, {
    postgres: postgresVersion,
    migrationOwner: new URL(databaseUrl).username,
    runtimeDatabaseRole: RUNTIME_TEST_DATABASE_ROLE,
  });
} catch (error) {
  failure = error;
} finally {
  await writeJson(path.join(evidenceDir, "migration-summary.json"), {
    schemaVersion: 1,
    status: failure ? "failed" : "passed",
    passed: completed + localInitChecks + runtimeRoleChecks,
    failed: failure ? 1 : 0,
    skipped: 0,
    todo: 0,
    interrupted: 0,
    total:
      completed +
      localInitChecks +
      runtimeRoleChecks +
      (failure ? 1 : 0),
    expected: {
      localInitChecks: 4,
      migrationPasses: 1,
      runtimeRoleChecks: 4,
    },
    postgres: postgresVersion,
    breakdown: {
      localInitChecks,
      migrationPasses: completed,
      runtimeRoleChecks,
    },
  });
}

if (failure) throw failure;
if (completed !== 1) throw new Error(`Expected one idempotent migration pass; completed ${completed}`);
const passed = completed + localInitChecks + runtimeRoleChecks;
console.log(
  `Migration foundation: ${passed} passed, 0 failed, 0 skipped, 0 todo, 0 interrupted`,
);
