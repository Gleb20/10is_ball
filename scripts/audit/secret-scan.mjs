#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const ROOT = valueAfter("--root")
  ? path.resolve(valueAfter("--root"))
  : execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
const MAX_BLOB_BYTES = 20_000_000;
const RELEASE_SECRET_ASSIGNMENT_NAMES = [
  "MIGRATION_DATABASE_URL",
  "RUNTIME_DATABASE_URL",
  "NEON_API_KEY",
  "RENDER_API_KEY",
  "VERCEL_TOKEN",
  "E2E_ADMIN_PASSWORD",
];
const SECRET_ASSIGNMENT_NAMES = [
  "SEED_ADMIN_PASSWORD",
  "TAB10_POSTGRES_PASSWORD",
  "DATABASE_PASSWORD",
  "DB_PASSWORD",
  "POSTGRES_PASSWORD",
  "JWT_SECRET",
  "SESSION_SECRET",
  "COOKIE_SECRET",
  ...RELEASE_SECRET_ASSIGNMENT_NAMES,
];
const ALLOWLIST_PATH = valueAfter("--allowlist")
  ? path.resolve(valueAfter("--allowlist"))
  : path.join(ROOT, "scripts/audit/secret-scan.allowlist.json");

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: options.encoding ?? "utf8",
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function placeholderCredential(value) {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // A malformed credential remains a candidate.
  }
  const normalized = decoded.toLowerCase();
  return (
    /^(pass(word)?|replace[-_]?me|change[-_]?me|example[-_]?only|ci[-_]?only[-_]?password|dummy|placeholder|test|local)$/.test(
      normalized,
    ) ||
    normalized.includes("${") ||
    normalized.includes("<password>")
  );
}

function placeholderHost(hostname) {
  let normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // A malformed hostname remains non-placeholder.
  }
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "host" ||
    normalized === "..." ||
    normalized === "…" ||
    normalized.endsWith(".example") ||
    normalized.endsWith(".example.com") ||
    normalized.endsWith(".invalid") ||
    normalized.endsWith(".internal") ||
    normalized.startsWith("your-")
  );
}

