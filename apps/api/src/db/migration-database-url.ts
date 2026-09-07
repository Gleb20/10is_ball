type MigrationEnvironment = Readonly<Record<string, string | undefined>>;

export type MigrationMode = "adopt-unversioned" | "apply";

const POSTGRES_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

function requiredProductionValue(
  env: MigrationEnvironment,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for a production migration`);
  }
  return value;
}

function assertProductionAttestation(
  env: MigrationEnvironment,
  parsed: URL,
  databaseName: string,
): void {
  if (env.TAB10_ENVIRONMENT?.trim().toLowerCase() !== "production") return;

  const confirmationSha = requiredProductionValue(
    env,
    "TAB10_MIGRATION_CONFIRM_SHA",
  );
  const releaseSha = requiredProductionValue(env, "TAB10_RELEASE_SHA");
  const githubSha = requiredProductionValue(env, "GITHUB_SHA");
  const fullSha = /^[0-9a-f]{40}$/i;
  if (
    !fullSha.test(confirmationSha) ||
    !fullSha.test(releaseSha) ||
    !fullSha.test(githubSha)
  ) {
    throw new Error(
      "Production migration confirmation requires full 40-character Git SHAs",
    );
  }
  if (confirmationSha !== releaseSha || releaseSha !== githubSha) {
    throw new Error(
      "TAB10_MIGRATION_CONFIRM_SHA, TAB10_RELEASE_SHA, and GITHUB_SHA must match exactly",
    );
  }

  for (const suffix of ["PROJECT_ID", "BRANCH_ID", "DATABASE"] as const) {
    const actualName = `TAB10_NEON_${suffix}`;
    const expectedName = `TAB10_EXPECTED_NEON_${suffix}`;
    const actual = requiredProductionValue(env, actualName);
    const expected = requiredProductionValue(env, expectedName);
    if (actual !== expected) {
      throw new Error(`${actualName} does not match ${expectedName}`);
    }
  }

  const directHost = requiredProductionValue(env, "TAB10_NEON_DIRECT_HOST");
  if (directHost.toLowerCase().includes("-pooler")) {
    throw new Error("TAB10_NEON_DIRECT_HOST must identify a non-pooled host");
  }
  if (parsed.hostname !== directHost) {
    throw new Error(
      "MIGRATION_DATABASE_URL host does not match TAB10_NEON_DIRECT_HOST",
    );
  }
  const expectedDatabase = requiredProductionValue(
    env,
    "TAB10_EXPECTED_NEON_DATABASE",
  );
  if (databaseName !== expectedDatabase) {
    throw new Error(
      "MIGRATION_DATABASE_URL database does not match TAB10_EXPECTED_NEON_DATABASE",
    );
  }

  let migrationUser: string;
  try {
    migrationUser = decodeURIComponent(parsed.username);
  } catch {
    throw new Error("MIGRATION_DATABASE_URL has an invalid database user");
  }
  const expectedMigrationRole = requiredProductionValue(
    env,
    "TAB10_NEON_MIGRATION_ROLE",
  );
  if (migrationUser !== expectedMigrationRole) {
    throw new Error(
      "MIGRATION_DATABASE_URL user does not match TAB10_NEON_MIGRATION_ROLE",
    );
  }
}

/**
 * When a separate runtime role is configured, migrations verify its complete
 * least-privilege profile. The disposable public stand intentionally omits it
 * and uses the database owner until the VPS migration; local/CI keep exercising
 * the stricter split-role path.
 */
export function requireRuntimeDatabaseRole(
  env: MigrationEnvironment,
  migrationDatabaseUrl: string,
): string | undefined {
  const role = env.TAB10_RUNTIME_DATABASE_ROLE?.trim();
  if (!role) return undefined;
  if (!POSTGRES_IDENTIFIER.test(role)) {
    throw new Error(
      "TAB10_RUNTIME_DATABASE_ROLE must be a safe lowercase PostgreSQL identifier",
    );
  }

  const parsed = new URL(migrationDatabaseUrl);
  let migrationUser: string;
  try {
    migrationUser = decodeURIComponent(parsed.username);
  } catch {
    throw new Error("MIGRATION_DATABASE_URL has an invalid database user");
  }
  if (role === migrationUser) {
    throw new Error(
      "TAB10_RUNTIME_DATABASE_ROLE must differ from the migration owner",
    );
  }
  return role;
}

/** A migration command must never silently succeed against disposable PGlite. */
export function requireMigrationDatabaseUrl(env: MigrationEnvironment): string {
  const raw = env.MIGRATION_DATABASE_URL?.trim();
  if (!raw) {
    throw new Error("MIGRATION_DATABASE_URL is required for db:migrate");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("MIGRATION_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("MIGRATION_DATABASE_URL must use postgres or postgresql");
  }
  if (!parsed.hostname || parsed.hostname.includes(",")) {
    throw new Error(
      "MIGRATION_DATABASE_URL must include one explicit database host",
    );
  }
  if (parsed.hostname.toLowerCase().includes("-pooler")) {
    throw new Error(
      "MIGRATION_DATABASE_URL must use a direct, non-pooled database host",
    );
  }
  if (!parsed.username) {
    throw new Error("MIGRATION_DATABASE_URL must include an explicit database user");
  }
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    throw new Error("MIGRATION_DATABASE_URL has an invalid database name");
  }
  if (!databaseName || databaseName.includes("/")) {
    throw new Error(
      "MIGRATION_DATABASE_URL must include one explicit database name",
    );
  }
  assertProductionAttestation(env, parsed, databaseName);
  requireRuntimeDatabaseRole(env, raw);
  return raw;
}

/** Destructive adoption must never be selected by omission or typo. */
export function requireMigrationMode(argv: readonly string[]): MigrationMode {
  const values: string[] = [];
  const unknown: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--mode") {
      values.push(argv[index + 1] ?? "");
      index += 1;
    } else if (argument.startsWith("--mode=")) {
      values.push(argument.slice("--mode=".length));
    } else {
      unknown.push(argument);
    }
  }

  if (unknown.length > 0) {
    throw new Error(`Unknown migration arguments: ${unknown.join(", ")}`);
  }

  if (values.length === 0) {
    throw new Error(
      "--mode is required (apply or adopt-unversioned)",
    );
  }
  if (values.length !== 1) {
    throw new Error("--mode must be provided exactly once");
  }
  const mode = values[0];
  if (mode !== "apply" && mode !== "adopt-unversioned") {
    throw new Error("--mode must be apply or adopt-unversioned");
  }
  return mode;
}
