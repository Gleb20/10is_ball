#!/usr/bin/env node

import { createRequire } from "node:module";
import path from "node:path";
import {
  ROOT,
  RUNTIME_TEST_DATABASE_ROLE,
  databaseUrlForRole,
  ensureDir,
  resolveEvidenceDir,
  validateDisposableDatabaseEnvironment,
  writeJson,
} from "./lib.mjs";

const requireFromApi = createRequire(path.join(ROOT, "apps/api/package.json"));
const postgres = requireFromApi("postgres");
const evidenceDir = await ensureDir(resolveEvidenceDir("runtime-role"));
const ownerUrl = validateDisposableDatabaseEnvironment();
const runtimeRole = RUNTIME_TEST_DATABASE_ROLE;
const runtimeUrl = databaseUrlForRole(ownerUrl, runtimeRole);
const owner = postgres(ownerUrl, { max: 1 });
const runtime = postgres(runtimeUrl, { max: 1 });
const probeTable = "__tab10_runtime_dml_probe";
const probeSequence = "__tab10_runtime_sequence_probe";
const unexpectedDdlTable = "__tab10_runtime_ddl_probe";
const checks = [];
let failure;

async function expectPermissionDenied(label, statement) {
  try {
    await runtime.unsafe(statement);
  } catch (error) {
    if (error?.code === "42501") {
      checks.push(label);
      return;
    }
    throw new Error(`${label}: expected PostgreSQL permission denial`);
  }
  throw new Error(`${label}: unexpectedly succeeded`);
}

try {
  const identity = await runtime.unsafe("SELECT current_user AS runtime_role");
  if (identity[0]?.runtime_role !== runtimeRole) {
    throw new Error("Runtime connection did not use the limited runtime role");
  }

  const ledger = await runtime.unsafe(
    "SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations",
  );
  if (!Number.isInteger(ledger[0]?.count) || ledger[0].count < 1) {
    throw new Error("Runtime role could not read the initialized migration ledger");
  }
  checks.push("ledger-read");

  await owner.unsafe(`CREATE SEQUENCE public.${probeSequence}`);
  await owner.unsafe(`
    CREATE TABLE public.${probeTable} (
      id bigint PRIMARY KEY DEFAULT nextval('public.${probeSequence}'),
      value text NOT NULL
    )
  `);
  const inserted = await runtime.unsafe(
    `INSERT INTO public.${probeTable} (value) VALUES ('synthetic') RETURNING id`,
  );
  const id = inserted[0]?.id;
  await runtime.unsafe(
    `UPDATE public.${probeTable} SET value = 'verified' WHERE id = $1`,
    [id],
  );
  const selected = await runtime.unsafe(
    `SELECT value FROM public.${probeTable} WHERE id = $1`,
    [id],
  );
  if (selected[0]?.value !== "verified") {
    throw new Error("Runtime role DML probe did not persist the expected value");
  }
  await runtime.unsafe(`DELETE FROM public.${probeTable} WHERE id = $1`, [id]);
  checks.push("public-dml-and-sequence");

  await expectPermissionDenied(
    "public-ddl-denied",
    `CREATE TABLE public.${unexpectedDdlTable} (id integer)`,
  );
  await expectPermissionDenied(
    "ledger-write-denied",
    "UPDATE drizzle.__drizzle_migrations SET hash = hash WHERE false",
  );
} catch (error) {
  failure = error;
} finally {
  await owner
    .unsafe(`DROP TABLE IF EXISTS public.${unexpectedDdlTable}`)
    .catch(() => undefined);
  await owner.unsafe(`DROP TABLE IF EXISTS public.${probeTable}`).catch(() => undefined);
  await owner
    .unsafe(`DROP SEQUENCE IF EXISTS public.${probeSequence}`)
    .catch(() => undefined);
  await runtime.end({ timeout: 5 }).catch(() => undefined);
  await owner.end({ timeout: 5 }).catch(() => undefined);
  await writeJson(path.join(evidenceDir, "runtime-role-summary.json"), {
    schemaVersion: 1,
    status: failure ? "failed" : "passed",
    total: checks.length + (failure ? 1 : 0),
    passed: checks.length,
    failed: failure ? 1 : 0,
    skipped: 0,
    todo: 0,
    interrupted: 0,
    migrationOwner: new URL(ownerUrl).username,
    runtimeRole,
    checks,
  });
}

if (failure) throw failure;
console.log(
  `Runtime role: ${checks.length} passed, 0 failed, 0 skipped, 0 todo, 0 interrupted`,
);
