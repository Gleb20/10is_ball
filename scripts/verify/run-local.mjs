#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertAggregateTestSummary } from "./assert-test-report.mjs";
import {
  ROOT,
  RUNTIME_TEST_DATABASE_ROLE,
  assertToolchain,
  captureCommand,
  capturePostgresVersion,
  detectComposeCommand,
  disposableDatabaseUrl,
  ensureDir,
  pnpmCommand,
  resolveEvidenceDir,
  runCommand,
  updateEnvironmentEvidence,
  writeJson,
} from "./lib.mjs";

const evidenceDir = await ensureDir(resolveEvidenceDir("local-all"));
const cleanupProbe = process.env.TAB10_INTERNAL_CLEANUP_PROBE?.trim();
const cleanupProbeModes = new Set(["success", "induced-failure", "sigint", "sigterm"]);
if (cleanupProbe && !cleanupProbeModes.has(cleanupProbe)) {
  throw new Error("TAB10_INTERNAL_CLEANUP_PROBE has an invalid value");
}
await assertToolchain({
  lane: cleanupProbe ? `cleanup-probe-${cleanupProbe}` : "local-all",
  directory: evidenceDir,
  requireDocker: true,
  requireBrowser: !cleanupProbe,
});
const compose = await detectComposeCommand();
const project = `tab10-verify-${process.pid}`;
const composeArgs = [...compose.prefix, "-f", path.join(ROOT, "compose.verify.yml"), "-p", project];
let databaseEnvironment;
let composeStarted = false;
let failure;

