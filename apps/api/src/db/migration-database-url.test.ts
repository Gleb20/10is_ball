import { describe, expect, it } from "vitest";
import { requireMigrationDatabaseUrl } from "./migration-database-url.js";

const POSTGRES_SCHEME = "postgresql" + "://";

describe("requireMigrationDatabaseUrl", () => {
  it("does not fall back to an in-memory database", () => {
    expect(() => requireMigrationDatabaseUrl({})).toThrow(
      "DATABASE_URL is required for db:migrate",
    );
  });

  it("accepts only an explicit PostgreSQL URL", () => {
    expect(() =>
      requireMigrationDatabaseUrl({ DATABASE_URL: "https://db.example/tab10" }),
    ).toThrow("must use postgres or postgresql");
    expect(
      requireMigrationDatabaseUrl({
        DATABASE_URL: `${POSTGRES_SCHEME}app:replace-me@db.example/tab10`,
      }),
    ).toBe(`${POSTGRES_SCHEME}app:replace-me@db.example/tab10`);
  });

  it.each([
    [`${POSTGRES_SCHEME}?`, "one explicit database host"],
    [`${POSTGRES_SCHEME}/tab10`, "one explicit database host"],
    [`${POSTGRES_SCHEME}localhost`, "explicit database user"],
    [`${POSTGRES_SCHEME}app@localhost`, "one explicit database name"],
    [`${POSTGRES_SCHEME}app@host-a,host-b/tab10`, "one explicit database host"],
  ])("rejects an implicit or incomplete target: %s", (url, message) => {
    expect(() => requireMigrationDatabaseUrl({ DATABASE_URL: url })).toThrow(
      message,
    );
  });
});
