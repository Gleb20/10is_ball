#!/usr/bin/env node

import { readFile } from "node:fs/promises";

function ensureZero(summary, source) {
  for (const name of ["total", "passed", "failed", "skipped", "todo", "interrupted"]) {
    if (!Number.isInteger(summary[name]) || summary[name] < 0) {
      throw new Error(`${source}: ${name} must be a non-negative integer`);
    }
  }
  if (summary.total === 0) throw new Error(`${source}: no tests were executed`);
  const counted =
    summary.passed +
    summary.failed +
    summary.skipped +
    summary.todo +
    summary.interrupted;
  if (counted !== summary.total) {
    throw new Error(
      `${source}: report counters do not add up (${counted} counted, ${summary.total} total)`,
    );
  }
  if (summary.failed || summary.skipped || summary.todo || summary.interrupted) {
    throw new Error(
      `${source}: expected 0 failed/skipped/todo/interrupted, got ${JSON.stringify(summary)}`,
    );
  }
  console.log(
    `${source}: ${summary.passed} passed, 0 failed, 0 skipped, 0 todo, 0 interrupted`,
  );
  return summary;
}

export function assertAggregateTestSummary(
  summary,
  expectedLaneNames,
  source = "aggregate test summary",
) {
  if (summary?.status !== "passed") {
    throw new Error(`${source}: aggregate status must be passed`);
  }
  if (!Array.isArray(summary.lanes)) {
    throw new Error(`${source}: lane summaries are required`);
  }
  const expected = [...expectedLaneNames].sort();
  const actual = summary.lanes.map((lane) => lane.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${source}: lane set does not match the required verification lanes`);
  }
  for (const lane of summary.lanes) {
    if (lane.status !== "passed") {
      throw new Error(`${source}: ${lane.name} lane status must be passed`);
    }
    ensureZero(lane, `${source}/${lane.name}`);
  }
  const laneTotals = summary.lanes.reduce(
    (total, lane) => ({
      total: total.total + lane.total,
      passed: total.passed + lane.passed,
      failed: total.failed + lane.failed,
      skipped: total.skipped + lane.skipped,
      todo: total.todo + lane.todo,
      interrupted: total.interrupted + lane.interrupted,
    }),
    { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0, interrupted: 0 },
  );
  if (
    Object.keys(laneTotals).some(
      (name) => summary.totals?.[name] !== laneTotals[name],
    )
  ) {
    throw new Error(`${source}: aggregate totals do not equal the lane totals`);
  }
  return ensureZero(summary.totals, source);
}

export async function summarizeVitestReport(file) {
  const report = JSON.parse(await readFile(file, "utf8"));
  const assertions = (report.testResults ?? []).flatMap(
    (suite) => suite.assertionResults ?? [],
  );
  const statusCount = (statuses) =>
    assertions.filter((test) => statuses.includes(test.status)).length;
  const total = Number(report.numTotalTests ?? assertions.length);
  const todo = Number(report.numTodoTests ?? statusCount(["todo"]));
  const pending = Number(
    report.numPendingTests ?? statusCount(["pending", "skipped", "disabled"]),
  );
  const failed = Number(report.numFailedTests ?? statusCount(["failed"]));
  const passed = Number(report.numPassedTests ?? statusCount(["passed"]));
  return {
    total,
    passed,
    failed,
    skipped: Math.max(0, pending - todo),
    todo,
    interrupted: 0,
  };
}

export async function assertVitestReport(file) {
  return ensureZero(await summarizeVitestReport(file), file);
}

function collectPlaywrightTests(suites, target = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) target.push(...(spec.tests ?? []));
    collectPlaywrightTests(suite.suites, target);
  }
  return target;
}

export async function summarizePlaywrightReport(file) {
  const report = JSON.parse(await readFile(file, "utf8"));
  const tests = collectPlaywrightTests(report.suites);
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let interrupted = 0;
  for (const test of tests) {
    if (test.status === "skipped" || test.expectedStatus === "skipped") {
      skipped += 1;
      continue;
    }
    const result = test.results?.at(-1);
    const status = result?.status ?? test.status;
    if (status === "passed") passed += 1;
    else if (status === "skipped") skipped += 1;
    else if (status === "interrupted") interrupted += 1;
    else failed += 1;
  }
  return { total: tests.length, passed, failed, skipped, todo: 0, interrupted };
}

export async function assertPlaywrightReport(file) {
  return ensureZero(await summarizePlaywrightReport(file), file);
}

function readTapCounter(tap, name, source) {
  const matches = [...tap.matchAll(new RegExp(`^# ${name} (\\d+)\\s*$`, "gm"))];
  if (matches.length === 0) {
    throw new Error(`${source}: missing TAP summary counter "${name}"`);
  }
  return Number(matches.at(-1)[1]);
}

export async function summarizeNodeTapReport(file) {
  const tap = await readFile(file, "utf8");
  const total = readTapCounter(tap, "tests", file);
  const passed = readTapCounter(tap, "pass", file);
  const failed = readTapCounter(tap, "fail", file);
  const interrupted = readTapCounter(tap, "cancelled", file);
  const skipped = readTapCounter(tap, "skipped", file);
  const todo = readTapCounter(tap, "todo", file);
  return { total, passed, failed, skipped, todo, interrupted };
}

export async function assertNodeTapReport(file) {
  return ensureZero(await summarizeNodeTapReport(file), file);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [kind, file] = process.argv.slice(2);
  if (!file || !new Set(["vitest", "playwright", "node-tap"]).has(kind)) {
    throw new Error(
      "Usage: assert-test-report.mjs <vitest|playwright|node-tap> <report-file>",
    );
  }
  if (kind === "vitest") await assertVitestReport(file);
  else if (kind === "playwright") await assertPlaywrightReport(file);
  else await assertNodeTapReport(file);
}
