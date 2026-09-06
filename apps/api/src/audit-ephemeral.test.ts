import { describe, expect, it } from "vitest";
import {
  assertAuditEphemeralConfig,
  assertRuntimeDatabaseConfig,
  isAuditEphemeral,
} from "./audit-ephemeral.js";

describe("audit ephemeral database guard", () => {
  it("does not attest an ordinary API process", () => {
    expect(assertAuditEphemeralConfig({})).toBe(false);
    expect(isAuditEphemeral({})).toBe(false);
  });

  it("attests only explicit in-memory PGlite", () => {
    const env = {
      AUDIT_EPHEMERAL: "1",
      DATABASE_URL: "",
      TEST_DATABASE_URL: "",
      PGLITE_DATA_DIR: "",
    };
    expect(assertAuditEphemeralConfig(env)).toBe(true);
    expect(isAuditEphemeral(env)).toBe(true);
  });

  it.each([
    ["DATABASE_URL", "postgresql://app:replace-me@db.example/tab10"],
    ["TEST_DATABASE_URL", "postgresql://app:replace-me@localhost/tab10_test"],
    ["PGLITE_DATA_DIR", ".data/pglite"],
  ])("rejects %s while audit mode is enabled", (name, value) => {
    expect(() =>
      assertAuditEphemeralConfig({ AUDIT_EPHEMERAL: "1", [name]: value }),
    ).toThrow("requires an in-memory PGlite database");
  });

  it("rejects an in-memory fallback in production", () => {
    expect(() => assertRuntimeDatabaseConfig({ NODE_ENV: "production" })).toThrow(
      "DATABASE_URL is required",
    );
  });

  it("accepts an explicit production database URL", () => {
    expect(
      assertRuntimeDatabaseConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://app:replace-me@db.example/tab10",
      }),
    ).toBe(false);
  });
});
