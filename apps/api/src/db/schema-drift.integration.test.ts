import { afterEach, describe, expect, it } from "vitest";
import { createPgliteDb } from "./client.js";
import { runPgliteMigrations } from "./migrations.js";

describe("unversioned schema drift policy", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("rejects a partial historical catalog instead of repairing it implicitly", async () => {
    const context = await createPgliteDb();
    close = context.close;
    await context.client.exec(`
      CREATE TABLE tournaments (
        id uuid PRIMARY KEY,
        title text NOT NULL
      )
    `);

    await expect(
      runPgliteMigrations({
        db: context.db,
        query: context.queryMigrations,
        mode: "adopt-unversioned",
      }),
    ).rejects.toThrow("Database schema drift");
    const ledger = await context.client.query<{ exists: boolean }>(`
      SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists
    `);
    expect(ledger.rows).toEqual([{ exists: false }]);
  });
});
