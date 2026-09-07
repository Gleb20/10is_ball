type MigrationEnvironment = Readonly<Record<string, string | undefined>>;

export function requirePgliteMigrationDataDir(
  env: MigrationEnvironment,
): string {
  if (env.DATABASE_URL?.trim() || env.MIGRATION_DATABASE_URL?.trim()) {
    throw new Error(
      "DATABASE_URL and MIGRATION_DATABASE_URL must be unset when db:migrate:pglite is used",
    );
  }
  const dataDir = env.PGLITE_DATA_DIR?.trim();
  if (!dataDir) {
    throw new Error("PGLITE_DATA_DIR is required for db:migrate:pglite");
  }
  return dataDir;
}
