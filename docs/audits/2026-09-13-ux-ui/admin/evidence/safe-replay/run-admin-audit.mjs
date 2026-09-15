#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  ROOT,
  RUNTIME_TEST_DATABASE_ROLE,
  assertPortFree,
  databaseUrlForRole,
  ensureDir,
  pnpmCommand,
  runCommand,
  startLoggedProcess,
  terminateProcess,
  waitForHttp,
  writeJson,
} from "../../../../../../scripts/verify/lib.mjs";

const auditDir = path.join(ROOT, "docs/audits/2026-09-13-ux-ui/admin");
const evidenceDir = await ensureDir(path.join(auditDir, "evidence"));
const composeFile = path.join(evidenceDir, "safe-replay/compose.admin.yml");
const dockerProject = "tab10-ux-admin-5417";
const migratorDatabaseUrl = "postgresql://tab10_test@127.0.0.1:33030/tab10_test";
const runtimeDatabaseUrl = databaseUrlForRole(migratorDatabaseUrl, RUNTIME_TEST_DATABASE_ROLE);
const nodeBin = process.execPath;
const adminEmail = `admin-${Date.now()}@audit.invalid`;
const adminPassword = `A!${randomBytes(18).toString("base64url")}9z`;
const fixturePassword = `F!${randomBytes(18).toString("base64url")}8y`;
const tmpDir = await ensureDir(path.join("/private/tmp", `${dockerProject}-${process.pid}`));
const cleanEnvironment = { ...process.env };
for (const key of [
  "DATABASE_URL", "MIGRATION_DATABASE_URL", "TEST_DATABASE_URL",
  "ALLOW_TEST_DATABASE_RESET", "PGLITE_DATA_DIR", "AUDIT_EPHEMERAL",
  "VITE_API_BASE_URL", "COOKIE_SAME_SITE", "GITHUB_SHA",
  "RENDER_GIT_COMMIT", "VERCEL_GIT_COMMIT_SHA", "SEED_ADMIN_EMAIL",
  "SEED_ADMIN_PASSWORD",
]) delete cleanEnvironment[key];

const release = {
  sha: "9f71b9f4c91f6f7184e8c34716d7b57b7c27a221",
  version: "3.0.0",
  environment: "test",
  dirty: true,
};
const skipBuild = process.env.TAB10_AUDIT_SKIP_BUILD === "1";
const buildEnvironment = {
  ...cleanEnvironment,
  NODE_ENV: "production",
  VITE_API_BASE_URL: "",
  TAB10_API_PROXY_TARGET: "http://127.0.0.1:5418",
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
  PORT: "5418",
  WEB_ORIGIN: "http://localhost:5417",
  SEED_ADMIN: "1",
  SEED_ADMIN_EMAIL: adminEmail,
  SEED_ADMIN_PASSWORD: adminPassword,
  TAB10_RELEASE_SHA: release.sha,
  TAB10_RELEASE_VERSION: release.version,
  TAB10_ENVIRONMENT: release.environment,
  TAB10_RELEASE_DIRTY: String(release.dirty),
};
const webEnvironment = { ...buildEnvironment, NODE_ENV: "production" };
const runnerEnvironment = {
  ...cleanEnvironment,
  TAB10_AUDIT_BASE_URL: "http://localhost:5417",
  TAB10_AUDIT_ADMIN_EMAIL: adminEmail,
  TAB10_AUDIT_ADMIN_PASSWORD: adminPassword,
  TAB10_AUDIT_FIXTURE_PASSWORD: fixturePassword,
  TAB10_AUDIT_DATABASE_URL: runtimeDatabaseUrl,
};

let composeUp = false;
const processes = [];
let failure;
try {
  await Promise.all([assertPortFree(5417), assertPortFree(5418), assertPortFree(33030)]);
  await runCommand("docker", ["compose", "-f", composeFile, "-p", dockerProject, "up", "-d", "--wait"], { label: "Start disposable PostgreSQL for ADMIN audit" });
  composeUp = true;
  if (!skipBuild) {
    await runCommand(pnpmCommand(), ["run", "build"], { env: buildEnvironment, label: "Build frozen candidate" });
    await runCommand(nodeBin, [path.join(ROOT, "scripts/release/write-web-release.mjs"), "--output", "apps/web/dist/release.json"], { env: buildEnvironment, label: "Write deterministic release metadata" });
  }
  const migrationEvidence = path.join(tmpDir, "migrations");
  await runCommand(nodeBin, [path.join(ROOT, "scripts/verify/run-migrations.mjs"), "--skip-build"], {
    env: {
      ...cleanEnvironment,
      NODE_ENV: "test",
      DATABASE_URL: "",
      TEST_DATABASE_URL: migratorDatabaseUrl,
      ALLOW_TEST_DATABASE_RESET: "1",
      VERIFY_EVIDENCE_DIR: migrationEvidence,
    },
    label: "Apply migrations to disposable PostgreSQL",
  });
  processes.push(await startLoggedProcess(nodeBin, ["apps/api/dist/index.js"], { env: apiEnvironment, logFile: path.join(tmpDir, "api.log") }));
  processes.push(await startLoggedProcess(pnpmCommand(), ["--filter", "@tab10/web", "exec", "vite", "preview", "--host", "localhost", "--port", "5417", "--strictPort"], { env: webEnvironment, logFile: path.join(tmpDir, "web.log") }));
  await waitForHttp("http://localhost:5417/health", processes);
  const health = await (await fetch("http://localhost:5417/health")).json();
  await runCommand(nodeBin, [path.join(evidenceDir, "admin-audit-runner.mjs")], { env: runnerEnvironment, label: "Run isolated ADMIN browser audit" });
  await writeJson(path.join(evidenceDir, "environment.json"), {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    toolchain: { node: process.version, pnpm: "9.15.0", browser: "bundled Chromium", postgres: "16.15-alpine pinned by digest" },
    runtime: { web: "http://localhost:5417", api: "http://127.0.0.1:5418", databasePort: 33030, dockerProject, disposable: true, storage: "tmpfs" },
    release,
    health: { status: health.status, release: health.release },
    secretsPersisted: false,
  });
} catch (error) {
  failure = error;
} finally {
  for (const processHandle of processes.reverse()) await terminateProcess(processHandle);
  if (composeUp) {
    try {
      await runCommand("docker", ["compose", "-f", composeFile, "-p", dockerProject, "down", "--volumes", "--remove-orphans"], { label: "Remove disposable ADMIN audit runtime" });
    } catch (error) {
      failure ??= error;
    }
  }
  await rm(tmpDir, { recursive: true, force: true });
  const ports = {};
  for (const port of [5417, 5418, 33030]) {
    try { await assertPortFree(port); ports[port] = "free"; }
    catch { ports[port] = "occupied"; }
  }
  await writeJson(path.join(evidenceDir, "cleanup.json"), {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    status: failure || Object.values(ports).includes("occupied") ? "attention" : "complete",
    dockerProjectRemoved: composeUp,
    tmpDirectoryRemoved: true,
    ports,
    secretsPersisted: false,
  });
}

if (failure) throw failure;
