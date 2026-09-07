import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import {
  assertMigrationsExactlyCurrent,
  runPgliteMigrations,
  type MigrationQuery,
} from "./migrations.js";

export type Db = ReturnType<typeof drizzlePglite<typeof schema>>;

export async function createPgliteDb(opts?: { dataDir?: string }): Promise<{
  db: Db;
  client: PGlite;
  queryMigrations: MigrationQuery;
  close: () => Promise<void>;
}> {
  const dataDir =
    opts?.dataDir ??
    (process.env.PGLITE_DATA_DIR?.trim()
      ? process.env.PGLITE_DATA_DIR.trim()
      : undefined);
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzlePglite(client, { schema });
  return {
    db,
    client,
    queryMigrations: async (query: string) =>
      (await client.query<Record<string, unknown>>(query)).rows,
    close: async () => {
      await client.close();
    },
  };
}

/** Explicit helper for disposable fixtures. Runtime startup remains read-only. */
export async function createMigratedPgliteDb(opts?: { dataDir?: string }) {
  const context = await createPgliteDb(opts);
  try {
    await runPgliteMigrations({
      db: context.db,
      query: context.queryMigrations,
      mode: "apply",
    });
    await assertMigrationsExactlyCurrent(context.queryMigrations);
    return context;
  } catch (error) {
    await context.close();
    throw error;
  }
}

export async function createPostgresDb(url: string): Promise<{
  db: Db;
  queryMigrations: MigrationQuery;
  close: () => Promise<void>;
}> {
  const client = postgres(url, { max: 10 });
  const db = drizzlePostgres(client, { schema });
  return {
    db: db as unknown as Db,
    queryMigrations: async (query: string) =>
      (await client.unsafe(query)) as Array<Record<string, unknown>>,
    close: async () => {
      await client.end();
    },
  };
}
