#!/usr/bin/env node

import path from "node:path";
import { writeFile } from "node:fs/promises";
import {
  assertNodeTapReport,
  assertVitestReport,
  summarizeNodeTapReport,
  summarizeVitestReport,
} from "./assert-test-report.mjs";
import {
  ROOT,
  assertToolchain,
  captureCommand,
  ensureDir,
  pnpmCommand,
  resolveEvidenceDir,
  runCommand,
  writeJson,
} from "./lib.mjs";

const evidenceDir = await ensureDir(resolveEvidenceDir("fast"));
await assertToolchain({ lane: "fast", directory: evidenceDir });

const exclusions = [
  {
    path: "apps/api/src/postgres-date.integration.test.ts",
    reason: "Executed as a required, zero-skip suite by verify:postgres.",
    coveredBy: "scripts/verify/run-postgres.mjs",
  },
  {
    path: "apps/api/src/db/migrations.postgres.integration.test.ts",
    reason: "Executed as a required, zero-skip suite by verify:postgres.",
    coveredBy: "scripts/verify/run-postgres.mjs",
  },
  {
    path: "packages/shared/src/tournament-bracket-v1.characterization.test.ts",
    reason:
      "Contains the pre-existing D25 V1 DE hang todo. The bounded product fix belongs to the product wave, outside delivery-foundation PR1.",
    activeCoverage: [
      "packages/shared/src/tournament-bracket-v1.test.ts",
      "packages/shared/src/bracket-v2/property.test.ts",
      "packages/shared/src/bracket-v2/bracket-v2.test.ts",
    ],
  },
];
await writeJson(path.join(evidenceDir, "fast-suite-manifest.json"), {
  schemaVersion: 1,
  policy: "Every executed release-lane test must report 0 failed, 0 skipped and 0 todo.",
  exclusions,
});

const suites = [
  {
    name: "shared",
    filter: "@tab10/shared",
    extraArgs: ["--exclude", "src/tournament-bracket-v1.characterization.test.ts"],
  },
  { name: "test-utils", filter: "@tab10/test-utils", extraArgs: [] },
  { name: "web", filter: "@tab10/web", extraArgs: [] },
  {
    name: "api",
    filter: "@tab10/api",
    extraArgs: [
      "--exclude",
      "src/postgres-date.integration.test.ts",
      "--exclude",
      "src/db/migrations.postgres.integration.test.ts",
    ],
  },
];

const summaries = [];
let failure;
for (const suite of suites) {
  const report = path.join(evidenceDir, `vitest-${suite.name}.json`);
  let commandFailure;
  try {
    await runCommand(
      pnpmCommand(),
      [
        "--filter",
        suite.filter,
        "exec",
        "vitest",
        "run",
        ...suite.extraArgs,
        "--reporter=json",
        `--outputFile=${report}`,
      ],
      { label: `Vitest fast suite: ${suite.name}` },
    );
  } catch (error) {
    commandFailure = error;
  }
  try {
    summaries.push({
      name: suite.name,
      ...(await summarizeVitestReport(report)),
    });
    await assertVitestReport(report);
    if (commandFailure) throw commandFailure;
  } catch (error) {
    failure = error;
    break;
  }
}

const nodeSuites = [
  {
    name: "release-scripts",
    file: "scripts/release/release-scripts.test.mjs",
    label: "Required release scripts Node test suite",
  },
  {
    name: "verify-scripts",
    file: "scripts/verify/verify-scripts.test.mjs",
    label: "Verification command contract Node test suite",
  },
  {
    name: "trace-sanitizer",
    file: "scripts/verify/sanitize-playwright-traces.test.mjs",
    label: "Sanitized Playwright trace Node test suite",
  },
  {
    name: "release-gate",
    file: "scripts/verify/assert-release-gate.test.mjs",
    label: "Release gate aggregation Node test suite",
  },
];

for (const suite of nodeSuites) {
  if (failure) break;
  const report = path.join(evidenceDir, `node-${suite.name}.tap`);
  let commandFailure;
  let tap;
  try {
    tap = await captureCommand(
      process.execPath,
      ["--test", "--test-reporter=tap", suite.file],
      { cwd: ROOT },
    );
  } catch (error) {
    commandFailure = error;
    tap = error?.stdout?.trim();
  }
  try {
    if (!tap) throw commandFailure ?? new Error(`${suite.label} TAP output is empty`);
    console.log(`\n> ${suite.label}`);
    console.log(tap);
    await writeFile(report, `${tap}\n`, "utf8");
    summaries.push({
      name: suite.name,
      ...(await summarizeNodeTapReport(report)),
    });
    await assertNodeTapReport(report);
    if (commandFailure) throw commandFailure;
  } catch (error) {
    failure = error;
  }
}

const totals = summaries.reduce(
  (total, suite) => ({
    total: total.total + suite.total,
    passed: total.passed + suite.passed,
    failed: total.failed + suite.failed,
    skipped: total.skipped + suite.skipped,
    todo: total.todo + suite.todo,
    interrupted: total.interrupted + suite.interrupted,
  }),
  {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    todo: 0,
    interrupted: 0,
  },
);
if (
  failure &&
  totals.failed + totals.skipped + totals.todo + totals.interrupted === 0
) {
  totals.total += 1;
  totals.failed += 1;
}

await writeJson(path.join(evidenceDir, "fast-summary.json"), {
  schemaVersion: 1,
  status: failure ? "failed" : "passed",
  totals,
  suites: summaries,
  exclusions,
});

if (failure) throw failure;
console.log(
  `verify:fast tests: ${totals.passed} passed, 0 failed, 0 skipped, 0 todo, 0 interrupted`,
);
