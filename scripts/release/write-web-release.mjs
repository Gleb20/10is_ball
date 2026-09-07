#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  argValue,
  publicError,
  releaseMetadataFromEnv,
  writeJsonAtomic,
} from "./release-lib.mjs";

export async function writeWebRelease({
  env = process.env,
  output = "dist/release.json",
} = {}) {
  const metadata = await releaseMetadataFromEnv(env);
  await writeJsonAtomic(path.resolve(output), metadata);
  return metadata;
}

async function main() {
  const output = argValue(process.argv.slice(2), "--output") ?? "dist/release.json";
  const metadata = await writeWebRelease({ output });
  process.stdout.write(
    `${JSON.stringify({ written: path.resolve(output), release: metadata })}\n`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${publicError(error)}\n`);
    process.exitCode = 1;
  });
}
