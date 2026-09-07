import { createPgliteDb, createPostgresDb } from "./db/client.js";
import { buildApp } from "./app.js";
import {
  ensureBootstrapAdmin,
  resolveBootstrapAdminConfig,
} from "./bootstrap-admin.js";
import { assertRuntimeDatabaseConfig } from "./audit-ephemeral.js";
import { safeStartupErrorMessage } from "./safe-startup-error.js";
import { loadLocalEnv } from "./load-local-env.js";
import {
  assertMigrationsCompatible,
  runPgliteMigrations,
} from "./db/migrations.js";

async function main() {
  loadLocalEnv();
  const auditEphemeral = assertRuntimeDatabaseConfig(process.env);
  // Validate the explicit bootstrap request before connecting. A
  // missing or weak credential must prevent startup, not produce partial state.
  const bootstrapAdmin = resolveBootstrapAdminConfig(process.env);
  const url = process.env.DATABASE_URL?.trim();
  const database = url
    ? await createPostgresDb(url)
    : await createPgliteDb();

  try {
    // Only the explicitly attested in-memory audit fixture is initialized at
    // runtime. Persistent PGlite and every PostgreSQL target are read-only here.
    if (auditEphemeral) {
      await runPgliteMigrations({
        db: database.db,
        query: database.queryMigrations,
        mode: "apply",
      });
      console.log("Disposable PGlite migrations applied");
    }
    await assertMigrationsCompatible(database.queryMigrations);
    console.log("Database migration ledger verified");

    if (!url && process.env.PGLITE_DATA_DIR) {
      console.log("PGlite persistent storage selected");
    }
    const { app, services } = await buildApp({ db: database.db });

    await ensureBootstrapAdmin(services.auth, bootstrapAdmin);
    await services.help.seedFaq();

    const port = Number(process.env.PORT ?? 3001);
    const host = process.env.HOST ?? "0.0.0.0";

    const shutdown = async () => {
      await app.close();
      await database.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await app.listen({ port, host });
    console.log("Tab-10 API listening");
    if (process.env.WEB_ORIGIN) {
      console.log("CORS origin policy configured");
    }
  } catch (error) {
    await database.close();
    throw error;
  }
}

main().catch((err) => {
  console.error(`API startup failed: ${safeStartupErrorMessage(err)}`);
  process.exit(1);
});
