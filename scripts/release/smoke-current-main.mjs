import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { createReleaseMetadata } from "./release-lib.mjs";
import { waitForPublicRelease } from "./wait-for-public-release.mjs";

const execFile = promisify(execFileCallback);
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_INTERVAL_MS = 5_000;

export function parseRemoteMainSha(output) {
  const match = /^([0-9a-f]{40})\s+refs\/heads\/main\s*$/u.exec(output.trim());
  if (!match) throw new Error("origin/main did not resolve to one full SHA");
  return match[1];
}

export async function currentMainRelease({
  runGit = (...args) => execFile("git", args, { encoding: "utf8" }),
  loadPackage = async () =>
    JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")),
} = {}) {
  const [{ stdout }, packageJson] = await Promise.all([
    runGit("ls-remote", "--exit-code", "origin", "refs/heads/main"),
    loadPackage(),
  ]);
  return createReleaseMetadata({
    sha: parseRemoteMainSha(stdout),
    version: packageJson.version,
    environment: "production",
    dirty: false,
  });
}

async function main() {
  const expected = await currentMainRelease();
  const result = await waitForPublicRelease({
    expected,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    intervalMs: DEFAULT_INTERVAL_MS,
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: result.ok,
      sha: expected.sha,
      version: expected.version,
      attempts: result.attempts,
      elapsedMs: result.elapsedMs,
    })}\n`,
  );
  if (!result.ok) throw new Error("Exact public release was not observed");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(() => {
    process.stderr.write("Public release convergence failed\n");
    process.exitCode = 1;
  });
}
