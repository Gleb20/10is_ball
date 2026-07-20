import { createPgliteDb, createPostgresDb } from "./db/client.js";
import { buildApp } from "./app.js";

async function main() {
  const url = process.env.DATABASE_URL;
  const { db, close } = url
    ? await createPostgresDb(url)
    : await createPgliteDb();

  const { app, services } = await buildApp({ db });

  if (process.env.SEED_ADMIN !== "0") {
    await services.auth.seedAdmin(
      process.env.SEED_ADMIN_EMAIL ?? "admin@tab10.local",
      process.env.SEED_ADMIN_PASSWORD ?? "AdminPass1!",
    );
  }
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
