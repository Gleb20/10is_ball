import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const DEPLOY_ENVIRONMENTS = new Set(["staging", "production"]);
const ALL_ENVIRONMENTS = new Set([
  "local",
  "test",
  "staging",
  "production",
]);
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const FULL_SHA = /^[0-9a-f]{40}$/;

export function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

export function requiredEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Required environment variable is missing: ${name}`);
  return value;
}

export function normalizeEnvironment(value) {
  const normalized = value?.trim().toLowerCase() || "local";
  if (!ALL_ENVIRONMENTS.has(normalized)) {
    throw new Error(`Unsupported TAB10 environment: ${normalized}`);
  }
  return normalized;
}

export function assertDeployEnvironment(value) {
  const environment = normalizeEnvironment(value);
  if (!DEPLOY_ENVIRONMENTS.has(environment)) {
    throw new Error("Release operations require staging or production");
  }
  return environment;
}

export function assertExactSha(value, label = "TAB10_RELEASE_SHA") {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || !FULL_SHA.test(normalized)) {
    throw new Error(`${label} must be a full 40-character Git SHA`);
  }
  return normalized;
}

export function parseDirty(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error("TAB10_RELEASE_DIRTY must be true or false");
}

export function createReleaseMetadata({ sha, version, environment, dirty }) {
  const normalizedEnvironment = normalizeEnvironment(environment);
  const normalizedVersion = version?.trim();
  if (!normalizedVersion || !SEMVER.test(normalizedVersion)) {
    throw new Error("TAB10_RELEASE_VERSION must be a semantic version");
  }

  const normalizedSha = sha?.trim().toLowerCase() || normalizedEnvironment;
  const normalizedDirty = Boolean(dirty);
  if (DEPLOY_ENVIRONMENTS.has(normalizedEnvironment)) {
    assertExactSha(normalizedSha);
    if (normalizedDirty) throw new Error("A deployed release must not be dirty");
  }

  return {
    sha: normalizedSha,
    version: normalizedVersion,
    environment: normalizedEnvironment,
    dirty: normalizedDirty,
  };
}

export async function rootProductVersion() {
  const packageJson = JSON.parse(
    await readFile(path.join(ROOT, "package.json"), "utf8"),
  );
  if (typeof packageJson.version !== "string" || !SEMVER.test(packageJson.version)) {
    throw new Error("Root package.json must contain a semantic product version");
  }
  return packageJson.version;
}

export async function releaseMetadataFromEnv(env = process.env) {
  const packageVersion = await rootProductVersion();
  const version = env.TAB10_RELEASE_VERSION?.trim() || packageVersion;
  if (version !== packageVersion) {
    throw new Error("TAB10_RELEASE_VERSION must match the root package.json version");
  }
  const environment = normalizeEnvironment(
    env.TAB10_ENVIRONMENT ??
      (env.NODE_ENV === "test"
        ? "test"
        : env.VERCEL_ENV === "preview"
          ? "staging"
          : env.VERCEL_ENV === "production" || env.NODE_ENV === "production"
            ? "production"
            : "local"),
  );
  const shaSources = [
    ["TAB10_RELEASE_SHA", env.TAB10_RELEASE_SHA],
    ["VERCEL_GIT_COMMIT_SHA", env.VERCEL_GIT_COMMIT_SHA],
    ["RENDER_GIT_COMMIT", env.RENDER_GIT_COMMIT],
    ["GITHUB_SHA", env.GITHUB_SHA],
  ].filter(([, value]) => Boolean(value?.trim()));
  const normalizedShas = shaSources.map(([name, value]) => {
    const normalized = value.trim().toLowerCase();
    if (DEPLOY_ENVIRONMENTS.has(environment)) {
      return assertExactSha(normalized, name);
    }
    return normalized;
  });
  if (
    DEPLOY_ENVIRONMENTS.has(environment) &&
    new Set(normalizedShas).size > 1
  ) {
    throw new Error("Hosted release SHA sources disagree");
  }
  return createReleaseMetadata({
    sha: normalizedShas[0],
    version,
    environment,
    dirty: parseDirty(env.TAB10_RELEASE_DIRTY),
  });
}

export function validatedOrigin(value, label, { allowHttp = false } = {}) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not contain credentials`);
  }
  if (parsed.protocol !== "https:" && !(allowHttp && parsed.protocol === "http:")) {
    throw new Error(`${label} must use HTTPS`);
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`${label} must contain only an origin`);
  }
  return parsed.origin;
}

export async function fetchJson(
  url,
  init = {},
  { fetchImpl = globalThis.fetch, timeoutMs = 20_000 } = {},
) {
  const parsed = new URL(url);
  const endpointRef = createHash("sha256")
    .update(parsed.origin)
    .digest("hex");
  let response;
  try {
    response = await fetchImpl(parsed, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(`Request failed for endpoint ${endpointRef}`);
  }
  if (!response.ok) {
    throw new Error(
      `Request failed for endpoint ${endpointRef} (${response.status})`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`Invalid JSON response from endpoint ${endpointRef}`);
  }
}

export async function writeJsonAtomic(destination, value) {
  const absolute = path.resolve(destination);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o644,
  });
  await rename(temporary, absolute);
}

export function assertAllowedUntrackedFiles(files, allowed = []) {
  const normalizedAllowed = new Set(allowed.map((file) => file.replaceAll("\\", "/")));
  const unexpected = files
    .map((file) => file.replaceAll("\\", "/"))
    .filter(Boolean)
    .filter((file) => !normalizedAllowed.has(file));
  if (unexpected.length > 0) {
    throw new Error("Untracked files are present in the exact-SHA checkout");
  }
  return true;
}

export function assertCleanExactCheckout(
  expectedSha,
  cwd = ROOT,
  { allowedUntracked = [] } = {},
) {
  const sha = assertExactSha(expectedSha);
  const actual = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
  })
    .trim()
    .toLowerCase();
  if (actual !== sha) {
    throw new Error("Checked-out commit does not match TAB10_RELEASE_SHA");
  }
  try {
    execFileSync("git", ["diff-index", "--quiet", "HEAD", "--"], {
      cwd,
      stdio: "ignore",
    });
  } catch {
    throw new Error("Tracked files are dirty; exact-SHA deployment is refused");
  }
  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { cwd, encoding: "utf8" },
  ).split("\0");
  assertAllowedUntrackedFiles(untracked, allowedUntracked);
  return sha;
}

export function publicError(error) {
  if (error instanceof Error) return error.message;
  return "Release operation failed";
}
