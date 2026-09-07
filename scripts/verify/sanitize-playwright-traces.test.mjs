import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { sanitizePlaywrightTraces } from "./sanitize-playwright-traces.mjs";

const execFileAsync = promisify(execFile);
const email = "trace.admin@tab10.test";
const password = "SyntheticTracePassword9!";
const authorization = ["Bearer", "trace-authorization-sentinel"].join(" ");
const session = "tab10_session=trace-cookie-sentinel";
const stagingUrl = "https://candidate-staging.example.invalid/login?release=secret#state";

async function createTraceArchive(directory, { includeTrace = true } = {}) {
  const content = path.join(directory, "content");
  const source = path.join(directory, "raw");
  await mkdir(path.join(content, "resources"), { recursive: true });
  await mkdir(source, { recursive: true });
  if (includeTrace) {
    const events = [
      {
        version: 9,
        type: "context-options",
        options: { extraHTTPHeaders: { Authorization: authorization, Cookie: session } },
      },
      {
        type: "before",
        callId: "pw:api@1",
        class: "Test",
        method: "fill",
        title: `Fill ${email}`,
        params: { selector: "input[type=password]", value: password },
        stack: [{ file: "/home/private-user/tests/e2e/example.spec.ts", line: 1 }],
      },
      {
        type: "after",
        callId: "pw:api@1",
        result: {
          headers: { "set-cookie": session, authorization },
          body: `${email}:${password}`,
        },
        error: { message: `${authorization} ${session} ${email} ${password}` },
      },
      {
        type: "before",
        callId: "pw:api@2",
        class: "Test",
        method: "log",
        title: `Navigate to ${stagingUrl}; Cookie: ${session}`,
        params: {
          url: stagingUrl,
          nested: { origin: "https://candidate-staging.example.invalid" },
        },
      },
      { type: "stdout", text: `${email} ${password} ${authorization} ${session}` },
    ];
    await writeFile(
      path.join(content, "test.trace"),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    );
  }
  await writeFile(
    path.join(content, "resources", "credential-payload"),
    `${email}\n${password}\n${authorization}\n${session}\n`,
  );
  const archive = path.join(source, "trace.zip");
  const entries = includeTrace
    ? ["test.trace", "resources/credential-payload"]
    : ["resources/credential-payload"];
  await execFileAsync("zip", ["-X", "-q", archive, ...entries], {
    cwd: content,
  });
  return { archive, source };
}

test("sanitized trace keeps a minimal timeline and removes credentials and payloads", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tab10-trace-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const { archive, source } = await createTraceArchive(directory);
  const output = path.join(directory, "sanitized");
  const manifest = await sanitizePlaywrightTraces({
    sourceDirectory: source,
    outputDirectory: output,
    forbiddenValues: [email, password],
    requireTrace: true,
    deleteSource: true,
  });

  assert.equal(manifest.status, "passed");
  assert.equal(manifest.traceCount, 1);
  await assert.rejects(access(archive), /ENOENT/);

  const sanitizedArchive = path.join(output, manifest.traces[0].file);
  const { stdout: entries } = await execFileAsync("unzip", ["-Z1", sanitizedArchive], {
    encoding: "utf8",
  });
  assert.deepEqual(entries.trim().split(/\r?\n/).sort(), [
    "SANITIZATION.json",
    "test.trace",
  ]);
  const { stdout: trace } = await execFileAsync(
    "unzip",
    ["-p", sanitizedArchive, "test.trace"],
    { encoding: "utf8" },
  );
  for (const forbidden of [
    email,
    password,
    authorization,
    session,
    "private-user",
    "candidate-staging.example.invalid",
    "https://",
  ]) {
    assert.equal(trace.includes(forbidden), false);
  }
  assert.match(trace, /"method":"fill"/);
  assert.match(trace, /\[REDACTED/);
  assert.match(trace, /\[REDACTED_URL\]/);

  const outerManifest = await readFile(
    path.join(output, "sanitized-traces-manifest.json"),
    "utf8",
  );
  for (const forbidden of [email, password, authorization, session]) {
    assert.equal(outerManifest.includes(forbidden), false);
  }
});

test("sanitization fails closed and emits no directory when test.trace is absent", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tab10-trace-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const { archive, source } = await createTraceArchive(directory, {
    includeTrace: false,
  });
  const output = path.join(directory, "sanitized");

  await assert.rejects(
    sanitizePlaywrightTraces({
      sourceDirectory: source,
      outputDirectory: output,
      forbiddenValues: [email, password],
      requireTrace: true,
      deleteSource: true,
    }),
    /exactly one root test\.trace/,
  );
  await assert.rejects(access(archive), /ENOENT/);
  await assert.rejects(access(output), /ENOENT/);
});

test("sanitized trace archives are byte-deterministic for identical input", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tab10-trace-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const { archive, source } = await createTraceArchive(path.join(directory, "first"));
  const copiedSource = path.join(directory, "copied-raw");
  await mkdir(copiedSource, { recursive: true });
  await copyFile(archive, path.join(copiedSource, "trace.zip"));

  const first = await sanitizePlaywrightTraces({
    sourceDirectory: source,
    outputDirectory: path.join(directory, "first-sanitized"),
    forbiddenValues: [email, password],
    requireTrace: true,
  });
  const second = await sanitizePlaywrightTraces({
    sourceDirectory: copiedSource,
    outputDirectory: path.join(directory, "second-sanitized"),
    forbiddenValues: [email, password],
    requireTrace: true,
  });
  const firstArchive = await readFile(
    path.join(directory, "first-sanitized", first.traces[0].file),
  );
  const secondArchive = await readFile(
    path.join(directory, "second-sanitized", second.traces[0].file),
  );
  assert.deepEqual(firstArchive, secondArchive);
});
