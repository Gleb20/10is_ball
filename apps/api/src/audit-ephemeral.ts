type Environment = Record<string, string | undefined>;

/**
 * Audit fixture seeding is allowed only when the API itself proves it is using
 * an in-memory PGlite database. Localhost alone is not proof: it may proxy a
 * process backed by a persistent or remote database.
 */
export function assertAuditEphemeralConfig(env: Environment): boolean {
  if (env.AUDIT_EPHEMERAL !== "1") return false;

  const unsafe = ["DATABASE_URL", "TEST_DATABASE_URL", "PGLITE_DATA_DIR"].filter(
    (name) => env[name]?.trim(),
  );
  if (unsafe.length > 0) {
    throw new Error(
      `AUDIT_EPHEMERAL=1 requires an in-memory PGlite database; unset ${unsafe.join(
        ", ",
      )}`,
    );
  }
  return true;
}

export function isAuditEphemeral(env: Environment): boolean {
  return (
    env.AUDIT_EPHEMERAL === "1" &&
    !env.DATABASE_URL?.trim() &&
    !env.TEST_DATABASE_URL?.trim() &&
    !env.PGLITE_DATA_DIR?.trim()
  );
}

/** Production must never silently fall back to an in-memory database. */
export function assertRuntimeDatabaseConfig(env: Environment): boolean {
  const auditEphemeral = assertAuditEphemeralConfig(env);
  if (env.NODE_ENV === "production" && !env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required when NODE_ENV=production");
  }
  return auditEphemeral;
}
