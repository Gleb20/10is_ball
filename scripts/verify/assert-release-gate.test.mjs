import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertReleaseGate,
  evaluateReleaseGate,
} from "./assert-release-gate.mjs";

const base = {
  QUALITY_RESULT: "success",
  POSTGRES_RESULT: "success",
  BROWSER_RESULT: "success",
  GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
};

test("release gate accepts exactly three successful verification lanes", () => {
  assert.deepEqual(evaluateReleaseGate(base), {
    schemaVersion: 1,
    status: "passed",
    lanes: { quality: "success", postgres: "success", browser: "success" },
    failedLanes: [],
    sha: base.GITHUB_SHA,
  });
});

for (const [lane, variable] of [
  ["quality", "QUALITY_RESULT"],
  ["postgres", "POSTGRES_RESULT"],
  ["browser", "BROWSER_RESULT"],
]) {
  test(`${lane} independently fails closed for failed, skipped and neutral`, () => {
    for (const result of ["failure", "cancelled", "skipped", "neutral", ""]) {
      const evaluated = evaluateReleaseGate({ ...base, [variable]: result });
      assert.equal(evaluated.status, "failed");
      assert.deepEqual(evaluated.failedLanes, [lane]);
    }
  });
}

test("release gate persists negative evidence before rejecting", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tab10-release-gate-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const resultFile = path.join(directory, "result.json");
  await assert.rejects(
    assertReleaseGate({
      ...base,
      POSTGRES_RESULT: "skipped",
      VERIFY_RELEASE_GATE_RESULT: resultFile,
    }),
    /postgres/,
  );
  const evidence = JSON.parse(await readFile(resultFile, "utf8"));
  assert.equal(evidence.status, "failed");
  assert.deepEqual(evidence.failedLanes, ["postgres"]);
});
