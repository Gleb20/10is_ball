#!/usr/bin/env node

import path from "node:path";
import {
  assertToolchain,
  resolveEvidenceDir,
  writeJson,
} from "./lib.mjs";

const requireDocker = process.argv.includes("--require-docker");
const requireBrowser = process.argv.includes("--require-browser");
const evidenceDir = resolveEvidenceDir("doctor");
let status = "failed";
let toolchain;
let failureMessage;

try {
  const evidence = await assertToolchain({
    lane: requireDocker ? "doctor-full" : "doctor",
    directory: evidenceDir,
    requireDocker,
    requireBrowser,
  });
  status = "passed";
  const versions = [`Node ${evidence.node}`, `pnpm ${evidence.pnpm}`];
  if (requireDocker) {
    versions.push(
      `Docker client ${evidence.dockerClient}`,
      `Docker server ${evidence.dockerServer}`,
      `Compose ${evidence.dockerCompose}`,
    );
  }
  if (requireBrowser) {
    versions.push(evidence.playwright, evidence.chromium);
  }
  console.log(`Toolchain ready: ${versions.join(", ")}`);
  toolchain = versions;
} catch (error) {
  failureMessage = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await writeJson(path.join(evidenceDir, "doctor-summary.json"), {
    schemaVersion: 1,
    status,
    requireDocker,
    requireBrowser,
    ...(toolchain ? { toolchain } : {}),
    ...(failureMessage ? { error: failureMessage } : {}),
  });
}
