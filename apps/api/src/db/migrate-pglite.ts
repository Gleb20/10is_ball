import { loadLocalEnv } from "../load-local-env.js";
import { safeStartupErrorMessage } from "../safe-startup-error.js";
import { createPgliteDb } from "./client.js";
import { requireMigrationMode } from "./migration-database-url.js";
import { runPgliteMigrations } from "./migrations.js";
import { requirePgliteMigrationDataDir } from "./pglite-migration-data-dir.js";

async function main() {
  loadLocalEnv();
  const dataDir = requirePgliteMigrationDataDir(process.env);
  const mode = requireMigrationMode(process.argv.slice(2));
  const context = await createPgliteDb({ dataDir });
  try {
    await runPgliteMigrations({
      db: context.db,
      query: context.queryMigrations,
      mode,
    });
  } finally {
    await context.close();
  }
  console.log(`PGlite migrations completed and verified (${mode})`);
}

main().catch((error) => {
  console.error(`Migration failed: ${safeStartupErrorMessage(error)}`);
  process.exit(1);
});
