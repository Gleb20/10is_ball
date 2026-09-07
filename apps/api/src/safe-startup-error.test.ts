import { describe, expect, it } from "vitest";
import { safeStartupErrorMessage } from "./safe-startup-error.js";

describe("safe startup error logging", () => {
  it("redacts PostgreSQL credentials from parser errors", () => {
    const sensitive =
      "Invalid URL input postgresql" + "://user:do-not-log@db.example/tab10";
    const message = safeStartupErrorMessage(new TypeError(sensitive));
    expect(message).toContain("[REDACTED_DATABASE_URL]");
    expect(message).not.toContain("do-not-log");
  });

  it("does not serialize an Error stack or arbitrary object", () => {
    expect(safeStartupErrorMessage({ password: "do-not-log" })).toBe(
      "Unknown startup error",
    );
  });
});
