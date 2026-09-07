#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { ROOT } from "./lib.mjs";
import { validateLocalRolePolicyTarget } from "./local-role-policy-target.mjs";

const requireFromApi = createRequire(path.join(ROOT, "apps/api/package.json"));
const postgres = requireFromApi("postgres");
const rawUrl = validateLocalRolePolicyTarget();
const disposableTestMode = process.argv.slice(2).includes("--disposable-test");

const sql = postgres(rawUrl, { max: 1, connect_timeout: 15 });
try {
  const policy = await readFile(
    path.join(ROOT, "scripts/postgres/init-local.sql"),
    "utf8",
  );
  await sql.begin(async (transaction) => {
    if (disposableTestMode) {
      await transaction.unsafe("SET LOCAL tab10.disposable_test = '1'");
    }
    await transaction.unsafe(policy);
  });
  console.log("Local PostgreSQL runtime-role policy applied");
} finally {
  await sql.end({ timeout: 5 });
}
