import { createPgliteDb, createPostgresDb, applySchemaSql } from "./client.js";

async function main() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { close } = await createPostgresDb(url);
    // For postgres, run SQL via a one-off connection
    const postgres = (await import("postgres")).default;
    const sql = postgres(url);
    await applySchemaSql(
      {
        exec: async (q) => {
          await sql.unsafe(q);
        },
      },
      { withPgcrypto: true },
    );
    await sql.end();
    await close();
    console.log("Migrations applied (postgres)");
    return;
  }
  const { close } = await createPgliteDb();
  await close();
  console.log("Migrations applied (pglite smoke)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
