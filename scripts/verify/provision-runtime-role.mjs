#!/usr/bin/env node

import { createRequire } from "node:module";
import path from "node:path";
import {
  ROOT,
  RUNTIME_TEST_DATABASE_ROLE,
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
const sql = postgres(ownerUrl, { max: 1 });
let ownerRole;
let failure;

try {
  const identities = await sql.unsafe("SELECT current_user AS owner_role");
  ownerRole = identities[0]?.owner_role;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(ownerRole ?? "")) {
    throw new Error("Disposable migration owner is not a safe PostgreSQL role");
  }
  if (ownerRole === runtimeRole) {
    throw new Error("Disposable migration owner and runtime role must differ");
  }
  const databaseName = decodeURIComponent(new URL(ownerUrl).pathname.slice(1));
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(databaseName)) {
    throw new Error("Disposable database name is not a safe PostgreSQL identifier");
  }

  const existing = await sql`
    SELECT rolname
    FROM pg_catalog.pg_roles
    WHERE rolname = ${runtimeRole}
  `;
  if (existing.length === 0) {
    await sql.unsafe(
      `CREATE ROLE "${runtimeRole}" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
  }

  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS drizzle AUTHORIZATION "${ownerRole}"`);
  await sql.unsafe("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await sql.unsafe("REVOKE ALL ON SCHEMA drizzle FROM PUBLIC");
  await sql.unsafe(`REVOKE ALL ON SCHEMA public FROM "${runtimeRole}"`);
  await sql.unsafe(`REVOKE ALL ON SCHEMA drizzle FROM "${runtimeRole}"`);
  await sql.unsafe(
    `GRANT CONNECT ON DATABASE "${databaseName}" TO "${runtimeRole}"`,
  );
  await sql.unsafe(`GRANT USAGE ON SCHEMA public, drizzle TO "${runtimeRole}"`);

  await sql.unsafe(
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${ownerRole}" IN SCHEMA public REVOKE ALL ON TABLES FROM "${runtimeRole}"`,
  );
  await sql.unsafe(
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${ownerRole}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${runtimeRole}"`,
  );
  await sql.unsafe(
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${ownerRole}" IN SCHEMA public REVOKE ALL ON SEQUENCES FROM "${runtimeRole}"`,
  );
  await sql.unsafe(
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${ownerRole}" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${runtimeRole}"`,
  );
  await sql.unsafe(
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${ownerRole}" IN SCHEMA drizzle REVOKE ALL ON TABLES FROM "${runtimeRole}"`,
  );
  await sql.unsafe(
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${ownerRole}" IN SCHEMA drizzle GRANT SELECT ON TABLES TO "${runtimeRole}"`,
  );

  await sql.unsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${runtimeRole}"`,
  );
  await sql.unsafe(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${runtimeRole}"`,
  );
  await sql.unsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM "${runtimeRole}"`);
  await sql.unsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO "${runtimeRole}"`);
} catch (error) {
  failure = error;
} finally {
  await sql.end({ timeout: 5 });
  await writeJson(path.join(evidenceDir, "runtime-role-provision.json"), {
    schemaVersion: 1,
    status: failure ? "failed" : "passed",
    migrationOwner: ownerRole,
    runtimeRole,
    passwordless: true,
  });
}

if (failure) throw failure;
console.log(
  `Disposable database roles provisioned: migrator=${ownerRole}, runtime=${runtimeRole}`,
);
