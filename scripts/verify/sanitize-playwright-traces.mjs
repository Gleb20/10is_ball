#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const REDACTED = "[REDACTED]";
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_TRACE_TEXT_BYTES = 128 * 1024 * 1024;
const DROP_EVENT_TYPES = new Set([
  "attachment",
  "console",
  "frame-snapshot",
  "log",
  "resource-snapshot",
  "screencast-frame",
  "stderr",
  "stdout",
]);
const SENSITIVE_KEY =
  /(?:attachment|auth|body|content|cookie|data|error|header|html|message|output|password|payload|postdata|result|secret|snapshot|storage|text|token|value)/i;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) return undefined;
  return args[index + 1];
}

function forbiddenVariants(values) {
  const variants = new Set();
  for (const candidate of values) {
    const value = String(candidate ?? "");
    if (!value) continue;
    variants.add(value);
    variants.add(value.toLowerCase());
    variants.add(encodeURIComponent(value));
    variants.add(JSON.stringify(value).slice(1, -1));
    variants.add(Buffer.from(value).toString("base64"));
    variants.add(Buffer.from(value).toString("base64url"));
  }
  return [...variants].filter(Boolean).sort((left, right) => right.length - left.length);
}

function scrubString(value, variants) {
  let sanitized = value;
  for (const variant of variants) {
    sanitized = sanitized.split(variant).join(REDACTED);
    sanitized = sanitized.split(variant.toLowerCase()).join(REDACTED);
  }
  sanitized = sanitized
    .replace(
      /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi,
      "[REDACTED_URL]",
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/tab10_session(?:=|%3D)[^;\s"']+/gi, "[REDACTED_COOKIE]")
    .replace(
      /\b(?:authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n]+/gi,
      "[REDACTED_HEADER]",
    )
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=_-]+/gi, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED);
  return sanitized;
}

function sanitizeValue(value, variants, key = "") {
  if (SENSITIVE_KEY.test(key)) {
    return REDACTED;
  }
  if (typeof value === "string") {
    if (/url|origin/i.test(key)) return "[REDACTED_URL]";
    if (/file|path/i.test(key)) return path.basename(scrubString(value, variants));
    return scrubString(value, variants);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, variants, key));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeValue(childValue, variants, childKey),
      ]),
    );
  }
  return value;
}

function assertNoSensitiveMaterial(text, variants, source) {
  const lowered = text.toLowerCase();
  for (const variant of variants) {
    if (text.includes(variant) || lowered.includes(variant.toLowerCase())) {
      throw new Error(`${source}: a forbidden credential encoding survived sanitization`);
    }
  }
  const unsafePatterns = [
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=_-]+/i,
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
    /(?:authorization|cookie|set-cookie)["']?\s*[:=]\s*["']?(?!\[REDACTED)/i,
    /tab10_session(?:=|%3D)[^;\s"']+/i,
    /[a-z][a-z0-9+.-]*:\/\/[^/@\s]+@/i,
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/i,
  ];
  if (unsafePatterns.some((pattern) => pattern.test(text))) {
    throw new Error(`${source}: credential, cookie, authorization or email material remained`);
  }
}

function sanitizeTestTrace(trace, variants) {
  const sanitized = [];
  let timelineEvents = 0;
  for (const [index, line] of trace.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`test.trace line ${index + 1} is not valid JSON`);
    }
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new Error(`test.trace line ${index + 1} is not an event object`);
    }
    if (DROP_EVENT_TYPES.has(event.type)) continue;
    if (event.type === "before" || event.type === "after") timelineEvents += 1;
    sanitized.push(JSON.stringify(sanitizeValue(event, variants)));
  }
  if (timelineEvents === 0) {
    throw new Error("Playwright test trace contains no action timeline events");
  }
  const output = `${sanitized.join("\n")}\n`;
  assertNoSensitiveMaterial(output, variants, "sanitized test.trace");
  return { output, timelineEvents, retainedEvents: sanitized.length };
}

async function collectTraceArchives(directory) {
  const archives = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name === "trace.zip") archives.push(absolute);
    }
  }
  await visit(directory);
  return archives.sort();
}

