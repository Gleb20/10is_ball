#!/usr/bin/env node

import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  assertPlaywrightReport,
  summarizePlaywrightReport,
} from "./assert-test-report.mjs";
import {
  ROOT,
  RUNTIME_TEST_DATABASE_ROLE,
  assertPortFree,
  assertToolchain,
  capturePostgresVersion,
  databaseUrlForRole,
  ensureDir,
  pnpmCommand,
  readRootProductVersion,
  resolveEvidenceDir,
  runCommand,
  startLoggedProcess,
  terminateProcess,
  updateEnvironmentEvidence,
  validateDisposableDatabaseEnvironment,
  waitForHttp,
  writeJson,
} from "./lib.mjs";
import { sanitizePlaywrightTraces } from "./sanitize-playwright-traces.mjs";

const evidenceDir = await ensureDir(resolveEvidenceDir("browser-prodlike"));
const databaseUrl = validateDisposableDatabaseEnvironment();
const runtimeDatabaseUrl = databaseUrlForRole(
  databaseUrl,
  RUNTIME_TEST_DATABASE_ROLE,
);
const packageVersion = await readRootProductVersion();
const release = {
  sha: "0123456789abcdef0123456789abcdef01234567",
  version: packageVersion,
  environment: "test",
  dirty: false,
};
const adminEmail = "delivery.admin@tab10.test";
const adminPassword = "DeliveryVerify9!";
await assertToolchain({
  lane: "browser-prodlike",
  directory: evidenceDir,
  requireBrowser: true,
});
const postgresVersion = await capturePostgresVersion(databaseUrl);
await updateEnvironmentEvidence(evidenceDir, {
  postgres: postgresVersion,
  migrationOwner: new URL(databaseUrl).username,
  runtimeDatabaseRole: RUNTIME_TEST_DATABASE_ROLE,
});
await assertPortFree(3101);
await assertPortFree(4273);

const cleanEnvironment = { ...process.env };
for (const key of [
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "TEST_DATABASE_URL",
  "ALLOW_TEST_DATABASE_RESET",
  "PGLITE_DATA_DIR",
  "AUDIT_EPHEMERAL",
  "VITE_API_BASE_URL",
  "COOKIE_SAME_SITE",
]) {
  delete cleanEnvironment[key];
}

const buildEnvironment = {
  ...cleanEnvironment,
  VITE_API_BASE_URL: "",
  TAB10_API_PROXY_TARGET: "http://127.0.0.1:3101",
  TAB10_RELEASE_SHA: release.sha,
  TAB10_RELEASE_VERSION: release.version,
  TAB10_ENVIRONMENT: release.environment,
  TAB10_RELEASE_DIRTY: String(release.dirty),
};
const apiEnvironment = {
  ...cleanEnvironment,
  NODE_ENV: "production",
  DATABASE_URL: runtimeDatabaseUrl,
  MIGRATE_ON_BOOT: "0",
  HOST: "127.0.0.1",
  PORT: "3101",
  WEB_ORIGIN: "http://localhost:4273",
  SEED_ADMIN: "1",
  SEED_ADMIN_EMAIL: adminEmail,
  SEED_ADMIN_PASSWORD: adminPassword,
  TAB10_RELEASE_SHA: release.sha,
  TAB10_RELEASE_VERSION: release.version,
  TAB10_ENVIRONMENT: release.environment,
  TAB10_RELEASE_DIRTY: String(release.dirty),
};
delete apiEnvironment.TEST_DATABASE_URL;
delete apiEnvironment.ALLOW_TEST_DATABASE_RESET;
const webEnvironment = {
  ...buildEnvironment,
  NODE_ENV: "production",
};
const playwrightEnvironment = {
  ...cleanEnvironment,
  TAB10_E2E_BASE_URL: "http://localhost:4273",
  E2E_ADMIN_EMAIL: adminEmail,
  E2E_ADMIN_PASSWORD: adminPassword,
  VERIFY_EVIDENCE_DIR: evidenceDir,
  TAB10_RELEASE_SHA: release.sha,
  TAB10_RELEASE_VERSION: release.version,
  TAB10_ENVIRONMENT: release.environment,
  TAB10_RELEASE_DIRTY: String(release.dirty),
};

const serverProcesses = [];
let playwrightSummary;
let failure;
let foundationChecks = 0;
let playwrightAttempted = false;
let traceSanitization = {
  status: "not-run",
  traceCount: 0,
  policy: "tab10-playwright-trace-minimal-v1",
};
const rawPlaywrightOutput = await ensureDir(
  path.join(evidenceDir, "playwright-output"),
);

