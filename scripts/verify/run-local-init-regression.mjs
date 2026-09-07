#!/usr/bin/env node

import { createRequire } from "node:module";
import path from "node:path";
import { attestRuntimeRole } from "../release/attest-runtime-role.mjs";
import {
  ROOT,
  captureCommand,
  ensureDir,
  pnpmCommand,
  resolveEvidenceDir,
  runCommand,
  validateDisposableDatabaseEnvironment,
  writeJson,
} from "./lib.mjs";

const requireFromApi = createRequire(path.join(ROOT, "apps/api/package.json"));
const postgres = requireFromApi("postgres");
const RUNTIME_ROLE = "tab10_runtime";

const evidenceDir = await ensureDir(resolveEvidenceDir("local-init"));
const ownerUrl = validateDisposableDatabaseEnvironment();
const ownerSql = postgres(ownerUrl, { max: 1, connect_timeout: 15 });

let ownerRole;
let runtimeRoleOwnedByHarness = false;
let preExistingRoleGuardChecks = 0;
let initChecks = 0;
let migrationChecks = 0;
let attestationChecks = 0;
let attestation;
let failure;

async function removeRuntimeRoleCreatedByThisRun() {
  if (!runtimeRoleOwnedByHarness) return;
  const [runtimeRole] = await ownerSql`
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = ${RUNTIME_ROLE}
    ) AS exists
  `;
  if (!runtimeRole?.exists) return;
  await ownerSql.unsafe(`DROP OWNED BY ${RUNTIME_ROLE}`);
  await ownerSql.unsafe(`DROP ROLE ${RUNTIME_ROLE}`);
  runtimeRoleOwnedByHarness = false;
}

try {
  const [identity] = await ownerSql.unsafe(
    "SELECT current_user AS owner_role, current_database() AS database_name",
  );
  ownerRole = identity?.owner_role;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(ownerRole ?? "")) {
    throw new Error("Disposable migration owner is not a safe PostgreSQL role");
  }
  const [existingRuntimeRole] = await ownerSql`
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = ${RUNTIME_ROLE}
    ) AS exists
  `;
  if (existingRuntimeRole?.exists) {
    throw new Error(
      "Disposable cluster already contains tab10_runtime; refusing to alter a pre-existing global role",
    );
  }

  await ownerSql.unsafe(
    `CREATE ROLE ${RUNTIME_ROLE} NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  );
  runtimeRoleOwnedByHarness = true;
  let preExistingRoleFailure;
  try {
    await captureCommand(
      process.execPath,
      [
        path.join(ROOT, "scripts/verify/apply-local-role-policy.mjs"),
        "--disposable-test",
      ],
      {
        env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl },
      },
    );
  } catch (error) {
    preExistingRoleFailure = error;
  }
  if (!preExistingRoleFailure) {
    throw new Error("Disposable local role policy accepted a pre-existing runtime role");
  }
  const [unchangedRuntimeRole] = await ownerSql`
    SELECT rolcanlogin, rolinherit
    FROM pg_catalog.pg_roles
    WHERE rolname = ${RUNTIME_ROLE}
  `;
  if (
    unchangedRuntimeRole?.rolcanlogin !== false ||
    unchangedRuntimeRole?.rolinherit !== true
  ) {
    throw new Error("Rejected pre-existing runtime role was modified before failure");
  }
  await removeRuntimeRoleCreatedByThisRun();
  preExistingRoleGuardChecks = 1;

  await runCommand(
    process.execPath,
    [
      path.join(ROOT, "scripts/verify/apply-local-role-policy.mjs"),
      "--disposable-test",
    ],
    {
      env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl },
      label: "Apply the checked-in local role policy",
    },
  );
  runtimeRoleOwnedByHarness = true;
  initChecks = 1;

  const migrationEnv = {
    ...process.env,
    NODE_ENV: "test",
    MIGRATION_DATABASE_URL: ownerUrl,
    TAB10_NEON_MIGRATION_ROLE: ownerRole,
    TAB10_RUNTIME_DATABASE_ROLE: RUNTIME_ROLE,
    TAB10_ENVIRONMENT: "staging",
  };
  delete migrationEnv.DATABASE_URL;
  delete migrationEnv.TEST_DATABASE_URL;
  delete migrationEnv.ALLOW_TEST_DATABASE_RESET;
  delete migrationEnv.PGLITE_DATA_DIR;
  delete migrationEnv.AUDIT_EPHEMERAL;
  await runCommand(
    pnpmCommand(),
    ["run", "db:migrate", "--", "--mode=apply"],
    {
      env: migrationEnv,
      label: "Apply hosted migration contract to the exact local init roles",
    },
  );
  migrationChecks = 1;

  await ownerSql.unsafe(
    "CREATE TABLE public.__tab10_local_acl_probe (id integer PRIMARY KEY)",
  );
  await ownerSql.unsafe(
    "CREATE SEQUENCE public.__tab10_local_acl_sequence_probe",
  );
  attestation = await attestRuntimeRole({ env: migrationEnv });
  if (
    attestation?.ok !== true ||
    attestation.serverVersionNumber !== 160015 ||
    attestation.publicSequenceCount < 1
  ) {
    throw new Error("Local init did not produce the exact hosted runtime role profile");
  }
  attestationChecks = 1;
  await writeJson(path.join(evidenceDir, "local-init-attestation.json"), attestation);
} catch (error) {
  failure = error;
} finally {
  try {
    await ownerSql
      .unsafe("DROP TABLE IF EXISTS public.__tab10_local_acl_probe")
      .catch(() => undefined);
    await ownerSql
      .unsafe("DROP SEQUENCE IF EXISTS public.__tab10_local_acl_sequence_probe")
      .catch(() => undefined);
    await removeRuntimeRoleCreatedByThisRun();
  } catch (error) {
    failure ??= error;
  }
  await ownerSql.end({ timeout: 5 }).catch(() => undefined);
  const passed =
    preExistingRoleGuardChecks + initChecks + migrationChecks + attestationChecks;
  await writeJson(path.join(evidenceDir, "local-init-summary.json"), {
    schemaVersion: 1,
    status: failure ? "failed" : "passed",
    total: passed + (failure ? 1 : 0),
    passed,
    failed: failure ? 1 : 0,
    skipped: 0,
    todo: 0,
    interrupted: 0,
    breakdown: {
      preExistingRoleGuardChecks,
      initChecks,
      migrationChecks,
      attestationChecks,
    },
  });
}

if (failure) throw failure;
console.log("Local init parity: 4 passed, 0 failed, 0 skipped, 0 todo, 0 interrupted");
