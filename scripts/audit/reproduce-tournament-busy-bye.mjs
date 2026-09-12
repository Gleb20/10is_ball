#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const API_ROOT = path.join(ROOT, "apps/api");
const TEST_TITLE =
  "AT-TRN-020/BUG-015: busy organizer with a bye cannot start and tournament state is unchanged";
const result = spawnSync(
  process.execPath,
  [
    path.join(API_ROOT, "node_modules/vitest/vitest.mjs"),
    "run",
    "src/domain.integration.test.ts",
    "-t",
    TEST_TITLE,
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
const verified =
  result.status === 0 &&
  report?.success === true &&
  report?.numPassedTests === 1 &&
  matchingAssertion?.status === "passed";

if (verified) {
  console.log(
    "Verified the deterministic busy-player/bye tournament-start regression.",
  );
  console.log(
    "The busy organizer receives a bye, start is rejected, and tournament state is unchanged.",
  );
} else {
  console.error(
    "BUG-015 regression verification did not pass. Inspect the tournament-start guard.",
  );
  console.error(`Focused test exit status: ${result.status}`);
  const summary = output.trim().slice(-2500);
  if (summary) console.error(summary);
  process.exitCode = 1;
}
