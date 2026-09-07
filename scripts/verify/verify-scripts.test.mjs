import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertAggregateTestSummary,
  assertNodeTapReport,
  assertPlaywrightReport,
  assertVitestReport,
} from "./assert-test-report.mjs";
import {
  ROOT,
  disposableDatabaseUrl,
  readRootProductVersion,
} from "./lib.mjs";
import {
  dispatchPnpmArguments,
  resolveCorepackExecutable,
} from "./pnpm-dispatch.mjs";
import { validateLocalRolePolicyTarget } from "./local-role-policy-target.mjs";
import { localDevelopmentBaseEnvironment } from "./local-development-environment.mjs";
import { normalizeCompiledMigrationArguments } from "../bin/run-compiled-migration.mjs";

const packageJson = JSON.parse(
  await readFile(path.join(ROOT, "package.json"), "utf8"),
);
const readme = await readFile(path.join(ROOT, "README.md"), "utf8");
const miseConfig = await readFile(path.join(ROOT, ".mise.toml"), "utf8");
const pnpmDispatcher = await readFile(
  path.join(ROOT, "scripts/bin/pnpm"),
  "utf8",
);
const devRunner = await readFile(
  path.join(ROOT, "scripts/verify/run-dev.mjs"),
  "utf8",
);
const pgliteRunner = await readFile(
  path.join(ROOT, "scripts/verify/run-dev-pglite.mjs"),
  "utf8",
);
const localRunner = await readFile(
  path.join(ROOT, "scripts/verify/run-local.mjs"),
  "utf8",
);
const migrationRunner = await readFile(
  path.join(ROOT, "scripts/verify/run-migrations.mjs"),
  "utf8",
);
const verifyCompose = await readFile(path.join(ROOT, "compose.verify.yml"), "utf8");
const cleanupHarness = await readFile(
  path.join(ROOT, "scripts/verify/run-cleanup-harness.mjs"),
  "utf8",
);
const ciWorkflow = await readFile(
  path.join(ROOT, ".github/workflows/ci.yml"),
  "utf8",
);
const localPostgresInit = await readFile(
  path.join(ROOT, "scripts/postgres/init-local.sql"),
  "utf8",
);
const localInitRegression = await readFile(
  path.join(ROOT, "scripts/verify/run-local-init-regression.mjs"),
  "utf8",
);
const localRolePolicyRunner = await readFile(
  path.join(ROOT, "scripts/verify/apply-local-role-policy.mjs"),
  "utf8",
);

test("verification entrypoints keep the explicit package-script contract", () => {
  assert.equal(packageJson.devDependencies?.vercel, undefined);
  assert.equal(
    packageJson.scripts.doctor,
    "node scripts/verify/doctor.mjs --require-docker --require-browser",
  );
  assert.deepEqual(
    Object.keys(packageJson.scripts)
      .filter((name) => name.startsWith("verify:"))
      .sort(),
    ["verify:all", "verify:e2e", "verify:fast", "verify:postgres"],
  );
  assert.match(packageJson.scripts["verify:fast"], /pnpm test:fast$/);
  assert.equal(
    packageJson.scripts["verify:postgres"],
    "node scripts/verify/run-postgres.mjs",
  );
  assert.equal(
    packageJson.scripts["verify:e2e"],
    "node scripts/verify/run-prodlike-e2e.mjs",
  );
  assert.equal(packageJson.scripts["verify:all"], "node scripts/verify/run-local.mjs");
  assert.equal(packageJson.scripts.ci, "pnpm run verify:all");
});

