import { validateDisposableDatabaseEnvironment } from "./lib.mjs";

const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function validateLocalRolePolicyTarget({
  env = process.env,
  arguments_ = process.argv.slice(2),
} = {}) {
  const unknownArguments = arguments_.filter(
    (argument) => argument !== "--disposable-test",
  );
  if (unknownArguments.length > 0) {
    throw new Error("Unknown local-role policy argument");
  }
  const rawUrl = env.MIGRATION_DATABASE_URL?.trim();
  if (!rawUrl) throw new Error("MIGRATION_DATABASE_URL is required");
  const url = new URL(rawUrl);
  const disposableTestMode = arguments_.includes("--disposable-test");
  if (disposableTestMode) {
    const testUrl = validateDisposableDatabaseEnvironment(env);
    if (new URL(testUrl).href !== url.href) {
      throw new Error(
        "Disposable local-role policy requires MIGRATION_DATABASE_URL to equal TEST_DATABASE_URL",
      );
    }
    return rawUrl;
  }
  if (
    !POSTGRES_PROTOCOLS.has(url.protocol) ||
    !LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) ||
    decodeURIComponent(url.username) !== "tab10_migration_owner" ||
    decodeURIComponent(url.pathname.replace(/^\/+/, "")) !== "tab10"
  ) {
    throw new Error(
      "Local role policy accepts only the fixed loopback development database",
    );
  }
  return rawUrl;
}