try {
  await runCommand(pnpmCommand(), ["run", "build"], {
    env: buildEnvironment,
    label: "Build production API and web artifacts",
  });
  const migrationEvidenceDir = path.join(evidenceDir, "migrations");
  await runCommand(
    process.execPath,
    [
      path.join(ROOT, "scripts/release/write-web-release.mjs"),
      "--output",
      "apps/web/dist/release.json",
    ],
    { env: buildEnvironment, label: "Write deterministic web release metadata" },
  );
  await runCommand(
    process.execPath,
    [path.join(ROOT, "scripts/verify/run-migrations.mjs"), "--skip-build"],
    {
      env: {
        ...process.env,
        VERIFY_EVIDENCE_DIR: migrationEvidenceDir,
      },
      label: "Apply compiled migrations before startup",
    },
  );
  const migrationSummary = JSON.parse(
    await readFile(path.join(migrationEvidenceDir, "migration-summary.json"), "utf8"),
  );
  foundationChecks = Number(migrationSummary.passed ?? 0);

  serverProcesses.push(
    await startLoggedProcess(process.execPath, ["apps/api/dist/index.js"], {
      env: apiEnvironment,
      logFile: path.join(evidenceDir, "api.log"),
    }),
  );
  serverProcesses.push(
    await startLoggedProcess(
      pnpmCommand(),
      [
        "--filter",
        "@tab10/web",
        "exec",
        "vite",
        "preview",
        "--host",
        "localhost",
        "--port",
        "4273",
        "--strictPort",
      ],
      {
        env: webEnvironment,
        logFile: path.join(evidenceDir, "web.log"),
      },
    ),
  );
  await waitForHttp("http://localhost:4273/health", serverProcesses);

  let commandFailure;
  try {
    playwrightAttempted = true;
    await runCommand(
      pnpmCommand(),
      ["exec", "playwright", "test", "--config", "playwright.prodlike.config.ts"],
      { env: playwrightEnvironment, label: "Playwright compiled same-origin smoke" },
    );
  } catch (error) {
    commandFailure = error;
  }
  const playwrightReport = path.join(evidenceDir, "playwright-results.json");
  playwrightSummary = await summarizePlaywrightReport(playwrightReport);
  await assertPlaywrightReport(playwrightReport);
  if (commandFailure) throw commandFailure;
} catch (error) {
  failure = error;
} finally {
  for (const child of serverProcesses.reverse()) {
    await terminateProcess(child);
  }
  try {
    const sanitized = await sanitizePlaywrightTraces({
      sourceDirectory: rawPlaywrightOutput,
      outputDirectory: path.join(evidenceDir, "sanitized-traces"),
      forbiddenValues: [adminEmail, adminPassword],
      requireTrace: playwrightAttempted && Boolean(failure),
      deleteSource: true,
    });
    traceSanitization = {
      status: "passed",
      traceCount: sanitized.traceCount,
      policy: sanitized.policy,
    };
  } catch (error) {
    traceSanitization = {
      status: "failed",
      traceCount: 0,
      policy: "tab10-playwright-trace-minimal-v1",
      reason: error instanceof Error ? error.message : String(error),
    };
    failure ??= error;
  } finally {
    await rm(rawPlaywrightOutput, { recursive: true, force: true });
    await rm(path.join(evidenceDir, "playwright-report"), {
      recursive: true,
      force: true,
    });
  }
  const passed = (playwrightSummary?.passed ?? 0) + foundationChecks;
  let failed = playwrightSummary?.failed ?? 0;
  const skipped = playwrightSummary?.skipped ?? 0;
  const todo = playwrightSummary?.todo ?? 0;
  const interrupted = playwrightSummary?.interrupted ?? 0;
  if (failure && failed + skipped + todo + interrupted === 0) failed += 1;
  await writeJson(path.join(evidenceDir, "browser-summary.json"), {
    schemaVersion: 1,
    status: failure ? "failed" : "passed",
    total: passed + failed + skipped + todo + interrupted,
    passed,
    failed,
    skipped,
    todo,
    interrupted,
    runtime: {
      api: "compiled Node entrypoint",
      web: "compiled Vite preview",
      database: "disposable PostgreSQL 16 with separate migrator/runtime roles",
      origin: "http://localhost:4273",
      apiTransport: "same-origin Vite preview proxy",
    },
    postgres: postgresVersion,
    release,
    traceSanitization,
    breakdown: {
      foundationChecks,
      browserTests: playwrightSummary?.passed ?? 0,
    },
  });
}

if (failure) throw failure;
const aggregate = (playwrightSummary?.passed ?? 0) + foundationChecks;
console.log(
  `verify:e2e: ${aggregate} passed, 0 failed, 0 skipped, 0 todo, 0 interrupted`,
);
