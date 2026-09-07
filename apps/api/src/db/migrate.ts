import { loadLocalEnv } from "../load-local-env.js";
import { safeStartupErrorMessage } from "../safe-startup-error.js";
import {
  requireMigrationDatabaseUrl,
  requireMigrationMode,
} from "./migration-database-url.js";
import { runPostgresMigrations } from "./migrations.js";

async function main() {
  loadLocalEnv();
  const url = requireMigrationDatabaseUrl(process.env);
  const mode = requireMigrationMode(process.argv.slice(2));
  await runPostgresMigrations(url, mode);
  console.log(`PostgreSQL migrations completed and verified (${mode})`);
}

main().catch((error) => {
  console.error(`Migration failed: ${safeStartupErrorMessage(error)}`);
  process.exit(1);
});
