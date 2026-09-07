#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ROOT,
  assertPortFree,
  captureCommand,
  detectComposeCommand,
  ensureDir,
  resolveEvidenceDir,
  runCommand,
  writeJson,
} from "./lib.mjs";

const evidenceDir = await ensureDir(resolveEvidenceDir("cleanup-foundation"));
const compose = await detectComposeCommand();
const cases = [
  { name: "success", expectedCode: 0 },
  { name: "induced-failure", expectedCode: 1 },
  { name: "sigint", signal: "SIGINT", expectedCode: 130 },
  { name: "sigterm", signal: "SIGTERM", expectedCode: 143 },
];

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForMarker(file, child, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      lastError = error;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("Cleanup probe exited before its disposable database was ready");
    }
    await wait(100);
  }
  throw new Error(`Cleanup probe readiness timed out: ${lastError?.code ?? "invalid marker"}`);
}

async function waitForExit(child, timeoutMs = 90_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Cleanup probe exit timed out"));
    }, timeoutMs);
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = (code, signal) => {
      cleanup();
      resolve({ code, signal });
    };
    function cleanup() {
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("close", onClose);
    }
    child.once("error", onError);
    child.once("close", onClose);
  });
}

async function resourceSnapshot(project) {
  const [containers, volumes, networks] = await Promise.all([
    captureCommand("docker", [
      "ps",
      "-a",
      "--filter",
      `label=com.docker.compose.project=${project}`,
      "--format",
      "{{.ID}}",
    ]),
    captureCommand("docker", [
      "volume",
      "ls",
      "--filter",
      `label=com.docker.compose.project=${project}`,
      "--format",
      "{{.Name}}",
    ]),
    captureCommand("docker", [
      "network",
      "ls",
      "--filter",
      `label=com.docker.compose.project=${project}`,
      "--format",
      "{{.Name}}",
    ]),
  ]);
  return {
    containers: containers ? containers.split(/\r?\n/).length : 0,
    volumes: volumes ? volumes.split(/\r?\n/).length : 0,
    networks: networks ? networks.split(/\r?\n/).length : 0,
  };
}

function processIsGone(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (error?.code === "ESRCH") return true;
    throw error;
  }
}

async function fallbackCleanup(project) {
  const args = [
    ...compose.prefix,
    "-f",
    path.join(ROOT, "compose.verify.yml"),
    "-p",
    project,
    "down",
    "--volumes",
    "--remove-orphans",
  ];
  await runCommand(compose.command, args, {
    label: `Cleanup harness fallback (${project})`,
  });
}

async function runCase(definition) {
  const caseDir = await ensureDir(path.join(evidenceDir, definition.name));
  const readyFile = path.join(caseDir, "ready.json");
  const child = spawn(process.execPath, [path.join(ROOT, "scripts/verify/run-local.mjs")], {
    cwd: ROOT,
    env: {
      ...process.env,
      VERIFY_EVIDENCE_DIR: caseDir,
      TAB10_INTERNAL_CLEANUP_PROBE: definition.name,
      TAB10_CLEANUP_PROBE_READY_FILE: readyFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const project = `tab10-verify-${child.pid}`;
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  let marker;
  let exit;
  let automaticCleanup;
  let failure;
  try {
    marker = await waitForMarker(readyFile, child);
    if (marker.project !== project || marker.pid !== child.pid) {
      throw new Error("Cleanup probe readiness marker did not match the child process");
    }
    if (definition.signal) child.kill(definition.signal);
    exit = await waitForExit(child);
    if (exit.code !== definition.expectedCode || exit.signal !== null) {
      throw new Error(
        `Cleanup probe expected exit ${definition.expectedCode}; got ${exit.code ?? exit.signal}`,
      );
    }
    const resources = await resourceSnapshot(project);
    const portFree = marker.port ? await assertPortFree(marker.port).then(() => true) : false;
    automaticCleanup = {
      ...resources,
      processGone: processIsGone(child.pid),
      portFree,
    };
    if (
      resources.containers !== 0 ||
      resources.volumes !== 0 ||
      resources.networks !== 0 ||
      !automaticCleanup.processGone ||
      !portFree
    ) {
      throw new Error("Cleanup probe left a process, port or Compose resource behind");
    }
  } catch (error) {
    failure = error;
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      try {
        await waitForExit(child, 15_000);
      } catch {
        child.kill("SIGKILL");
        await waitForExit(child, 15_000).catch(() => undefined);
      }
    }
    const beforeFallback = await resourceSnapshot(project).catch(() => ({
      containers: -1,
      volumes: -1,
      networks: -1,
    }));
    if (
      beforeFallback.containers !== 0 ||
      beforeFallback.volumes !== 0 ||
      beforeFallback.networks !== 0
    ) {
      await fallbackCleanup(project).catch(() => undefined);
    }
    const residual = await resourceSnapshot(project);
    if (
      residual.containers !== 0 ||
      residual.volumes !== 0 ||
      residual.networks !== 0
    ) {
      failure ??= new Error("Cleanup harness fallback left Compose resources behind");
    }
    await writeFile(path.join(caseDir, "probe.log"), output, { mode: 0o600 });
    await writeJson(path.join(caseDir, "case-summary.json"), {
      schemaVersion: 1,
      name: definition.name,
      status: failure ? "failed" : "passed",
      expectedExitCode: definition.expectedCode,
      actualExitCode: exit?.code ?? null,
      signal: definition.signal ?? null,
      project,
      port: marker?.port ?? null,
      automaticCleanup: automaticCleanup ?? null,
      residualAfterFallback: residual,
      ...(failure ? { reason: failure.message } : {}),
    });
  }
  return {
    name: definition.name,
    status: failure ? "failed" : "passed",
    ...(failure ? { reason: failure.message } : {}),
  };
}

const results = [];
for (const definition of cases) results.push(await runCase(definition));
const failed = results.filter((result) => result.status !== "passed").length;
const summary = {
  schemaVersion: 1,
  status: failed === 0 ? "passed" : "failed",
  totals: {
    total: results.length,
    passed: results.length - failed,
    failed,
    skipped: 0,
    todo: 0,
    interrupted: 0,
  },
  cases: results,
};
await writeJson(path.join(evidenceDir, "cleanup-summary.json"), summary);
if (failed > 0) throw new Error(`Cleanup harness failed ${failed} of ${results.length} cases`);
console.log(
  `Cleanup foundation: ${results.length} passed, 0 failed, 0 skipped, 0 todo, 0 interrupted`,
);
