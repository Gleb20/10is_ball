#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ROOT,
  argValue,
  publicError,
  requiredEnv,
  writeJsonAtomic,
} from "./release-lib.mjs";

const requireFromApi = createRequire(path.join(ROOT, "apps/api/package.json"));
const postgres = requireFromApi("postgres");
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

const sha256 = (value) =>
  createHash("sha256").update(String(value)).digest("hex");

function databaseName(parsed) {
  return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
}

function logicalNeonHost(hostname) {
  return hostname.toLowerCase().replace(/-pooler(?=\.)/, "");
}

export function validateRuntimeDatabaseUrl({
  runtimeDatabaseUrl,
  migrationDatabaseUrl,
  runtimeRole,
  allowDirect = false,
}) {
  let runtime;
  let migration;
  try {
    runtime = new URL(runtimeDatabaseUrl);
    migration = new URL(migrationDatabaseUrl);
  } catch {
    throw new Error("Runtime and migration database URLs must be valid PostgreSQL URLs");
  }
  const postgresProtocols = new Set(["postgres:", "postgresql:"]);
  if (
    !postgresProtocols.has(runtime.protocol) ||
    !postgresProtocols.has(migration.protocol) ||
    decodeURIComponent(runtime.username) !== runtimeRole ||
    databaseName(runtime) !== databaseName(migration) ||
    logicalNeonHost(runtime.hostname) !== logicalNeonHost(migration.hostname) ||
    (!allowDirect && !runtime.hostname.toLowerCase().includes("-pooler."))
  ) {
    throw new Error("Runtime database URL does not match the attested pooled role target");
  }
  return {
    url: runtime.href,
    database: databaseName(runtime),
  };
}

export function validateRuntimeSessionIdentity(identity, expected) {
  if (
    identity?.current_user !== expected.runtimeRole ||
    identity?.current_database !== expected.database ||
    Number(identity?.server_version_number) !== 160015
  ) {
    throw new Error("Runtime database session identity does not match the approved target");
  }
  return true;
}

function exactPrivileges(actual, expected, label) {
  const normalized = [...new Set(actual)].sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(normalized) !== JSON.stringify(wanted)) {
    throw new Error(`${label} does not have the exact least-privilege profile`);
  }
}

export function validateRuntimePrivilegeProfile(profile) {
  if (Number(profile.serverVersionNumber) !== 160015) {
    throw new Error("Hosted PostgreSQL server_version_num must be exactly 160015");
  }
  const role = profile.role;
  if (
    role?.rolcanlogin !== true ||
    role?.rolinherit !== false ||
    role?.rolsuper !== false ||
    role?.rolcreatedb !== false ||
    role?.rolcreaterole !== false ||
    role?.rolreplication !== false ||
    role?.rolbypassrls !== false
  ) {
    throw new Error("Runtime database role attributes are not least-privileged");
  }
  if (profile.membershipCount !== 0 || profile.ownedObjectCount !== 0) {
    throw new Error("Runtime database role has membership or ownership privileges");
  }
  exactPrivileges(profile.databasePrivileges, ["CONNECT"], "Runtime database");
  exactPrivileges(
    profile.databasePublicPrivileges,
    ["CONNECT"],
    "PUBLIC database",
  );
  for (const schema of ["public", "drizzle"]) {
    exactPrivileges(
      profile.schemaPrivileges[schema] ?? [],
      ["USAGE"],
      `Runtime ${schema} schema`,
    );
    exactPrivileges(
      profile.schemaPublicPrivileges[schema] ?? [],
      [],
      `PUBLIC ${schema} schema`,
    );
  }
  if (profile.publicTables.length === 0 || profile.drizzleTables.length === 0) {
    throw new Error("Runtime privilege attestation requires migrated tables");
  }
  for (const table of profile.publicTables) {
    exactPrivileges(
      table.privileges,
      ["DELETE", "INSERT", "SELECT", "UPDATE"],
      "Runtime public table",
    );
  }
  for (const table of profile.drizzleTables) {
    exactPrivileges(table.privileges, ["SELECT"], "Runtime migration ledger");
  }
  for (const sequence of profile.publicSequences) {
    exactPrivileges(
      sequence.privileges,
      ["SELECT", "USAGE"],
      "Runtime public sequence",
    );
  }
  const defaults = profile.defaultPrivileges.map(
    (entry) => `${entry.schema}:${entry.objectType}:${entry.privilege}`,
  );
  exactPrivileges(
    defaults,
    [
      "drizzle:r:SELECT",
      "public:S:SELECT",
      "public:S:USAGE",
      "public:r:DELETE",
      "public:r:INSERT",
      "public:r:SELECT",
      "public:r:UPDATE",
    ],
    "Migration-owner default ACL",
  );
  exactPrivileges(
    profile.defaultPublicPrivileges.map(
      (entry) => `${entry.schema}:${entry.objectType}:${entry.privilege}`,
    ),
    [],
    "PUBLIC migration-owner default ACL",
  );
  return profile;
}

