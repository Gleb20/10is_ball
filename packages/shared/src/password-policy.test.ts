import { describe, expect, it } from "vitest";
import {
  generateTemporaryPassword,
  validatePassword,
} from "./password-policy.js";

describe("REQ_AUTH__password_policy", () => {
  it("accepts a valid password", () => {
    expect(validatePassword("Abcdef1!xy")).toEqual({ ok: true });
  });

  it("reports each missing requirement", () => {
    const r = validatePassword("short");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContain("TOO_SHORT");
      expect(r.errors).toContain("MISSING_UPPERCASE");
      expect(r.errors).toContain("MISSING_DIGIT");
      expect(r.errors).toContain("MISSING_SPECIAL");
    }
  });

  it("generated temp password always validates", () => {
    let n = 0;
    const rnd = () => {
      n += 17;
      return n % 256;
    };
    for (let i = 0; i < 20; i += 1) {
      const pwd = generateTemporaryPassword(16, rnd);
      expect(validatePassword(pwd)).toEqual({ ok: true });
    }
  });
});