async function zipEntries(archive) {
  const { stdout } = await execFileAsync("unzip", ["-Z1", archive], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  const entries = stdout.split(/\r?\n/).filter(Boolean);
  if (
    entries.length === 0 ||
    entries.length > 10_000 ||
    entries.some(
      (entry) =>
        path.isAbsolute(entry) ||
        entry.split(/[\\/]/).some((segment) => segment === ".."),
    )
  ) {
    throw new Error("Trace archive has an unsafe or unreasonable entry list");
  }
  return entries;
}

async function readZipTextEntry(archive, entry) {
  const { stdout } = await execFileAsync("unzip", ["-p", archive, entry], {
    encoding: "utf8",
    maxBuffer: MAX_TRACE_TEXT_BYTES,
  });
  return stdout;
}

async function sanitizeArchive({ archive, destination, variants, index }) {
  const archiveStats = await stat(archive);
  if (!archiveStats.isFile() || archiveStats.size > MAX_ARCHIVE_BYTES) {
    throw new Error("Trace archive is missing or exceeds the sanitizer size limit");
  }
  const entries = await zipEntries(archive);
  if (entries.filter((entry) => entry === "test.trace").length !== 1) {
    throw new Error("Trace archive must contain exactly one root test.trace entry");
  }
  const rawTestTrace = await readZipTextEntry(archive, "test.trace");
  const trace = sanitizeTestTrace(rawTestTrace, variants);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "tab10-trace-sanitize-"));
  try {
    const traceFile = path.join(temporary, "test.trace");
    const policyFile = path.join(temporary, "SANITIZATION.json");
    const policy = {
      schemaVersion: 1,
      policy: "tab10-playwright-trace-minimal-v1",
      sourceSha256: sha256(await readFile(archive)),
      sourceEntryCount: entries.length,
      retainedEntries: ["test.trace"],
      droppedEntryClasses: [
        "attachments",
        "browser snapshots",
        "network payloads",
        "resources",
        "screenshots and video",
      ],
      retainedEvents: trace.retainedEvents,
      timelineEvents: trace.timelineEvents,
    };
    await writeFile(traceFile, trace.output, { mode: 0o600 });
    await writeFile(policyFile, `${JSON.stringify(policy, null, 2)}\n`, {
      mode: 0o600,
    });
    const fixedTimestamp = new Date("2000-01-01T00:00:00.000Z");
    await utimes(traceFile, fixedTimestamp, fixedTimestamp);
    await utimes(policyFile, fixedTimestamp, fixedTimestamp);
    const sourceRef = sha256(path.relative(path.dirname(archive), archive));
    const outputName = `sanitized-trace-${String(index + 1).padStart(2, "0")}-${sourceRef.slice(0, 12)}.zip`;
    const output = path.join(destination, outputName);
    await execFileAsync(
      "zip",
      ["-X", "-q", output, "test.trace", "SANITIZATION.json"],
      { cwd: temporary, env: { ...process.env, TZ: "UTC" }, encoding: "utf8" },
    );
    const outputEntries = await zipEntries(output);
    if (
      outputEntries.length !== 2 ||
      !outputEntries.includes("test.trace") ||
      !outputEntries.includes("SANITIZATION.json")
    ) {
      throw new Error("Sanitized trace contains an unexpected entry");
    }
    for (const entry of outputEntries) {
      assertNoSensitiveMaterial(
        await readZipTextEntry(output, entry),
        variants,
        `sanitized archive ${entry}`,
      );
    }
    return {
      file: outputName,
      sha256: sha256(await readFile(output)),
      ...policy,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function sanitizePlaywrightTraces({
  sourceDirectory,
  outputDirectory,
  forbiddenValues,
  requireTrace = false,
  deleteSource = false,
}) {
  const source = path.resolve(sourceDirectory);
  const destination = path.resolve(outputDirectory);
  const relativeOutput = path.relative(source, destination);
  if (!relativeOutput || (!relativeOutput.startsWith("..") && !path.isAbsolute(relativeOutput))) {
    throw new Error("Sanitized trace output must be outside the raw Playwright output tree");
  }
  await access(source);
  try {
    await access(destination);
    throw new Error("Sanitized trace output directory must not already exist");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const variants = forbiddenVariants(forbiddenValues);
  if (variants.length === 0) {
    throw new Error("At least one explicit forbidden credential value is required");
  }
  const archives = await collectTraceArchives(source);
  if (requireTrace && archives.length === 0) {
    throw new Error("Playwright failed without producing a trace archive to sanitize");
  }

  await mkdir(destination, { recursive: false, mode: 0o700 });
  try {
    const traces = [];
    for (const [index, archive] of archives.entries()) {
      traces.push(
        await sanitizeArchive({ archive, destination, variants, index }),
      );
    }
    const manifest = {
      schemaVersion: 1,
      status: "passed",
      policy: "tab10-playwright-trace-minimal-v1",
      traceCount: traces.length,
      disposableTestOnly: true,
      traces,
    };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    assertNoSensitiveMaterial(manifestText, variants, "sanitized trace manifest");
    await writeFile(
      path.join(destination, "sanitized-traces-manifest.json"),
      manifestText,
      { mode: 0o600 },
    );
    return manifest;
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  } finally {
    if (deleteSource) {
      await Promise.all(archives.map((archive) => rm(archive, { force: true })));
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const sourceDirectory = argumentValue(args, "--source");
  const outputDirectory = argumentValue(args, "--output");
  if (!sourceDirectory || !outputDirectory) {
    throw new Error("--source and --output are required");
  }
  const email = process.env.E2E_ADMIN_EMAIL?.trim();
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD are required for trace sanitization");
  }
  const manifest = await sanitizePlaywrightTraces({
    sourceDirectory,
    outputDirectory,
    forbiddenValues: [email, password],
    requireTrace: args.includes("--require-trace"),
    deleteSource: args.includes("--delete-source"),
  });
  process.stdout.write(
    `${JSON.stringify({ ok: true, traceCount: manifest.traceCount, policy: manifest.policy })}\n`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`Trace sanitization failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