async function readLaneSummary(file, name) {
  try {
    const summary = JSON.parse(await readFile(file, "utf8"));
    const source = summary.totals ?? summary;
    const counts = {
      total: Number(
        source.total ??
          (source.passed ?? 0) +
            (source.failed ?? 0) +
            (source.skipped ?? 0) +
            (source.todo ?? 0) +
            (source.interrupted ?? 0),
      ),
      passed: Number(source.passed ?? 0),
      failed: Number(source.failed ?? 0),
      skipped: Number(source.skipped ?? 0),
      todo: Number(source.todo ?? 0),
      interrupted: Number(source.interrupted ?? 0),
    };
    if (Object.values(counts).some((value) => !Number.isInteger(value) || value < 0)) {
      throw new Error(`${name}: invalid aggregate counters`);
    }
    const counted =
      counts.passed +
      counts.failed +
      counts.skipped +
      counts.todo +
      counts.interrupted;
    if (counts.total !== counted) {
      throw new Error(`${name}: aggregate counters do not add up`);
    }
    return { name, status: summary.status, ...counts };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function composeDown() {
  if (!composeStarted) return;
  await runCommand(
    compose.command,
    [...composeArgs, "down", "--volumes", "--remove-orphans"],
    { label: `Stop disposable PostgreSQL (${project})` },
  );
  composeStarted = false;
}

async function composeUp() {
  // `down` is safe even when `up --wait` fails after creating only part of the stack.
  composeStarted = true;
  await runCommand(
    compose.command,
    [...composeArgs, "up", "-d", "--wait", "--wait-timeout", "90"],
    { label: `Start disposable PostgreSQL (${project})` },
  );
  const publishedEndpoint = await captureCommand(compose.command, [
    ...composeArgs,
    "port",
    "postgres-verify",
    "5432",
  ]);
  const portMatch = publishedEndpoint.match(/^127\.0\.0\.1:(\d+)$/);
  const port = Number(portMatch?.[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Compose did not publish PostgreSQL on one loopback port");
  }
  databaseEnvironment = {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: "",
    TEST_DATABASE_URL: disposableDatabaseUrl({
      username: "tab10_test",
      password: "",
      database: "tab10_test",
      port,
    }),
    ALLOW_TEST_DATABASE_RESET: "1",
    TAB10_RUNTIME_DATABASE_ROLE: RUNTIME_TEST_DATABASE_ROLE,
  };
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await composeDown();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

try {
  if (cleanupProbe) {
    const readyFile = process.env.TAB10_CLEANUP_PROBE_READY_FILE?.trim();
    if (!readyFile || !path.isAbsolute(readyFile)) {
      throw new Error("Cleanup probe requires an absolute readiness marker path");
    }
    await composeUp();
    await writeJson(readyFile, {
      schemaVersion: 1,
      project,
      pid: process.pid,
      port: Number(new URL(databaseEnvironment.TEST_DATABASE_URL).port),
    });
    if (cleanupProbe === "induced-failure") {
      throw new Error("Induced cleanup verification failure");
    }
    if (cleanupProbe === "sigint" || cleanupProbe === "sigterm") {
      await new Promise(() => {
        setInterval(() => undefined, 1_000);
      });
    }
  } else {
    await runCommand(process.execPath, [path.join(ROOT, "scripts/verify/run-cleanup-harness.mjs")], {
      env: {
        ...process.env,
        VERIFY_EVIDENCE_DIR: path.join(evidenceDir, "cleanup-foundation"),
      },
      label: "Disposable Compose cleanup foundation",
    });
    await runCommand(pnpmCommand(), ["run", "verify:fast"], {
      env: { ...process.env, VERIFY_EVIDENCE_DIR: path.join(evidenceDir, "quality") },
      label: "Quality and fast zero-skip suites",
    });

    await composeUp();
    await updateEnvironmentEvidence(evidenceDir, {
      postgres: await capturePostgresVersion(databaseEnvironment.TEST_DATABASE_URL),
      migrationOwner: new URL(databaseEnvironment.TEST_DATABASE_URL).username,
      runtimeDatabaseRole: RUNTIME_TEST_DATABASE_ROLE,
    });
    await runCommand(pnpmCommand(), ["run", "verify:postgres"], {
      env: {
        ...databaseEnvironment,
        VERIFY_EVIDENCE_DIR: path.join(evidenceDir, "postgres"),
      },
      label: "PostgreSQL migration and integration verification",
    });
    await composeDown();

    await composeUp();
    await runCommand(pnpmCommand(), ["run", "verify:e2e"], {
      env: {
        ...databaseEnvironment,
        VERIFY_EVIDENCE_DIR: path.join(evidenceDir, "browser-prodlike"),
      },
      label: "Compiled same-origin browser verification",
    });
  }
} catch (error) {
  failure = error;
} finally {
  try {
    await composeDown();
  } catch (error) {
    failure ??= error;
  }
  let lanes = [];
  try {
    lanes = (
      await Promise.all([
        readLaneSummary(
          path.join(evidenceDir, "cleanup-foundation/cleanup-summary.json"),
          "cleanup-foundation",
        ),
        readLaneSummary(path.join(evidenceDir, "quality/fast-summary.json"), "quality"),
        readLaneSummary(
          path.join(evidenceDir, "postgres/postgres-summary.json"),
          "postgres",
        ),
        readLaneSummary(
          path.join(evidenceDir, "browser-prodlike/browser-summary.json"),
          "browser-prodlike",
        ),
      ])
    ).filter(Boolean);
  } catch (error) {
    failure ??= error;
  }
  const totals = lanes.reduce(
    (aggregate, lane) => ({
      total: aggregate.total + lane.total,
      passed: aggregate.passed + lane.passed,
      failed: aggregate.failed + lane.failed,
      skipped: aggregate.skipped + lane.skipped,
      todo: aggregate.todo + lane.todo,
      interrupted: aggregate.interrupted + lane.interrupted,
    }),
    { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0, interrupted: 0 },
  );
  if (failure && totals.failed === 0) {
    totals.failed = 1;
    totals.total += 1;
  }
  await writeJson(path.join(evidenceDir, "local-summary.json"), {
    schemaVersion: 1,
    status: failure ? "failed" : "passed",
    totals,
    lanes,
    disposableComposeProject: project,
    disposablePostgresPort: databaseEnvironment
      ? Number(new URL(databaseEnvironment.TEST_DATABASE_URL).port)
      : null,
  });
}

if (failure) throw failure;
if (cleanupProbe) {
  console.log(`Cleanup probe ${cleanupProbe}: resources removed`);
  process.exit(0);
}
const finalSummary = JSON.parse(
  await readFile(path.join(evidenceDir, "local-summary.json"), "utf8"),
);
assertAggregateTestSummary(
  finalSummary,
  ["cleanup-foundation", "quality", "postgres", "browser-prodlike"],
  "verify:all aggregate",
);
console.log(
  `verify:all: ${finalSummary.totals.passed} passed, 0 failed, 0 skipped, 0 todo, 0 interrupted`,
);
