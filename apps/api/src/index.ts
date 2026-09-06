import {
  applySchemaSql,
  createPgliteDb,
  createPostgresDb,
} from "./db/client.js";
import { buildApp } from "./app.js";
import {
  ensureBootstrapAdmin,
  resolveBootstrapAdminConfig,
} from "./bootstrap-admin.js";
import { assertRuntimeDatabaseConfig } from "./audit-ephemeral.js";
import { safeStartupErrorMessage } from "./safe-startup-error.js";
import { loadLocalEnv } from "./load-local-env.js";

async function ensurePostgresSchema(url: string) {
  if (process.env.MIGRATE_ON_BOOT === "0") return;
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
    console.log("Postgres schema ensured");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  loadLocalEnv();
  assertRuntimeDatabaseConfig(process.env);
  // Validate the explicit bootstrap request before touching the database. A
  // missing or weak credential must prevent startup, not produce partial state.
  const bootstrapAdmin = resolveBootstrapAdminConfig(process.env);
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    await ensurePostgresSchema(url);
  }

  const { db, close } = url
    ? await createPostgresDb(url)
    : await createPgliteDb();

  if (!url && process.env.PGLITE_DATA_DIR) {
    console.log(`PGlite persistent dir: ${process.env.PGLITE_DATA_DIR}`);
  }
  const { app, services } = await buildApp({ db });

  await ensureBootstrapAdmin(services.auth, bootstrapAdmin);
  await services.help.seedFaq();

  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? "0.0.0.0";

  const shutdown = async () => {
    await app.close();
    await close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port, host });
  console.log(`Tab-10 API listening on http://${host}:${port}`);
  if (process.env.WEB_ORIGIN) {
    console.log(`CORS WEB_ORIGIN=${process.env.WEB_ORIGIN}`);
  }
}

main().catch((err) => {
  console.error(`API startup failed: ${safeStartupErrorMessage(err)}`);
  process.exit(1);
});