function findingsFor(content, sourcePath) {
  // Removing NULs also makes common UTF-16LE text inspectable instead of
  // treating the entire file as an opaque binary false negative.
  const searchable = content.replaceAll("\0", "");
  const kinds = new Set();
  const connectionStrings = searchable.matchAll(/postgres(?:ql)?:\/\/[^\s'"`)]+/gi);
  for (const match of connectionStrings) {
    if (/^postgres(?:ql)?:\/\/(?:\.\.\.|…)(?:[/?#]|$)/i.test(match[0])) {
      continue;
    }
    let parsed;
    try {
      parsed = new URL(match[0]);
    } catch {
      kinds.add("credential-url");
      continue;
    }
    const safeExample =
      placeholderHost(parsed.hostname) && placeholderCredential(parsed.password);
    if (!safeExample) kinds.add("credential-url");
  }
  if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(searchable)) kinds.add("private-key");
  if (/\bgh[pousr]_[A-Za-z0-9_]{30,}\b/.test(searchable)) kinds.add("github-token");
  if (/\bgithub_pat_[A-Za-z0-9_]{20,}\b/.test(searchable)) kinds.add("github-token");
  if (/\bsk-[A-Za-z0-9_-]{20,}\b/.test(searchable)) kinds.add("api-token");
  if (/\bnpm_[A-Za-z0-9]{30,}\b/.test(searchable)) kinds.add("npm-token");
  if (/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/.test(searchable)) kinds.add("slack-token");
  if (/\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/.test(searchable)) kinds.add("stripe-token");
  if (/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{10,}\b/.test(searchable)) {
    kinds.add("jwt");
  }
  if (/\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}/i.test(searchable)) {
    kinds.add("bearer-token");
  }
  if (/\bAKIA[0-9A-Z]{16}\b/.test(searchable)) kinds.add("aws-access-key");
  const secretNames = `(${SECRET_ASSIGNMENT_NAMES.join("|")})`;
  const assignmentPatterns = [
    new RegExp(
      `^[ \\t]*(?:export[ \\t]+)?${secretNames}[ \\t]*=[ \\t]*([^\\s#]+)`,
      "gim",
    ),
  ];
  if (sourcePath === undefined || /\.ya?ml$/i.test(sourcePath)) {
    assignmentPatterns.push(
      new RegExp(
        `^[ \\t]*${secretNames}[ \\t]*:[ \\t]*([^\\s#]+)`,
        "gim",
      ),
      new RegExp(
        `^[ \\t]*-[ \\t]*key:[ \\t]*${secretNames}[ \\t]*\\r?\\n[ \\t]*value:[ \\t]*([^\\s#]+)`,
        "gim",
      ),
    );
  }
  for (const pattern of assignmentPatterns) {
    for (const match of searchable.matchAll(pattern)) {
      const secretName = match[1].toUpperCase();
      const value = match[2].replace(/^["']|["']$/g, "");
      const safeLocalDefault =
        sourcePath === "docker-compose.yml" &&
        secretName === "POSTGRES_PASSWORD" &&
        value.toLowerCase() === "tab10";
      let safePlaceholderUrl = false;
      if (secretName.endsWith("_DATABASE_URL")) {
        try {
          const parsed = new URL(value);
          safePlaceholderUrl =
            /^postgres(?:ql)?:$/.test(parsed.protocol) &&
            placeholderHost(parsed.hostname) &&
            placeholderCredential(parsed.password);
        } catch {
          // A malformed URL still has to satisfy the ordinary placeholder rule.
        }
      }
      if (
        !placeholderCredential(value) &&
        !safeLocalDefault &&
        !safePlaceholderUrl
      ) {
        kinds.add("secret-assignment");
      }
    }
  }
  return [...kinds];
}

if (args.includes("--self-test")) {
  const scheme = "postgresql" + "://";
  const bootstrapPasswordKey = "SEED_ADMIN_" + "PASSWORD";
  const releaseAssignmentCases = RELEASE_SECRET_ASSIGNMENT_NAMES.flatMap((name) => [
    {
      name: `${name} opaque assignment is detected`,
      input: `${name}=fixture-${"x".repeat(96)}`,
      kind: "secret-assignment",
      expected: true,
    },
    {
      name: `${name} explicit placeholder is safe`,
      input: `${name}=replace-me`,
      kind: "secret-assignment",
      expected: false,
    },
  ]);
  const cases = [
    {
      name: "real credential on loopback is not trusted",
      input: `${scheme}app:real-local-secret@localhost/tab10`,
      kind: "credential-url",
      expected: true,
    },
    {
      name: "NUL separated credential is still inspected",
      input: `${scheme}app:real\0-local\0-secret@db.example/tab10`,
      kind: "credential-url",
      expected: true,
    },
    {
      name: "triple dots inside a real credential do not bypass the scan",
      input: `${scheme}app:real...secret@db.example/tab10`,
      kind: "credential-url",
      expected: true,
    },
    {
      name: "explicit placeholder on placeholder host is safe",
      input: `${scheme}app:replace-me@db.example/tab10`,
      kind: "credential-url",
      expected: false,
    },
    {
      name: "exact ellipsis documentation is safe",
      input: `${scheme}...`,
      kind: "credential-url",
      expected: false,
    },
    {
      name: "real bootstrap password assignment is detected",
      input: `${bootstrapPasswordKey} = TrulyUniqueSecret9!`,
      kind: "secret-assignment",
      expected: true,
    },
    {
      name: "placeholder bootstrap password assignment is safe",
      input: `${bootstrapPasswordKey}: replace-me`,
      kind: "secret-assignment",
      expected: false,
    },
    {
      name: "weak application secret is not treated as a placeholder",
      input: "SESSION_" + "SECRET=tab10",
      kind: "secret-assignment",
      expected: true,
    },
    {
      name: "Render key/value bootstrap secret is detected",
      input: `- key: ${bootstrapPasswordKey}\n  value: TrulyUniqueSecret9!`,
      kind: "secret-assignment",
      expected: true,
    },
    {
      name: "Render sync-only secret declaration is safe",
      input: `- key: ${bootstrapPasswordKey}\n  sync: false`,
      kind: "secret-assignment",
      expected: false,
    },
    {
      name: "fine-grained GitHub token is detected",
      input: "github_" + "pat_0123456789abcdefghijklmnopqrstuvwxyzABCDE",
      kind: "github-token",
      expected: true,
    },
    {
      name: "JWT is detected",
      input: [
        "eyJhbGciOiJIUzI1NiJ9",
        "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
        "signature0123456789",
      ].join("."),
      kind: "jwt",
      expected: true,
    },
    ...releaseAssignmentCases,
  ];
  const failures = cases.filter(
    ({ input, kind, expected }) => findingsFor(input).includes(kind) !== expected,
  );
  if (failures.length > 0) {
    console.error(
      JSON.stringify({ status: "failed", cases: failures.map(({ name }) => name) }),
    );
    process.exit(1);
  }

  // Prove that content staged only in the index is scanned even when the
  // worktree and all refs contain a safe version of the same path.
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "tab10-secret-index-"));
  try {
    const fixtureHooks = path.join(fixtureRoot, "disabled-hooks");
    await mkdir(fixtureHooks, { recursive: true });
    const fixtureGit = (fixtureArgs) =>
      execFileSync(
        "git",
        [
          "-c",
          "commit.gpgSign=false",
          "-c",
          `core.hooksPath=${fixtureHooks}`,
          ...fixtureArgs,
        ],
        {
          cwd: fixtureRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    fixtureGit(["init", "--quiet"]);
    fixtureGit(["config", "user.name", "Tab10 Secret Scan"]);
    fixtureGit(["config", "user.email", "secret-scan@localhost"]);
    await writeFile(path.join(fixtureRoot, "tracked.txt"), "safe\n");
    await mkdir(path.join(fixtureRoot, "scripts/audit"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "scripts/audit/secret-scan.allowlist.json"),
      '{"schemaVersion":1,"entries":[]}\n',
    );
    fixtureGit(["add", "tracked.txt"]);
    fixtureGit(["commit", "--quiet", "-m", "safe base"]);
    await writeFile(
      path.join(fixtureRoot, "tracked.txt"),
      `${scheme}app:real-index-secret@db.example/tab10\n`,
    );
    fixtureGit(["add", "tracked.txt"]);
    await writeFile(path.join(fixtureRoot, "tracked.txt"), "safe\n");
    const untrackedSecretPath = "untracked-release-credential.txt";
    const untrackedPlaceholderPath = "untracked-release-placeholders.txt";
    await writeFile(
      path.join(fixtureRoot, untrackedSecretPath),
      `NEON_API_KEY=fixture-${"z".repeat(128)}\n`,
    );
    await writeFile(
      path.join(fixtureRoot, untrackedPlaceholderPath),
      `${RELEASE_SECRET_ASSIGNMENT_NAMES.map((name) => `${name}=replace-me`).join("\n")}\n`,
    );

    let fixtureStdout = "";
    let fixtureStatus = 0;
    try {
      fixtureStdout = execFileSync(
        process.execPath,
        [fileURLToPath(import.meta.url), "--root", fixtureRoot],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      fixtureStatus = error.status;
      fixtureStdout = String(error.stdout ?? "");
    }
    const fixtureReport = JSON.parse(fixtureStdout);
    const indexFinding = fixtureReport.candidates?.some(
      (finding) =>
        finding.scope === "git-index" &&
        finding.path === "tracked.txt" &&
        finding.kind === "credential-url",
    );
    const untrackedFinding = fixtureReport.candidates?.some(
      (finding) =>
        finding.scope === "worktree" &&
        finding.path === untrackedSecretPath &&
        finding.kind === "secret-assignment",
    );
    const placeholderFinding = fixtureReport.candidates?.some(
      (finding) => finding.path === untrackedPlaceholderPath,
    );
    const unexpectedFinding = fixtureReport.candidates?.some(
      (finding) =>
        !(
          finding.scope === "git-index" &&
          finding.path === "tracked.txt" &&
          finding.kind === "credential-url"
        ) &&
        !(
          finding.scope === "worktree" &&
          finding.path === untrackedSecretPath &&
          finding.kind === "secret-assignment"
        ),
    );
    if (
      fixtureStatus !== 1 ||
      !indexFinding ||
      !untrackedFinding ||
      placeholderFinding ||
      unexpectedFinding ||
      fixtureReport.skippedInputs?.length !== 0
    ) {
      console.error(
        JSON.stringify({
          status: "failed",
          cases: ["staged-only index and untracked named credentials"],
        }),
      );
      process.exit(1);
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ status: "passed", cases: cases.length + 1 }));
  process.exit(0);
}
const outputIndex = args.indexOf("--out");
const output = outputIndex === -1 ? undefined : args[outputIndex + 1];
const candidates = [];
const skippedInputs = [];
const ordinaryWorktreeFiles = git([
  "ls-files",
  "-z",
  "--cached",
  "--others",
  "--exclude-standard",
])
  .split("\0")
  .filter(Boolean);
// An explicit incident-response mode includes ignored env files without
// traversing ignored dependency/build directories. It is intentionally not a
// CI gate because a legitimate private local .env may contain real secrets.
const ignoredEnvFiles = args.includes("--include-local-env")
  ? git([
      "ls-files",
      "-z",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--",
      ":(glob).env*",
      ":(glob)**/.env*",
    ])
      .split("\0")
      .filter(Boolean)
  : [];
const worktreeFiles = [...new Set([...ordinaryWorktreeFiles, ...ignoredEnvFiles])];
let scannedWorktreeFiles = 0;
let absentWorktreeFiles = 0;
for (const relativePath of worktreeFiles) {
  const absolutePath = path.join(ROOT, relativePath);
  let content;
  try {
    const bytes = await readFile(absolutePath);
    if (bytes.byteLength > MAX_BLOB_BYTES) {
      skippedInputs.push({
        scope: "worktree",
        path: relativePath,
        reason: "over-max-bytes",
        size: bytes.byteLength,
      });
      continue;
    }
    content = bytes.toString("utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      absentWorktreeFiles += 1;
      continue;
    }
    skippedInputs.push({
      scope: "worktree",
      path: relativePath,
      reason: "unreadable",
    });
    continue;
  }
  scannedWorktreeFiles += 1;
  for (const kind of findingsFor(content, relativePath)) {
    candidates.push({ scope: "worktree", path: relativePath, kind });
  }
}

const objectPaths = new Map();
const objectLines = git(["rev-list", "--objects", "--all"]).trim().split("\n").filter(Boolean);
for (const line of objectLines) {
  const separator = line.indexOf(" ");
  if (separator === -1) continue;
  const object = line.slice(0, separator);
  if (!objectPaths.has(object)) objectPaths.set(object, line.slice(separator + 1));
}
const objectIds = [...objectPaths.keys()];
const scannedRefObjectPaths = new Set();
let scannedRefBlobs = 0;
if (objectIds.length > 0) {
  const checks = git(["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], {
    input: `${objectIds.join("\n")}\n`,
  });
  for (const line of checks.trim().split("\n")) {
    const [object, type, rawSize] = line.split(" ");
    if (type !== "blob") continue;
    const relativePath = objectPaths.get(object);
    const size = Number(rawSize);
    if (size > MAX_BLOB_BYTES) {
      skippedInputs.push({
        scope: "git-refs",
        object,
        path: relativePath,
        reason: "over-max-bytes",
        size,
      });
      continue;
    }
    let content;
    try {
      content = git(["cat-file", "blob", object]);
    } catch {
      skippedInputs.push({
        scope: "git-refs",
        object,
        path: relativePath,
        reason: "unreadable",
      });
      continue;
    }
    scannedRefBlobs += 1;
    scannedRefObjectPaths.add(`${object}\u0001${relativePath}`);
    for (const kind of findingsFor(content, relativePath)) {
      candidates.push({
        scope: "git-refs",
        object,
        path: relativePath,
        kind,
      });
    }
  }
}

// The index can contain a newly staged blob that is not reachable from any
// ref and differs from both HEAD and the worktree. Scan every such object;
// exact object/path pairs already inspected through refs are counted once.
const indexRecords = git(["ls-files", "--stage", "-z"])
  .split("\0")
  .filter(Boolean);
const indexEntries = [];
for (const record of indexRecords) {
  const match = /^(\d+) ([0-9a-f]+) ([0-3])\t([\s\S]+)$/.exec(record);
  if (!match) {
    skippedInputs.push({ scope: "git-index", reason: "unparseable-entry" });
    continue;
  }
  indexEntries.push({ object: match[2], stage: Number(match[3]), path: match[4] });
}

let scannedIndexBlobs = 0;
let indexBlobsCoveredByRefs = 0;
const seenIndexEntries = new Set();
for (const entry of indexEntries) {
  const identity = `${entry.object}\u0001${entry.path}`;
  if (seenIndexEntries.has(identity)) continue;
  seenIndexEntries.add(identity);
  if (scannedRefObjectPaths.has(identity)) {
    indexBlobsCoveredByRefs += 1;
    continue;
  }

  let size;
  try {
    size = Number(git(["cat-file", "-s", entry.object]).trim());
  } catch {
    skippedInputs.push({
      scope: "git-index",
      object: entry.object,
      path: entry.path,
      reason: "unreadable",
    });
    continue;
  }
  if (!Number.isFinite(size) || size > MAX_BLOB_BYTES) {
    skippedInputs.push({
      scope: "git-index",
      object: entry.object,
      path: entry.path,
      reason: Number.isFinite(size) ? "over-max-bytes" : "invalid-size",
      ...(Number.isFinite(size) ? { size } : {}),
    });
    continue;
  }

  let content;
  try {
    content = git(["cat-file", "blob", entry.object]);
  } catch {
    skippedInputs.push({
      scope: "git-index",
      object: entry.object,
      path: entry.path,
      reason: "unreadable",
    });
    continue;
  }
  scannedIndexBlobs += 1;
  for (const kind of findingsFor(content, entry.path)) {
    candidates.push({
      scope: "git-index",
      object: entry.object,
      path: entry.path,
      kind,
    });
  }
}

const unique = [...new Map(candidates.map((item) => [JSON.stringify(item), item])).values()];
const allowlist = JSON.parse(await readFile(ALLOWLIST_PATH, "utf8"));
const findingKey = (item) =>
  [item.scope, item.object ?? "", item.path ?? "", item.kind].join("\u0001");
const allowlistByKey = new Map(
  (allowlist.entries ?? []).map((entry) => [findingKey(entry), entry]),
);
const reviewedBenignFindings = unique
  .filter((item) => allowlistByKey.has(findingKey(item)))
  .map((item) => ({
    ...item,
    reason: allowlistByKey.get(findingKey(item)).reason,
  }));
const unreviewedCandidates = unique.filter(
  (item) => !allowlistByKey.has(findingKey(item)),
);
const report = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  maxBlobBytes: MAX_BLOB_BYTES,
  discoveredWorktreeFiles: worktreeFiles.length,
  discoveredIgnoredEnvFiles: ignoredEnvFiles.length,
  scannedWorktreeFiles,
  absentWorktreeFiles,
  scannedRefObjects: objectIds.length,
  scannedRefBlobs,
  discoveredIndexEntries: indexEntries.length,
  scannedIndexBlobs,
  indexBlobsCoveredByRefs,
  skippedInputs,
  candidates: unreviewedCandidates,
  reviewedBenignFindings,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (output) await writeFile(path.resolve(ROOT, output), serialized);
console.log(serialized.trimEnd());
if (unreviewedCandidates.length > 0 || skippedInputs.length > 0) {
  console.error(
    "Secret scan failed. Output contains locations, skip reasons, and secret kinds only.",
  );
  process.exitCode = 1;
}