test("mise pnpm dispatcher maps only built-in command collisions", () => {
  assert.deepEqual(dispatchPnpmArguments(["doctor"]), ["pnpm", "run", "doctor"]);
  assert.deepEqual(dispatchPnpmArguments(["ci"]), ["pnpm", "run", "ci"]);
  assert.deepEqual(dispatchPnpmArguments(["install", "--frozen-lockfile"]), [
    "pnpm",
    "install",
    "--frozen-lockfile",
  ]);
  assert.deepEqual(dispatchPnpmArguments(["run", "typecheck"]), [
    "pnpm",
    "run",
    "typecheck",
  ]);
  assert.deepEqual(dispatchPnpmArguments(["--version"]), ["pnpm", "--version"]);
  assert.equal(
    resolveCorepackExecutable({ execPath: "/mise/node/bin/node", platform: "darwin" }),
    "/mise/node/bin/corepack",
  );
  assert.match(miseConfig, /\.path\s*=\s*\["\{\{config_root\}\}\/scripts\/bin"\]/);
  assert.match(pnpmDispatcher, /runPnpmDispatcher/);
  assert.doesNotMatch(pnpmDispatcher, /spawn|exec|pnpmCommand/);
  assert.match(readme, /mise exec -- pnpm doctor/);
  assert.match(readme, /mise exec -- pnpm ci/);
  assert.equal(packageJson.scripts.ci, "pnpm run verify:all");
});