function privileges(row, names) {
  return names.filter((name) => row[name.toLowerCase()] === true);
}

export async function attestRuntimeRole({
  env = process.env,
  connect = (url) => postgres(url, { max: 1, connect_timeout: 15 }),
  connectRuntime = (url) => postgres(url, { max: 1, connect_timeout: 15 }),
}) {
  const databaseUrl = requiredEnv(env, "MIGRATION_DATABASE_URL");
  const runtimeRole = requiredEnv(env, "TAB10_RUNTIME_DATABASE_ROLE");
  const migrationRole = requiredEnv(env, "TAB10_NEON_MIGRATION_ROLE");
  if (!IDENTIFIER.test(runtimeRole) || !IDENTIFIER.test(migrationRole)) {
    throw new Error("Database role names must be safe lowercase identifiers");
  }
  if (runtimeRole === migrationRole) {
    throw new Error("Runtime and migration database roles must be distinct");
  }
  const parsed = new URL(databaseUrl);
  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    parsed.hostname.toLowerCase().includes("-pooler") ||
    decodeURIComponent(parsed.username) !== migrationRole
  ) {
    throw new Error("Runtime attestation requires the direct migration-owner URL");
  }
  let runtimeDatabaseUrl = env.RUNTIME_DATABASE_URL?.trim();
  const allowDirectRuntime = env.NODE_ENV === "test";
  if (!runtimeDatabaseUrl && allowDirectRuntime) {
    const localRuntime = new URL(databaseUrl);
    localRuntime.username = runtimeRole;
    localRuntime.password = "";
    runtimeDatabaseUrl = localRuntime.href;
  }
  if (!runtimeDatabaseUrl) {
    throw new Error("Required environment variable is missing: RUNTIME_DATABASE_URL");
  }
  const runtimeTarget = validateRuntimeDatabaseUrl({
    runtimeDatabaseUrl,
    migrationDatabaseUrl: databaseUrl,
    runtimeRole,
    allowDirect: allowDirectRuntime,
  });
  const sql = connect(databaseUrl);
  try {
    await sql.unsafe("SET statement_timeout TO '30000ms'");
    await sql.unsafe("SET lock_timeout TO '5000ms'");
    const [identity] = await sql`
      SELECT current_user AS current_user,
             current_database() AS current_database,
             current_setting('server_version') AS server_version,
             current_setting('server_version_num')::integer AS server_version_number
    `;
    if (identity?.current_user !== migrationRole) {
      throw new Error("Direct database session is not the migration owner");
    }
    const [role] = await sql`
      SELECT rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
             rolreplication, rolbypassrls
      FROM pg_catalog.pg_roles
      WHERE rolname = ${runtimeRole}
    `;
    if (!role) throw new Error("Runtime database role does not exist");
    const [membership] = await sql`
      SELECT count(*)::integer AS count
      FROM pg_catalog.pg_auth_members memberships
      JOIN pg_catalog.pg_roles member_role
        ON member_role.oid = memberships.member
      JOIN pg_catalog.pg_roles granted_role
        ON granted_role.oid = memberships.roleid
      WHERE member_role.rolname = ${runtimeRole}
         OR granted_role.rolname = ${runtimeRole}
    `;
    const [ownership] = await sql`
      SELECT (
        (SELECT count(*) FROM pg_catalog.pg_database d
          JOIN pg_catalog.pg_roles r ON r.oid = d.datdba
          WHERE r.rolname = ${runtimeRole}) +
        (SELECT count(*) FROM pg_catalog.pg_namespace n
          JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
          WHERE r.rolname = ${runtimeRole}) +
        (SELECT count(*) FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
          WHERE r.rolname = ${runtimeRole}) +
        (SELECT count(*) FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
          WHERE r.rolname = ${runtimeRole})
      )::integer AS count
    `;
    const [database] = await sql`
      SELECT
        has_database_privilege(${runtimeRole}, current_database(), 'CONNECT') AS "connect",
        has_database_privilege(${runtimeRole}, current_database(), 'CREATE') AS "create",
        has_database_privilege(${runtimeRole}, current_database(), 'TEMP') AS "temp"
    `;
    const databasePublicPrivileges = await sql`
      SELECT expanded.privilege_type AS privilege
      FROM pg_catalog.pg_database database
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(database.datacl, pg_catalog.acldefault('d', database.datdba))
      ) expanded
      WHERE database.datname = current_database()
        AND expanded.grantee = 0
      ORDER BY expanded.privilege_type
    `;
    const schemas = await sql`
      SELECT schema_name,
        has_schema_privilege(${runtimeRole}, schema_name, 'USAGE') AS "usage",
        has_schema_privilege(${runtimeRole}, schema_name, 'CREATE') AS "create"
      FROM (VALUES ('public'), ('drizzle')) expected(schema_name)
    `;
    const schemaPublicPrivileges = await sql`
      SELECT namespace.nspname AS schema_name,
             expanded.privilege_type AS privilege
      FROM pg_catalog.pg_namespace namespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
      ) expanded
      WHERE namespace.nspname IN ('public', 'drizzle')
        AND expanded.grantee = 0
      ORDER BY namespace.nspname, expanded.privilege_type
    `;
    const tables = await sql`
      SELECT n.nspname AS schema_name, c.relname AS object_name,
        has_table_privilege(${runtimeRole}, c.oid, 'SELECT') AS "select",
        has_table_privilege(${runtimeRole}, c.oid, 'INSERT') AS "insert",
        has_table_privilege(${runtimeRole}, c.oid, 'UPDATE') AS "update",
        has_table_privilege(${runtimeRole}, c.oid, 'DELETE') AS "delete",
        has_table_privilege(${runtimeRole}, c.oid, 'TRUNCATE') AS "truncate",
        has_table_privilege(${runtimeRole}, c.oid, 'REFERENCES') AS "references",
        has_table_privilege(${runtimeRole}, c.oid, 'TRIGGER') AS "trigger"
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'drizzle')
        AND c.relkind IN ('r', 'p')
      ORDER BY n.nspname, c.relname
    `;
    const sequences = await sql`
      SELECT c.relname AS object_name,
        has_sequence_privilege(${runtimeRole}, c.oid, 'USAGE') AS "usage",
        has_sequence_privilege(${runtimeRole}, c.oid, 'SELECT') AS "select",
        has_sequence_privilege(${runtimeRole}, c.oid, 'UPDATE') AS "update"
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'S'
      ORDER BY c.relname
    `;
    const defaultPrivileges = await sql`
      SELECT n.nspname AS schema, defaults.defaclobjtype AS object_type,
             expanded.privilege_type AS privilege
      FROM pg_catalog.pg_default_acl defaults
      JOIN pg_catalog.pg_namespace n ON n.oid = defaults.defaclnamespace
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = defaults.defaclrole
      CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) expanded
      JOIN pg_catalog.pg_roles grantee_role ON grantee_role.oid = expanded.grantee
      WHERE owner_role.rolname = ${migrationRole}
        AND grantee_role.rolname = ${runtimeRole}
        AND n.nspname IN ('public', 'drizzle')
      ORDER BY n.nspname, defaults.defaclobjtype, expanded.privilege_type
    `;
    const defaultPublicPrivileges = await sql`
      SELECT n.nspname AS schema, defaults.defaclobjtype AS object_type,
             expanded.privilege_type AS privilege
      FROM pg_catalog.pg_default_acl defaults
      JOIN pg_catalog.pg_namespace n ON n.oid = defaults.defaclnamespace
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = defaults.defaclrole
      CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) expanded
      WHERE owner_role.rolname = ${migrationRole}
        AND expanded.grantee = 0
        AND n.nspname IN ('public', 'drizzle')
      ORDER BY n.nspname, defaults.defaclobjtype, expanded.privilege_type
    `;
    const tablePrivilegeNames = [
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "TRUNCATE",
      "REFERENCES",
      "TRIGGER",
    ];
    const profile = {
      serverVersionNumber: Number(identity.server_version_number),
      role,
      membershipCount: Number(membership?.count),
      ownedObjectCount: Number(ownership?.count),
      databasePrivileges: privileges(database, ["CONNECT", "CREATE", "TEMP"]),
      databasePublicPrivileges: databasePublicPrivileges.map(
        (entry) => entry.privilege,
      ),
      schemaPrivileges: Object.fromEntries(
        schemas.map((schema) => [
          schema.schema_name,
          privileges(schema, ["USAGE", "CREATE"]),
        ]),
      ),
      schemaPublicPrivileges: Object.fromEntries(
        ["public", "drizzle"].map((schemaName) => [
          schemaName,
          schemaPublicPrivileges
            .filter((entry) => entry.schema_name === schemaName)
            .map((entry) => entry.privilege),
        ]),
      ),
      publicTables: tables
        .filter((table) => table.schema_name === "public")
        .map((table) => ({
          objectRefSha256: sha256(table.object_name),
          privileges: privileges(table, tablePrivilegeNames),
        })),
      drizzleTables: tables
        .filter((table) => table.schema_name === "drizzle")
        .map((table) => ({
          objectRefSha256: sha256(table.object_name),
          privileges: privileges(table, tablePrivilegeNames),
        })),
      publicSequences: sequences.map((sequence) => ({
        objectRefSha256: sha256(sequence.object_name),
        privileges: privileges(sequence, ["USAGE", "SELECT", "UPDATE"]),
      })),
      defaultPrivileges: defaultPrivileges.map((entry) => ({
        schema: entry.schema,
        objectType: entry.object_type,
        privilege: entry.privilege,
      })),
      defaultPublicPrivileges: defaultPublicPrivileges.map((entry) => ({
        schema: entry.schema,
        objectType: entry.object_type,
        privilege: entry.privilege,
      })),
    };
    validateRuntimePrivilegeProfile(profile);
    const runtimeSql = connectRuntime(runtimeTarget.url);
    try {
      await runtimeSql.unsafe("SET statement_timeout TO '30000ms'");
      await runtimeSql.unsafe("SET lock_timeout TO '5000ms'");
      const [runtimeIdentity] = await runtimeSql`
        SELECT current_user AS current_user,
               current_database() AS current_database,
               current_setting('server_version_num')::integer AS server_version_number
      `;
      validateRuntimeSessionIdentity(runtimeIdentity, {
        runtimeRole,
        database: runtimeTarget.database,
      });
    } finally {
      await runtimeSql.end({ timeout: 5 });
    }
    const evidence = {
      ok: true,
      postgresVersion: identity.server_version,
      serverVersionNumber: profile.serverVersionNumber,
      runtimeRoleRefSha256: sha256(runtimeRole),
      runtimeAuthenticated: true,
      publicTableCount: profile.publicTables.length,
      publicSequenceCount: profile.publicSequences.length,
      privilegeEvidence: {
        runtimeDatabase: profile.databasePrivileges,
        publicDatabase: profile.databasePublicPrivileges,
        runtimeSchemas: profile.schemaPrivileges,
        publicSchemas: profile.schemaPublicPrivileges,
        publicDefaultPrivilegeCount: profile.defaultPublicPrivileges.length,
        publicTableForbiddenPrivilegeCount: profile.publicTables.reduce(
          (count, table) =>
            count +
            table.privileges.filter((privilege) =>
              ["TRUNCATE", "REFERENCES", "TRIGGER"].includes(privilege),
            ).length,
          0,
        ),
        publicSequenceUpdatePrivilegeCount: profile.publicSequences.filter(
          (sequence) => sequence.privileges.includes("UPDATE"),
        ).length,
      },
      profileSha256: sha256(JSON.stringify(profile)),
      checkedAt: new Date().toISOString(),
    };
    return evidence;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  const resultFile = argValue(process.argv.slice(2), "--result-file");
  if (!resultFile) throw new Error("--result-file is required");
  const result = await attestRuntimeRole({});
  await writeJsonAtomic(resultFile, result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${publicError(error)}\n`);
    process.exitCode = 1;
  });
}
