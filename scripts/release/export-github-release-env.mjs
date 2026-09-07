#!/usr/bin/env node

import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  assertExactSha,
  publicError,
  requiredEnv,
  rootProductVersion,
} from "./release-lib.mjs";

export async function exportGithubReleaseEnvironment(env = process.env) {
  assertExactSha(requiredEnv(env, "TAB10_RELEASE_SHA"));
  const destination = requiredEnv(env, "GITHUB_ENV");
  const version = await rootProductVersion();
  await appendFile(destination, `TAB10_RELEASE_VERSION=${version}\n`, {
    encoding: "utf8",
  });
  return { ok: true, version };
}

async function main() {
  const result = await exportGithubReleaseEnvironment();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${publicError(error)}\n`);
    process.exitCode = 1;
  });
}
