import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeCompiledMigrationArguments } from "../bin/run-compiled-migration.mjs";
import {
  assertAllowedUntrackedFiles,
  assertExactSha,
  createReleaseMetadata,
  fetchJson,
  releaseMetadataFromEnv,
  validatedOrigin,
} from "./release-lib.mjs";
import { validateReleasePayload } from "./smoke-release.mjs";
import {
  currentMainRelease,
  parseRemoteMainSha,
} from "./smoke-current-main.mjs";
import { waitForPublicRelease } from "./wait-for-public-release.mjs";
import { writeWebRelease } from "./write-web-release.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const VERSION = "1.10.1";
const expected = createReleaseMetadata({
  sha: SHA,
  version: VERSION,
  environment: "production",
  dirty: false,
});

test("hosted release identity requires a full clean SHA", () => {
  assert.throws(() => assertExactSha("0123456"), /full 40-character/);
  assert.throws(
    () =>
      createReleaseMetadata({
        sha: SHA,
        version: VERSION,
        environment: "production",
        dirty: true,
      }),
    /must not be dirty/,
  );
});

test("public smoke resolves exact origin main SHA and root version", async () => {
  assert.equal(parseRemoteMainSha(`${SHA}\trefs/heads/main\n`), SHA);
  assert.throws(() => parseRemoteMainSha("short\trefs/heads/main\n"), /full SHA/);
  assert.deepEqual(
    await currentMainRelease({
      runGit: async (...args) => {
        assert.deepEqual(args, [
          "ls-remote",
          "--exit-code",
          "origin",
          "refs/heads/main",
        ]);
        return { stdout: `${SHA}\trefs/heads/main\n` };
      },
      loadPackage: async () => ({ version: VERSION }),
    }),
    expected,
  );
});

test("provider Git SHA sources resolve to the same canonical metadata", async () => {
  const render = await releaseMetadataFromEnv({
    NODE_ENV: "production",
    RENDER_GIT_COMMIT: SHA,
  });
  const vercel = await releaseMetadataFromEnv({
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_SHA: SHA,
  });
  assert.deepEqual(render, expected);
  assert.deepEqual(vercel, expected);
  await assert.rejects(
    releaseMetadataFromEnv({
      NODE_ENV: "production",
      TAB10_RELEASE_SHA: SHA,
      RENDER_GIT_COMMIT: "f".repeat(40),
    }),
    /SHA sources disagree/,
  );
});

test("exact checkout rejects arbitrary untracked source inputs", () => {
  assert.equal(assertAllowedUntrackedFiles([], []), true);
  assert.throws(
    () => assertAllowedUntrackedFiles(["apps/web/src/injected.ts"], []),
    /Untracked files/,
  );
});

test("canonical migration launcher accepts exactly one command separator", () => {
  assert.deepEqual(
    normalizeCompiledMigrationArguments(["--", "--mode=apply"]),
    ["--mode=apply"],
  );
  assert.deepEqual(
    normalizeCompiledMigrationArguments(["--", "--mode", "adopt-unversioned"]),
    ["--mode", "adopt-unversioned"],
  );
  assert.throws(
    () => normalizeCompiledMigrationArguments(["--mode=apply"]),
    /exactly one leading/,
  );
  assert.throws(
    () => normalizeCompiledMigrationArguments(["--", "--", "--mode=apply"]),
    /only one standalone/,
  );
});

