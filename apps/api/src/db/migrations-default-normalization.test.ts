import { describe, expect, it } from "vitest";
import { normalizeCatalogDefault } from "./migrations.js";

describe("normalizeCatalogDefault", () => {
  it("treats Neon pg_catalog qualification as equivalent for built-in defaults", () => {
    expect(normalizeCatalogDefault("pg_catalog.gen_random_uuid()"))
      .toBe(normalizeCatalogDefault("gen_random_uuid()"));
  });
});
