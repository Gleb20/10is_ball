import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("runtime schema policy", () => {
  it("keeps persistent startup read-only and verifies a compatible ledger", async () => {
    const source = await readFile(new URL("../index.ts", import.meta.url), "utf8");

    expect(source).not.toContain("applySchemaSql");
    expect(source).not.toContain("MIGRATE_ON_BOOT");
    expect(source).toContain("assertMigrationsCompatible");
    expect(source).toContain("if (auditEphemeral)");
  });
});