test("development release metadata derives the root product version", async () => {
  assert.equal(await readRootProductVersion(), packageJson.version);
  for (const source of [devRunner, pgliteRunner]) {
    assert.match(source, /readRootProductVersion\(\)/);
    assert.doesNotMatch(source, /TAB10_RELEASE_VERSION:\s*["']\d+\.\d+\.\d+/);
  }
});

test("local development cannot inherit an absolute API origin or hosted credentials", () => {
  const clean = localDevelopmentBaseEnvironment({
    PATH: "/synthetic/bin",
    SEED_ADMIN: "0",
    VITE_API_BASE_URL: "https://production.invalid",
    VITE_ACCIDENTAL_SECRET: "must-not-reach-vite",
    DATABASE_URL: "hosted-runtime",
    MIGRATION_DATABASE_URL: "hosted-owner",
    GITHUB_SHA: "hosted-sha",
    NEON_API_KEY: "hosted-provider-key",
    RENDER_API_KEY: "hosted-provider-key",
    VERCEL_TOKEN: "hosted-provider-token",
    TAB10_EXPECTED_NEON_PROJECT_ID: "hosted-project",
    TAB10_FORBIDDEN_PRODUCTION_WEB_ORIGIN: "hosted-origin",
  });
  assert.deepEqual(clean, { PATH: "/synthetic/bin", SEED_ADMIN: "0" });
  for (const source of [devRunner, pgliteRunner]) {
    assert.match(source, /localDevelopmentBaseEnvironment/);
    assert.match(source, /VITE_API_BASE_URL:\s*""/);
    assert.match(source, /TAB10_API_PROXY_TARGET:\s*"http:\/\/127\.0\.0\.1:3001"/);
    assert.match(source, /HOST:\s*"127\.0\.0\.1"/);
    assert.match(source, /PORT:\s*"3001"/);
  }
});

test("PostgreSQL runners use the canonical compiled migration command", () => {
  assert.equal(
    packageJson.scripts["db:migrate"],
    "node scripts/bin/run-compiled-migration.mjs",
  );
  assert.deepEqual(normalizeCompiledMigrationArguments(["--", "--mode=apply"]), [
    "--mode=apply",
  ]);
  assert.throws(
    () => normalizeCompiledMigrationArguments(["--mode=apply"]),
    /exactly one leading/,
  );
  assert.throws(
    () => normalizeCompiledMigrationArguments(["--", "--", "--mode=apply"]),
    /only one standalone/,
  );
  assert.throws(
    () => normalizeCompiledMigrationArguments(["--"]),
    /requires migration arguments/,
  );
  for (const source of [
    devRunner,
    localInitRegression,
    migrationRunner,
  ]) {
    assert.match(source, /\["run", "db:migrate", "--", "--mode=apply"\]/);
    assert.doesNotMatch(source, /dist\/db\/migrate\.js|src\/db\/migrate\.ts/);
  }
  assert.match(devRunner, /\["run", "build:api"\]/);
  assert.match(migrationRunner, /Build compiled migration entrypoint/);
});

test("PGlite dev migration avoids pnpm's literal separator forwarding", () => {
  assert.match(
    pgliteRunner,
    /\["--filter", "@tab10\/api", "run", "db:migrate:pglite", "--mode=apply"\]/,
  );
  assert.doesNotMatch(pgliteRunner, /"db:migrate:pglite", "--"/);
});

test("verify:all lets Docker allocate an isolated loopback PostgreSQL port", () => {
  assert.match(verifyCompose, /published:\s*["']0["']/);
  assert.match(verifyCompose, /host_ip:\s*127\.0\.0\.1/);
  assert.match(localRunner, /"port",\s*\n\s*"postgres-verify"/);
  assert.doesNotMatch(localRunner, /port:\s*55432/);
});

test("local PostgreSQL initialization matches the attested hosted role profile", () => {
  assert.match(localPostgresInit, /REVOKE TEMP ON DATABASE %I FROM PUBLIC/);
  assert.match(localPostgresInit, /current_database\(\)/);
  assert.match(localPostgresInit, /REVOKE ALL ON SCHEMA public FROM PUBLIC/);
  assert.match(localPostgresInit, /NOINHERIT/);
  assert.match(localPostgresInit, /NOBYPASSRLS/);
  assert.doesNotMatch(localPostgresInit, /GRANT EXECUTE ON FUNCTIONS/);
  assert.match(localPostgresInit, /REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/);
  assert.match(localPostgresInit, /tab10\.disposable_test/);
  assert.match(localPostgresInit, /refuses a pre-existing tab10_runtime role/);
  assert.doesNotMatch(localPostgresInit, /DATABASE\s+tab10\b/);
  assert.doesNotMatch(localPostgresInit, /FOR ROLE tab10_migration_owner/);
  assert.match(localInitRegression, /apply-local-role-policy\.mjs/);
  assert.match(localInitRegression, /--disposable-test/);
  assert.match(localInitRegression, /attestRuntimeRole/);
  assert.match(localInitRegression, /refusing to alter a pre-existing global role/);
  assert.match(localInitRegression, /preExistingRoleFailure/);
  assert.match(localInitRegression, /captureCommand/);
  assert.doesNotMatch(localInitRegression, /CREATE DATABASE|DROP DATABASE/);
  assert.match(devRunner, /apply-local-role-policy\.mjs/);
  assert.match(localRolePolicyRunner, /init-local\.sql/);
  assert.match(localRolePolicyRunner, /validateLocalRolePolicyTarget/);
  assert.match(localRolePolicyRunner, /sql\.begin/);
  assert.match(localRolePolicyRunner, /SET LOCAL tab10\.disposable_test/);
});

test("local role policy target guard fails closed outside its two exact modes", () => {
  const fixedDevelopmentUrl = disposableDatabaseUrl({
    username: "tab10_migration_owner",
    database: "tab10",
    port: 5432,
  });
  const disposableUrl = disposableDatabaseUrl({
    username: "tab10_test",
    database: "tab10_test",
    port: 5432,
  });
  const disposableEnv = {
    NODE_ENV: "test",
    DATABASE_URL: "",
    ALLOW_TEST_DATABASE_RESET: "1",
    TEST_DATABASE_URL: disposableUrl,
    MIGRATION_DATABASE_URL: disposableUrl,
  };
  assert.equal(
    validateLocalRolePolicyTarget({
      env: { MIGRATION_DATABASE_URL: fixedDevelopmentUrl },
      arguments_: [],
    }),
    fixedDevelopmentUrl,
  );
  assert.equal(
    validateLocalRolePolicyTarget({
      env: disposableEnv,
      arguments_: ["--disposable-test"],
    }),
    disposableUrl,
  );
  assert.throws(
    () =>
      validateLocalRolePolicyTarget({
        env: { ...disposableEnv, MIGRATION_DATABASE_URL: fixedDevelopmentUrl },
        arguments_: ["--disposable-test"],
      }),
    /equal TEST_DATABASE_URL/,
  );
  assert.throws(
    () =>
      validateLocalRolePolicyTarget({
        env: { ...disposableEnv, DATABASE_URL: disposableUrl },
        arguments_: ["--disposable-test"],
      }),
    /DATABASE_URL must be unset/,
  );
  assert.throws(
    () =>
      validateLocalRolePolicyTarget({
        env: { ...disposableEnv, ALLOW_TEST_DATABASE_RESET: "0" },
        arguments_: ["--disposable-test"],
      }),
    /ALLOW_TEST_DATABASE_RESET=1/,
  );
  assert.throws(
    () =>
      validateLocalRolePolicyTarget({
        env: { MIGRATION_DATABASE_URL: disposableUrl },
        arguments_: [],
      }),
    /fixed loopback development database/,
  );
  assert.throws(
    () =>
      validateLocalRolePolicyTarget({
        env: { MIGRATION_DATABASE_URL: fixedDevelopmentUrl },
        arguments_: ["--unexpected"],
      }),
    /Unknown local-role policy argument/,
  );
});

test("verify:all proves cleanup on success, failure and termination signals", () => {
  assert.match(localRunner, /run-cleanup-harness\.mjs/);
  for (const scenario of ["success", "induced-failure", "sigint", "sigterm"]) {
    assert.match(cleanupHarness, new RegExp(`name: ["']${scenario}["']`));
  }
  assert.match(cleanupHarness, /docker["'], \[[\s\S]*"volume"/);
  assert.match(cleanupHarness, /docker["'], \[[\s\S]*"network"/);
});

test("CI uploads only curated browser evidence and sanitized traces", () => {
  assert.match(ciWorkflow, /browser-prodlike\/environment\.json/);
  assert.match(ciWorkflow, /browser-prodlike\/browser-summary\.json/);
  assert.match(ciWorkflow, /browser-prodlike\/sanitized-traces/);
  assert.doesNotMatch(
    ciWorkflow,
    /path:\s*\$\{\{ runner\.temp \}\}\/tab10-evidence\/browser-prodlike\s*$/m,
  );
});

test("verification report readers reject skipped and todo tests", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tab10-report-policy-"));
  context.after(() => rm(directory, { recursive: true, force: true }));

  const vitestReport = path.join(directory, "vitest.json");
  await writeFile(
    vitestReport,
    JSON.stringify({
      numTotalTests: 1,
      numPassedTests: 0,
      numFailedTests: 0,
      numPendingTests: 1,
      numTodoTests: 1,
      testResults: [],
    }),
  );
  await assert.rejects(assertVitestReport(vitestReport), /expected 0 failed/);

  const playwrightReport = path.join(directory, "playwright.json");
  await writeFile(
    playwrightReport,
    JSON.stringify({
      suites: [
        {
          specs: [
            {
              tests: [
                {
                  expectedStatus: "skipped",
                  results: [{ status: "skipped" }],
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  await assert.rejects(assertPlaywrightReport(playwrightReport), /expected 0 failed/);

  const tapReport = path.join(directory, "node.tap");
  await writeFile(
    tapReport,
    "1..1\n# tests 1\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 1\n",
  );
  await assert.rejects(assertNodeTapReport(tapReport), /expected 0 failed/);
});

test("verify:all aggregate fails closed before printing success", () => {
  const lane = (name) => ({
    name,
    status: "passed",
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    todo: 0,
    interrupted: 0,
  });
  const lanes = [
    lane("cleanup-foundation"),
    lane("quality"),
    lane("postgres"),
    lane("browser-prodlike"),
  ];
  const clean = {
    status: "passed",
    lanes,
    totals: {
      total: 4,
      passed: 4,
      failed: 0,
      skipped: 0,
      todo: 0,
      interrupted: 0,
    },
  };
  assert.deepEqual(
    assertAggregateTestSummary(clean, lanes.map(({ name }) => name)),
    clean.totals,
  );
  assert.throws(
    () =>
      assertAggregateTestSummary(
        { ...clean, status: "failed" },
        lanes.map(({ name }) => name),
      ),
    /status must be passed/,
  );
  assert.throws(
    () =>
      assertAggregateTestSummary(
        {
          ...clean,
          lanes: [
            { ...lanes[0], passed: 0, skipped: 1 },
            ...lanes.slice(1),
          ],
          totals: { ...clean.totals, passed: 3, skipped: 1 },
        },
        lanes.map(({ name }) => name),
      ),
    /expected 0 failed\/skipped\/todo\/interrupted/,
  );
  assert.throws(
    () =>
      assertAggregateTestSummary(
        { ...clean, lanes: lanes.slice(1) },
        lanes.map(({ name }) => name),
      ),
    /lane set does not match/,
  );
  assert.match(localRunner, /assertAggregateTestSummary\(/);
});
