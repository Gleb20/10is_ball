#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  assertVitestReport,
  summarizeVitestReport,
} from "./assert-test-report.mjs";
import {
  ROOT,
  RUNTIME_TEST_DATABASE_ROLE,
  assertToolchain,
  capturePostgresVersion,
  ensureDir,
  pnpmCommand,
  resolveEvidenceDir,
  runCommand,
  updateEnvironmentEvidence,
  validateDisposableDatabaseEnvironment,
  writeJson,
} from "./lib.mjs";

const evidenceDir = await ensureDir(resolveEvidenceDir("postgres"));
validateDisposableDatabaseEnvironment();
await assertToolchain({ lane: "postgres", directory: evidenceDir });
const report = path.join(evidenceDir, "vitest-postgres.json");
let testSummary;
let failure;
let postgresVersion;
let foundationChecks = 0;

try {
  postgresVersion = await capturePostgresVersion(process.env.TEST_DATABASE_URL);
  await updateEnvironmentEvidence(evidenceDir, { postgres: postgresVersion });
  const migrationEvidenceDir = path.join(evidenceDir, "migrations");
  await runCommand(process.execPath, [path.join(ROOT, "scripts/verify/run-migrations.mjs")], {
    env: {
      ...process.env,
      VERIFY_EVIDENCE_DIR: migrationEvidenceDir,
    },
    label: "Fresh and idempotent compiled migrations",
  });
  const migrationSummary = JSON.parse(
    await readFile(path.join(migrationEvidenceDir, "migration-summary.json"), "utf8"),
  );
  foundationChecks = Number(migrationSummary.passed ?? 0);
  await updateEnvironmentEvidence(evidenceDir, {
    migrationOwner: new URL(process.env.TEST_DATABASE_URL).username,
    runtimeDatabaseRole: RUNTIME_TEST_DATABASE_ROLE,
  });
  let commandFailure;
  try {
    await runCommand(
      pnpmCommand(),
      [
        "--filter",
        "@tab10/api",
        "exec",
        "vitest",
        "run",
        "--no-file-parallelism",
        "src/db/migrations.postgres.integration.test.ts",
        "src/postgres-date.integration.test.ts",
        "src/data-004.postgres.integration.test.ts",
        "src/history.postgres.integration.test.ts",
        "src/gap-005.postgres.integration.test.ts",
        "--reporter=json",
        `--outputFile=${report}`,
      ],
      {
        env: (() => {
          const testEnvironment = {
            ...process.env,
            REQUIRE_TEST_DATABASE_URL: "1",
          };
          delete testEnvironment.TAB10_RUNTIME_DATABASE_ROLE;
          delete testEnvironment.MIGRATION_DATABASE_URL;
          return testEnvironment;
        })(),
        label: "Required PostgreSQL integration suite",
      },
    );
  } catch (error) {
    commandFailure = error;
  }
  testSummary = await summarizeVitestReport(report);
  await assertVitestReport(report);
  if (commandFailure) throw commandFailure;
} catch (error) {
  failure = error;
}

const passed = (testSummary?.passed ?? 0) + foundationChecks;
let failed = testSummary?.failed ?? 0;
const skipped = testSummary?.skipped ?? 0;
const todo = testSummary?.todo ?? 0;
const interrupted = testSummary?.interrupted ?? 0;
if (failure && failed + skipped + todo + interrupted === 0) failed += 1;
await writeJson(path.join(evidenceDir, "postgres-summary.json"), {
  schemaVersion: 1,
  status: failure ? "failed" : "passed",
  total: passed + failed + skipped + todo + interrupted,
  passed,
  failed,
  skipped,
  todo,
  interrupted,
  suites: [
    "apps/api/src/db/migrations.postgres.integration.test.ts",
    "apps/api/src/postgres-date.integration.test.ts",
    "apps/api/src/data-004.postgres.integration.test.ts",
    "apps/api/src/history.postgres.integration.test.ts",
    "apps/api/src/gap-005.postgres.integration.test.ts",
  ],
  migrations:
    "fresh and adopted baselines, exact local role initializer, migration rollback/concurrency, idempotent compiled entrypoint, and runtime-role probes",
  postgres: postgresVersion,
  breakdown: {
    foundationChecks,
    integrationTests: testSummary?.passed ?? 0,
  },
});

if (failure) throw failure;
console.log(
  `verify:postgres: ${passed} passed, 0 failed, 0 skipped, 0 todo, 0 interrupted`,
);
