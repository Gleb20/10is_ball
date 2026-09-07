#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ensureDir } from "./lib.mjs";

const LANES = [
  ["quality", "QUALITY_RESULT"],
  ["postgres", "POSTGRES_RESULT"],
  ["browser", "BROWSER_RESULT"],
];

export function evaluateReleaseGate(environment) {
  const lanes = Object.fromEntries(
    LANES.map(([lane, variable]) => [lane, String(environment[variable] ?? "")]),
  );
  const failedLanes = Object.entries(lanes)
    .filter(([, result]) => result !== "success")
    .map(([lane]) => lane);
  return {
    schemaVersion: 1,
    status: failedLanes.length === 0 ? "passed" : "failed",
    lanes,
    failedLanes,
    sha: String(environment.GITHUB_SHA ?? ""),
  };
}

export async function assertReleaseGate(environment = process.env) {
  const resultFile = environment.VERIFY_RELEASE_GATE_RESULT?.trim();
  if (!resultFile) throw new Error("VERIFY_RELEASE_GATE_RESULT is required");
  const result = evaluateReleaseGate(environment);
  await ensureDir(path.dirname(resultFile));
  await writeFile(resultFile, `${JSON.stringify(result, null, 2)}\n`, {
    mode: 0o600,
  });
  if (result.status !== "passed") {
    throw new Error(`Release gate rejected non-success lanes: ${result.failedLanes.join(", ")}`);
  }
  return result;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  assertReleaseGate()
    .then((result) => {
      process.stdout.write(
        `Release gate: ${Object.keys(result.lanes).length} passed, 0 failed, 0 skipped, 0 neutral\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
