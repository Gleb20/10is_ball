#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import {
  ROOT,
  assertToolchain,
  detectComposeCommand,
  disposableDatabaseUrl,
  ensureDir,
  pnpmCommand,
  readRootProductVersion,
  runCommand,
  startLoggedProcess,
  terminateProcess,
} from "./lib.mjs";
import { localDevelopmentBaseEnvironment } from "./local-development-environment.mjs";

const evidenceDir = await ensureDir(
  path.join(os.tmpdir(), "tab10-evidence", `dev-${process.pid}`),
);
await assertToolchain({ lane: "dev", directory: evidenceDir, requireDocker: true });
const compose = await detectComposeCommand();
const project = "tab10-dev";
const productVersion = await readRootProductVersion();
const localBaseEnvironment = localDevelopmentBaseEnvironment();
const composeArgs = [
  ...compose.prefix,
  "-f",
  path.join(ROOT, "docker-compose.yml"),
  "-p",
  project,
];
const migrationDatabaseUrl = disposableDatabaseUrl({
  username: "tab10_migration_owner",
  password: "local",
  database: "tab10",
  port: 5432,
});
const runtimeDatabaseUrl = disposableDatabaseUrl({
  username: "tab10_runtime",
  password: "local",
  database: "tab10",
  port: 5432,
});
let devProcess;
let composeStarted = false;
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  await terminateProcess(devProcess);
  if (composeStarted) {
    try {
      await runCommand(
        compose.command,
        [...composeArgs, "down", "--remove-orphans"],
        { label: "Stop local PostgreSQL (data volume preserved)" },
      );
    } finally {
      composeStarted = false;
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await stop();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

try {
  // Cleanup must also run when Compose creates the container but readiness fails.
  composeStarted = true;
  await runCommand(
    compose.command,
    [...composeArgs, "up", "-d", "--wait", "--wait-timeout", "90"],
    { label: "Start pinned local PostgreSQL 16.15" },
  );

  const migrationEnvironment = {
    ...localBaseEnvironment,
    MIGRATION_DATABASE_URL: migrationDatabaseUrl,
    TAB10_ENVIRONMENT: "local",
    TAB10_RUNTIME_DATABASE_ROLE: "tab10_runtime",
  };
  delete migrationEnvironment.DATABASE_URL;
  await runCommand(
    process.execPath,
    [path.join(ROOT, "scripts/verify/apply-local-role-policy.mjs")],
    {
      env: migrationEnvironment,
      label: "Reconcile local migration-owner/runtime role policy",
    },
  );
  await runCommand(
    pnpmCommand(),
    ["run", "build:api"],
    { env: migrationEnvironment, label: "Build the canonical migration entrypoint" },
  );
  await runCommand(
    pnpmCommand(),
    ["run", "db:migrate", "--", "--mode=apply"],
    { env: migrationEnvironment, label: "Apply local migrations with migrator role" },
  );

  const runtimeEnvironment = {
    ...localBaseEnvironment,
    DATABASE_URL: runtimeDatabaseUrl,
    MIGRATE_ON_BOOT: "0",
    NODE_ENV: "development",
    WEB_ORIGIN: "http://localhost:5173",
    HOST: "127.0.0.1",
    PORT: "3001",
    COOKIE_SAME_SITE: "",
    VITE_API_BASE_URL: "",
    TAB10_API_PROXY_TARGET: "http://127.0.0.1:3001",
    SEED_ADMIN: process.env.SEED_ADMIN ?? "0",
    TAB10_RELEASE_SHA: "local",
    TAB10_RELEASE_VERSION: productVersion,
    TAB10_ENVIRONMENT: "local",
    TAB10_RELEASE_DIRTY: "true",
  };
  delete runtimeEnvironment.MIGRATION_DATABASE_URL;
  delete runtimeEnvironment.PGLITE_DATA_DIR;
  delete runtimeEnvironment.AUDIT_EPHEMERAL;
  devProcess = await startLoggedProcess(
    pnpmCommand(),
    ["run", "--parallel", "--filter", "@tab10/api", "--filter", "@tab10/web", "dev"],
    { env: runtimeEnvironment, logFile: path.join(evidenceDir, "dev.log") },
  );
  const exit = await new Promise((resolve) => {
    devProcess.once("close", (code, signal) => resolve({ code, signal }));
  });
  if (exit.code !== 0) throw new Error(`Development servers exited with ${exit.code ?? exit.signal}`);
} finally {
  await stop();
}
