import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const POSTGRES_IMAGE =
  "postgres:16.15-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685";
export const RUNTIME_TEST_DATABASE_ROLE = "tab10_runtime_test";
const POSTGRES_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export function pnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

export function resolveEvidenceDir(lane) {
  const configured = process.env.VERIFY_EVIDENCE_DIR?.trim();
  return configured || path.join(os.tmpdir(), "tab10-evidence", `${lane}-${process.pid}`);
}

export function disposableDatabaseUrl({
  username,
  password,
  database,
  port,
}) {
  const url = new URL(["postgresql", "://127.0.0.1/"].join(""));
  url.username = username;
  if (password) url.password = password;
  url.port = String(port);
  url.pathname = `/${database}`;
  return url.href;
}

export function databaseUrlForRole(databaseUrl, role) {
  if (!POSTGRES_IDENTIFIER.test(role)) {
    throw new Error("Runtime database role must be a safe lowercase PostgreSQL identifier");
  }
  const url = new URL(databaseUrl);
  url.username = role;
  url.password = "";
  return url.href;
}

export async function ensureDir(directory) {
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readRootProductVersion() {
  const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const version = packageJson.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("Root package.json must contain an exact semantic product version");
  }
  return version;
}

async function migrationFileEvidence() {
  const base = path.join(ROOT, "apps/api/drizzle");
  const files = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name.endsWith(".sql")) files.push(absolute);
    }
  }
  await visit(base);
  const result = [];
  for (const file of files.sort()) {
    const bytes = await readFile(file);
    result.push({
      path: path.relative(ROOT, file),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  if (result.length === 0) {
    throw new Error("No versioned SQL migration files were found for evidence");
  }
  return result;
}

export async function captureCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      const error = new Error(
        `${command} exited with ${code ?? signal}: ${(stderr || stdout).trim()}`,
      );
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

export async function runCommand(command, args, options = {}) {
  const printable = options.label ?? [command, ...args].join(" ");
  console.log(`\n> ${printable}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: options.detached ?? false,
    });
    const log = options.logFile ? createWriteStream(options.logFile, { flags: "a" }) : null;
    const relay = (target, chunk) => {
      target.write(chunk);
      log?.write(chunk);
    };
    child.stdout.on("data", (chunk) => relay(process.stdout, chunk));
    child.stderr.on("data", (chunk) => relay(process.stderr, chunk));
    child.once("error", (error) => {
      log?.end();
      reject(error);
    });
    child.once("close", (code, signal) => {
      log?.end();
      if (code === 0) {
        resolve({ code, signal });
        return;
      }
      reject(new Error(`${printable} exited with ${code ?? signal}`));
    });
  });
}

export async function startLoggedProcess(command, args, options) {
  await ensureDir(path.dirname(options.logFile));
  const log = createWriteStream(options.logFile, { flags: "a" });
  const child = spawn(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const relay = (target, chunk) => {
    target.write(chunk);
    log.write(chunk);
  };
  child.stdout.on("data", (chunk) => relay(process.stdout, chunk));
  child.stderr.on("data", (chunk) => relay(process.stderr, chunk));
  child.once("close", () => log.end());
  return child;
}

export async function terminateProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const target = process.platform === "win32" ? child.pid : -child.pid;
  try {
    process.kill(target, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
    return;
  }
  const exited = new Promise((resolve) => child.once("close", resolve));
  const timeout = new Promise((resolve) => setTimeout(resolve, 5_000, "timeout"));
  if ((await Promise.race([exited, timeout])) === "timeout") {
    try {
      process.kill(target, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
}

export async function assertPortFree(port, host = "127.0.0.1") {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      reject(new Error(`Port ${host}:${port} is already in use`));
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", (error) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED" || error.code === "EHOSTUNREACH") {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

export async function waitForHttp(url, childProcesses, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    for (const child of childProcesses) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Server exited before ${url} became ready`);
      }
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

export function validateDisposableDatabaseEnvironment(env = process.env) {
  if (env.NODE_ENV !== "test") {
    throw new Error("NODE_ENV=test is required for disposable PostgreSQL verification");
  }
  if (env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL must be unset before disposable verification starts");
  }
  if (env.ALLOW_TEST_DATABASE_RESET !== "1") {
    throw new Error("ALLOW_TEST_DATABASE_RESET=1 is required");
  }
  const raw = env.TEST_DATABASE_URL?.trim();
  if (!raw) throw new Error("TEST_DATABASE_URL is required");
  const parsed = new URL(raw);
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error("TEST_DATABASE_URL must be PostgreSQL");
  }
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(parsed.hostname.toLowerCase())) {
    throw new Error("TEST_DATABASE_URL must target loopback");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!/(?:^|[-_])test(?:$|[-_])/i.test(databaseName)) {
    throw new Error('TEST_DATABASE_URL database name must contain a standalone "test" segment');
  }
  return raw;
}

