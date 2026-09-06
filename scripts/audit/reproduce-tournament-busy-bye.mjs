#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const API_ROOT = path.join(ROOT, "apps/api");
const TEST_TITLE =
  "BUG-015 characterization: busy organizer with a bye incorrectly starts tournament";
const result = spawnSync(
  process.execPath,
  [
    path.join(API_ROOT, "node_modules/vitest/vitest.mjs"),
    "run",
    "src/domain.integration.test.ts",
    "-t",
    "BUG-015 characterization",
    "--reporter=json",
  ],
  {
    cwd: API_ROOT,
    encoding: "utf8",
    env: process.env,
  },
);

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
let report;
try {
  report = JSON.parse(result.stdout ?? "");
} catch {
  report = undefined;
}
const assertions =
  report?.testResults?.flatMap((suite) => suite.assertionResults ?? []) ?? [];
const matchingAssertion = assertions.find(
  (assertion) => assertion.title === TEST_TITLE,
);
const reproduced =
  result.status === 0 &&
  report?.success === true &&
  report?.numPassedTests === 1 &&
  matchingAssertion?.status === "passed";

if (reproduced) {
  console.log(
    "Reproduced deterministic busy-player/bye defect with the audit bye seed.",
  );
  console.log(
    "The tournament incorrectly starts because the busy organizer receives a bye.",
  );
} else {
  console.error(
    "Known defect characterization did not pass. Inspect BUG-015 and update its backlog status.",
  );
  console.error(`Focused test exit status: ${result.status}`);
  const summary = output.trim().slice(-2500);
  if (summary) console.error(summary);
  process.exitCode = 1;
}
