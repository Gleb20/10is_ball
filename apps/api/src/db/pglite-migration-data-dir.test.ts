import { describe, expect, it } from "vitest";
import { requirePgliteMigrationDataDir } from "./pglite-migration-data-dir.js";

describe("requirePgliteMigrationDataDir", () => {
  it("requires an explicit persistent PGlite target", () => {
    expect(() => requirePgliteMigrationDataDir({})).toThrow(
      "PGLITE_DATA_DIR is required",
    );
    expect(
      requirePgliteMigrationDataDir({ PGLITE_DATA_DIR: ".data/pglite" }),
    ).toBe(".data/pglite");
  });

  it.each(["DATABASE_URL", "MIGRATION_DATABASE_URL"])(
    "rejects ambiguous simultaneous %s configuration",
    (name) => {
      expect(() =>
        requirePgliteMigrationDataDir({
          [name]: "postgresql://app:replace-me@db.example/tab10",
          PGLITE_DATA_DIR: ".data/pglite",
        }),
      ).toThrow("must be unset");
    },
  );
});