export async function writeEnvironmentEvidence(lane, directory) {
  const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const lock = await readFile(path.join(ROOT, "pnpm-lock.yaml"));
  const gitSha = await captureCommand("git", ["rev-parse", "HEAD"]);
  const worktreeStatus = await captureCommand("git", ["status", "--porcelain"]);
  const pnpmVersion = await captureCommand(pnpmCommand(), ["--version"]);
  const evidence = {
    schemaVersion: 1,
    lane,
    createdAt: new Date().toISOString(),
    gitSha,
    worktreeDirty: Boolean(worktreeStatus),
    node: process.versions.node,
    pnpm: pnpmVersion,
    expectedNode: (await readFile(path.join(ROOT, ".node-version"), "utf8")).trim(),
    expectedPnpm: String(packageJson.packageManager).replace(/^pnpm@/, ""),
    expectedPlaywright: packageJson.devDependencies?.["@playwright/test"],
    platform: process.platform,
    arch: process.arch,
    lockfileSha256: createHash("sha256").update(lock).digest("hex"),
    postgresImage: POSTGRES_IMAGE,
    migrationFiles: await migrationFileEvidence(),
  };
  await writeJson(path.join(directory, "environment.json"), evidence);
  return evidence;
}

export async function updateEnvironmentEvidence(directory, fields) {
  const file = path.join(directory, "environment.json");
  const current = JSON.parse(await readFile(file, "utf8"));
  const updated = { ...current, ...fields };
  await writeJson(file, updated);
  return updated;
}

export async function capturePostgresVersion(databaseUrl) {
  const script = [
    'const postgres = (await import("postgres")).default;',
    'const sql = postgres(process.env.TAB10_VERIFY_DATABASE_URL, { max: 1 });',
    'try { const rows = await sql.unsafe("select current_setting(\'server_version\') as version"); process.stdout.write(rows[0].version); }',
    'finally { await sql.end({ timeout: 5 }); }',
  ].join(" ");
  const env = { ...process.env, TAB10_VERIFY_DATABASE_URL: databaseUrl };
  const version = await captureCommand(
    pnpmCommand(),
    [
      "--filter",
      "@tab10/api",
      "exec",
      "node",
      "--input-type=module",
      "--eval",
      script,
    ],
    { env },
  );
  if (!version.startsWith("16.15")) {
    throw new Error(`PostgreSQL 16.15 is required; found ${version}`);
  }
  return version;
}

export async function assertToolchain({
  lane,
  directory,
  requireDocker = false,
  requireBrowser = false,
}) {
  let evidence = await writeEnvironmentEvidence(lane, directory);
  if (evidence.node !== evidence.expectedNode) {
    throw new Error(`Node ${evidence.expectedNode} is required; found ${evidence.node}`);
  }
  if (evidence.pnpm !== evidence.expectedPnpm) {
    throw new Error(`pnpm ${evidence.expectedPnpm} is required; found ${evidence.pnpm}`);
  }
  if (requireDocker) {
    const compose = await detectComposeCommand();
    const composeVersion = await captureCommand(compose.command, [
      ...compose.prefix,
      "version",
      "--short",
    ]).catch(() => captureCommand(compose.command, [...compose.prefix, "version"]));
    const dockerVersion = await captureCommand("docker", [
      "version",
      "--format",
      "{{.Client.Version}}|{{.Server.Version}}",
    ]);
    const [dockerClient, dockerServer] = dockerVersion.split("|");
    if (!dockerClient || !dockerServer) {
      throw new Error("Docker client and server versions must both be available");
    }
    evidence = await updateEnvironmentEvidence(directory, {
      dockerClient,
      dockerServer,
      dockerCompose: composeVersion,
    });
  }
  if (requireBrowser) {
    const { chromium } = await import("@playwright/test");
    const executable = chromium.executablePath();
    await access(executable);
    const [playwrightVersion, chromiumVersion] = await Promise.all([
      captureCommand(pnpmCommand(), ["exec", "playwright", "--version"]),
      captureCommand(executable, ["--version"]),
    ]);
    if (!/^\d+\.\d+\.\d+$/.test(evidence.expectedPlaywright ?? "")) {
      throw new Error("@playwright/test must use an exact version in root package.json");
    }
    const installedPlaywright = playwrightVersion.replace(/^Version\s+/, "");
    if (installedPlaywright !== evidence.expectedPlaywright) {
      throw new Error(
        `Playwright ${evidence.expectedPlaywright} is required; found ${installedPlaywright}`,
      );
    }
    evidence = await updateEnvironmentEvidence(directory, {
      playwright: playwrightVersion,
      chromium: chromiumVersion,
      chromiumSource: "Playwright-managed lockfile revision",
    });
  }
  return evidence;
}

export async function detectComposeCommand() {
  try {
    await captureCommand("docker", ["compose", "version"]);
    return { command: "docker", prefix: ["compose"] };
  } catch (dockerPluginError) {
    try {
      await captureCommand("docker-compose", ["version"]);
      return { command: "docker-compose", prefix: [] };
    } catch {
      throw new Error(
        `Docker Compose is required (docker compose or docker-compose): ${dockerPluginError.message}`,
      );
    }
  }
}