test("web release writer emits the canonical metadata shape", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "tab10-release-"));
  const output = path.join(directory, "release.json");
  try {
    const metadata = await writeWebRelease({
      output,
      env: {
        TAB10_RELEASE_SHA: SHA,
        TAB10_RELEASE_VERSION: VERSION,
        TAB10_ENVIRONMENT: "production",
        TAB10_RELEASE_DIRTY: "false",
      },
    });
    assert.deepEqual(metadata, expected);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), expected);
    assert.deepEqual(Object.keys(metadata), [
      "sha",
      "version",
      "environment",
      "dirty",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("smoke validation requires the exact canonical shape and identity", () => {
  assert.deepEqual(validateReleasePayload(expected, expected), expected);
  assert.throws(
    () => validateReleasePayload({ ...expected, branch: "main" }, expected),
    /canonical shape/,
  );
  assert.throws(
    () => validateReleasePayload({ ...expected, sha: "f".repeat(40) }, expected),
    /does not match/,
  );
  assert.throws(
    () => validatedOrigin("https://user:secret@example.com", "origin"),
    /credentials/,
  );
});

function successfulPublicFetch(input) {
  const url = new URL(input);
  let body;
  if (url.pathname === "/release.json") body = expected;
  else if (url.pathname === "/health") body = { status: "ok", release: expected };
  else if (url.pathname === "/ready") body = { status: "ready", release: expected };
  else if (url.pathname === "/api/v1/openapi.json") {
    body = { info: { version: VERSION } };
  }
  return Promise.resolve({
    ok: Boolean(body),
    status: body ? 200 : 404,
    json: async () => body,
  });
}

test("public release wait retries and returns only redacted evidence", async () => {
  let clock = 1_000;
  let calls = 0;
  const result = await waitForPublicRelease({
    expected,
    timeoutMs: 5_000,
    intervalMs: 250,
    now: () => clock,
    wait: async (milliseconds) => {
      clock += milliseconds;
    },
    fetchImpl: async (input, init) => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      return successfulPublicFetch(input, init);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.release, expected);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("onrender.com"), false);
  assert.equal(serialized.includes("vercel.app"), false);
  assert.deepEqual(
    result.api.checks.map((check) => check.name),
    ["api-health", "api-ready", "api-openapi"],
  );
});

test("public release wait is bounded and reports one generic failure", async () => {
  let clock = 0;
  const result = await waitForPublicRelease({
    expected,
    timeoutMs: 1_000,
    intervalMs: 400,
    now: () => clock,
    wait: async (milliseconds) => {
      clock += milliseconds;
    },
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ detail: "must not escape" }),
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.elapsedMs, 1_000);
  assert.equal(result.failure, "exact-release-not-observed-before-deadline");
  assert.equal(JSON.stringify(result).includes("must not escape"), false);
});

test("provider request errors expose only an opaque endpoint reference", async () => {
  await assert.rejects(
    fetchJson(
      "https://sensitive-provider.example/private/path?token=hidden",
      {},
      {
        fetchImpl: async () => {
          throw new Error("synthetic network failure");
        },
      },
    ),
    (error) => {
      assert.match(error.message, /endpoint [0-9a-f]{64}/);
      assert.equal(error.message.includes("sensitive-provider.example"), false);
      assert.equal(error.message.includes("hidden"), false);
      return true;
    },
  );
});

test("CI actions are immutable and optional GitHub release remains passive", async () => {
  const workflows = await Promise.all(
    ["ci.yml", "release.yml"].map((file) =>
      readFile(new URL(`../../.github/workflows/${file}`, import.meta.url), "utf8"),
    ),
  );
  for (const workflow of workflows) {
    const uses = [
      ...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm),
    ].map((match) => match[1]);
    assert.ok(uses.length > 0);
    assert.equal(uses.every((entry) => /@[0-9a-f]{40}$/.test(entry)), true);
  }
  const release = workflows[1];
  assert.match(release, /^\s{2}public-stand:/m);
  assert.match(release, /^\s{2}workflow_dispatch:/m);
  assert.doesNotMatch(release, /workflow_run:/);
  assert.doesNotMatch(release, /^\s{2}(staging|production):/m);
  assert.match(release, /wait-for-public-release\.mjs/);
  assert.doesNotMatch(
    release,
    /NEON_API_KEY|RENDER_API_KEY|VERCEL_TOKEN|db:migrate|deploy-exact-sha/,
  );
  assert.match(release, /cancel-in-progress: true/);
});

test("native provider configs deploy main and preserve same-origin routing", async () => {
  const render = await readFile(new URL("../../render.yaml", import.meta.url), "utf8");
  assert.match(render, /autoDeployTrigger: commit/);
  assert.doesNotMatch(render, /TAB10_RUNTIME_DATABASE_ROLE/);
  assert.match(render, /healthCheckPath: \/ready/);
  assert.match(render, /pnpm run db:migrate -- --mode=apply/);
  assert.match(render, /MIGRATION_DATABASE_URL="\$DATABASE_URL"/);
  assert.doesNotMatch(render, /^\s+- key: MIGRATION_DATABASE_URL$/m);
  assert.match(render, /TAB10_MIGRATION_CONFIRM_SHA="\$RENDER_GIT_COMMIT"/);
  assert.match(render, /TAB10_RELEASE_SHA="\$RENDER_GIT_COMMIT"/);
  assert.match(render, /GITHUB_SHA="\$RENDER_GIT_COMMIT"/);

  const vercel = JSON.parse(
    await readFile(new URL("../../apps/web/vercel.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(vercel.git.deploymentEnabled, { main: true, "*": false });
  assert.match(vercel.installCommand, /node@24\.20\.0/);
  assert.match(vercel.installCommand, /pnpm@9\.15\.0/);
  assert.match(vercel.installCommand, /--frozen-lockfile/);
  assert.deepEqual(
    vercel.rewrites.map((rewrite) => rewrite.source),
    ["/api/:path*", "/health", "/ready", "/(.*)"],
  );
  assert.equal(
    vercel.rewrites.slice(0, 3).every((rewrite) =>
      rewrite.destination.startsWith("https://one0is-ball.onrender.com/"),
    ),
    true,
  );
});

test("release writer creates parent directories without leaking extra files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "tab10-nested-release-"));
  try {
    const output = path.join(directory, "nested", "release.json");
    await mkdir(path.dirname(output), { recursive: true });
    await writeWebRelease({
      output,
      env: {
        TAB10_RELEASE_SHA: SHA,
        TAB10_RELEASE_VERSION: VERSION,
        TAB10_ENVIRONMENT: "production",
      },
    });
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), expected);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
