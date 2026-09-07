#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const COMPILED_MIGRATION_ENTRYPOINT = fileURLToPath(
  new URL("../../apps/api/dist/db/migrate.js", import.meta.url),
);

/**
 * pnpm 9 preserves the public command separator in script argv. Accept exactly
 * that one separator and leave migration option validation to the compiled CLI.
 */
export function normalizeCompiledMigrationArguments(argv) {
  if (argv[0] !== "--") {
    throw new Error(
      'db:migrate requires exactly one leading "--" command separator',
    );
  }
  if (argv.length === 1) {
    throw new Error("db:migrate requires migration arguments after the separator");
  }

  const forwarded = argv.slice(1);
  if (forwarded.includes("--")) {
    throw new Error('db:migrate accepts only one standalone "--" separator');
  }
  return forwarded;
}

export function runCompiledMigration(argv = process.argv.slice(2)) {
  const forwarded = normalizeCompiledMigrationArguments(argv);
  const result = spawnSync(
    process.execPath,
    [COMPILED_MIGRATION_ENTRYPOINT, ...forwarded],
    {
      cwd: resolve(fileURLToPath(new URL("../../", import.meta.url))),
      env: process.env,
      stdio: "inherit",
    },
  );

  if (result.error) throw result.error;
  if (result.signal) {
    throw new Error(`Compiled migration process stopped by ${result.signal}`);
  }
  return result.status ?? 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  try {
    process.exitCode = runCompiledMigration();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`Migration launcher failed: ${message}`);
    process.exitCode = 1;
  }
}
