import { applySchemaSql } from "./client.js";
import { loadLocalEnv } from "../load-local-env.js";
import { safeStartupErrorMessage } from "../safe-startup-error.js";
import { requireMigrationDatabaseUrl } from "./migration-database-url.js";

async function main() {
  loadLocalEnv();
  const url = requireMigrationDatabaseUrl(process.env);
  const postgres = (await import("postgres")).default;
  const sql = postgres(url, { max: 1 });
  try {
    await applySchemaSql(
      {
        exec: async (q) => {
          await sql.unsafe(q);
        },
      },
      { withPgcrypto: true },
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
  console.log("Migrations applied (postgres)");
}

main().catch((error) => {
  console.error(`Migration failed: ${safeStartupErrorMessage(error)}`);
  process.exit(1);
});
