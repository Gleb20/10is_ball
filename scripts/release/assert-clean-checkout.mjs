#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  assertCleanExactCheckout,
  publicError,
  releaseMetadataFromEnv,
} from "./release-lib.mjs";

export async function assertCleanReleaseCheckout(env = process.env) {
  const release = await releaseMetadataFromEnv(env);
  assertCleanExactCheckout(release.sha);
  return { ok: true, sha: release.sha };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  assertCleanReleaseCheckout().then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error) => {
      process.stderr.write(`${publicError(error)}\n`);
      process.exitCode = 1;
    },
  );
}
