type MigrationEnvironment = Readonly<Record<string, string | undefined>>;

/** A migration command must never silently succeed against disposable PGlite. */
export function requireMigrationDatabaseUrl(env: MigrationEnvironment): string {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) {
    throw new Error("DATABASE_URL is required for db:migrate");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use postgres or postgresql");
  }
  if (!parsed.hostname || parsed.hostname.includes(",")) {
    throw new Error("DATABASE_URL must include one explicit database host");
  }
  if (!parsed.username) {
    throw new Error("DATABASE_URL must include an explicit database user");
  }
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    throw new Error("DATABASE_URL has an invalid database name");
  }
  if (!databaseName || databaseName.includes("/")) {
    throw new Error("DATABASE_URL must include one explicit database name");
  }
  return raw;
}
