#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import {
  ROOT,
  assertToolchain,
  ensureDir,
  pnpmCommand,
  readRootProductVersion,
  runCommand,
  startLoggedProcess,
  terminateProcess,
} from "./lib.mjs";
import { localDevelopmentBaseEnvironment } from "./local-development-environment.mjs";

const evidenceDir = await ensureDir(
  path.join(os.tmpdir(), "tab10-evidence", `dev-pglite-${process.pid}`),
);
await assertToolchain({ lane: "dev-pglite", directory: evidenceDir });
const dataDir = path.resolve(
  process.env.PGLITE_DATA_DIR?.trim() || path.join(ROOT, ".data/pglite"),
);
const productVersion = await readRootProductVersion();
const environment = {
  ...localDevelopmentBaseEnvironment(),
  NODE_ENV: "development",
  DATABASE_URL: "",
  MIGRATION_DATABASE_URL: "",
  TEST_DATABASE_URL: "",
  ALLOW_TEST_DATABASE_RESET: "",
  AUDIT_EPHEMERAL: "",
  PGLITE_DATA_DIR: dataDir,
  WEB_ORIGIN: "http://localhost:5173",
  HOST: "127.0.0.1",
  PORT: "3001",
  COOKIE_SAME_SITE: "",
  VITE_API_BASE_URL: "",
  TAB10_API_PROXY_TARGET: "http://127.0.0.1:3001",
  TAB10_RELEASE_SHA: "local-pglite",
  TAB10_RELEASE_VERSION: productVersion,
  TAB10_ENVIRONMENT: "local",
  TAB10_RELEASE_DIRTY: "true",
};

await runCommand(
  pnpmCommand(),
  ["--filter", "@tab10/api", "run", "db:migrate:pglite", "--mode=apply"],
  { env: environment, label: "Apply explicit PGlite development migrations" },
);

let devProcess;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await terminateProcess(devProcess);
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await stop();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

try {
  devProcess = await startLoggedProcess(
    pnpmCommand(),
    ["run", "--parallel", "--filter", "@tab10/api", "--filter", "@tab10/web", "dev"],
    { env: environment, logFile: path.join(evidenceDir, "dev-pglite.log") },
  );
  const exit = await new Promise((resolve) => {
    devProcess.once("close", (code, signal) => resolve({ code, signal }));
  });
  if (exit.code !== 0) throw new Error(`PGlite development servers exited with ${exit.code ?? exit.signal}`);
} finally {
  await stop();
}
