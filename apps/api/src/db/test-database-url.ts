type TestDatabaseEnvironment = Readonly<
  Record<string, string | undefined>
>;

const TEST_DATABASE_NAME = /(?:^|[-_])test(?:$|[-_])/i;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Resolve the database used by destructive-capable PostgreSQL integration
 * tests. There is deliberately no DATABASE_URL fallback.
 */
export function resolveTestDatabaseUrl(
  env: TestDatabaseEnvironment,
  options: { required?: boolean } = {},
): string | undefined {
  const raw = env.TEST_DATABASE_URL?.trim();
  if (!raw) {
    if (options.required) {
      throw new Error(
        "TEST_DATABASE_URL is required for the PostgreSQL integration lane",
      );
    }
    return undefined;
  }

  if (env.NODE_ENV !== "test") {
    throw new Error("TEST_DATABASE_URL may only be used with NODE_ENV=test");
  }
  if (env.DATABASE_URL?.trim()) {
    throw new Error(
      "DATABASE_URL must be unset when PostgreSQL integration tests run",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("TEST_DATABASE_URL must use postgres or postgresql");
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error("TEST_DATABASE_URL must target a loopback host");
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    throw new Error("TEST_DATABASE_URL has an invalid database name");
  }
  if (
    !databaseName ||
    databaseName.includes("/") ||
    !TEST_DATABASE_NAME.test(databaseName)
  ) {
    throw new Error(
      'TEST_DATABASE_URL database name must contain a standalone "test" segment',
    );
  }

  if (env.ALLOW_TEST_DATABASE_RESET !== "1") {
    throw new Error(
      "ALLOW_TEST_DATABASE_RESET=1 is required before destructive PostgreSQL integration tests",
    );
  }

  return raw;
}
