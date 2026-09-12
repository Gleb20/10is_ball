import { isIP } from "node:net";
import { fileURLToPath } from "node:url";

const SAFE_DATABASE_MARKER = /(^|[_-])(test|testing|ci|local|dev|rehearsal)([_-]|$)/i;
const SAFE_RESTORE_DATABASE = /^tab10_restore_rehearsal_[a-z0-9_]+$/i;

function parsePostgresUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use postgres or postgresql protocol");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database || database.includes("/")) {
    throw new Error("DATABASE_URL must name exactly one database");
  }
  return { url, database };
}

function isLoopbackHost(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "localhost" || normalized === "::1") return true;
  return isIP(normalized) === 4 && normalized.startsWith("127.");
}

export function validateBackupConfig({
  databaseUrl,
  restoreDb,
  confirmation,
}) {
  if (confirmation !== "1") {
    throw new Error("Backup rehearsal confirmation is required");
  }
  const { url, database } = parsePostgresUrl(databaseUrl);
  if (!isLoopbackHost(url.hostname)) {
    throw new Error("Backup rehearsal source must use a loopback host");
  }
  if (!SAFE_DATABASE_MARKER.test(database)) {
    throw new Error("Backup rehearsal source must be an explicitly named test database");
  }
  if (!SAFE_RESTORE_DATABASE.test(restoreDb ?? "")) {
    throw new Error("Restore database name is outside the rehearsal allowlist");
  }
  if (database === restoreDb) {
    throw new Error("Source and restore database must be different");
  }
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const restoreUrl = new URL(url);
  restoreUrl.pathname = `/${restoreDb}`;
  return {
    adminUrl: adminUrl.toString(),
    restoreUrl: restoreUrl.toString(),
    sourceDatabase: database,
    restoreDatabase: restoreDb,
  };
}

export function validateSeedApiBase(raw, nodeEnv = process.env.NODE_ENV) {
  if (nodeEnv === "production") {
    throw new Error("Local player seed is disabled in production");
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("API_BASE must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API_BASE must use HTTP(S)");
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new Error("Local player seed requires a loopback API_BASE");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString().replace(/\/$/, "");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (
      process.argv[2] !== "backup-admin-url" &&
      process.argv[2] !== "backup-restore-url"
    ) {
      throw new Error("Unknown ops-safety command");
    }
    const result = validateBackupConfig({
      databaseUrl: process.argv[3],
      restoreDb: process.argv[4],
      confirmation: process.argv[5],
    });
    process.stdout.write(
      process.argv[2] === "backup-admin-url"
        ? result.adminUrl
        : result.restoreUrl,
    );
  } catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 2;
  }
}
