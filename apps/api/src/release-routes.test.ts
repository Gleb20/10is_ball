import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "./db/client.js";
import { buildApp } from "./app.js";

const RELEASE = {
  sha: "0123456789abcdef0123456789abcdef01234567",
  version: "1.10.1",
  environment: "test",
  dirty: false,
} as const;

describe("release health routes", () => {
  const apps: Awaited<ReturnType<typeof buildApp>>["app"][] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    vi.restoreAllMocks();
  });

  it("reports identical release metadata from health and readiness", async () => {
    const { app } = await buildApp({
      db: {} as Db,
      releaseMetadata: RELEASE,
      readinessProbe: async () => undefined,
    });
    apps.push(app);

    const health = await app.inject({ method: "GET", url: "/health" });
    const ready = await app.inject({ method: "GET", url: "/ready" });
    const openApi = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json",
    });

    expect(health.statusCode).toBe(200);
    expect(ready.statusCode).toBe(200);
    expect(openApi.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", release: RELEASE });
    expect(ready.json()).toMatchObject({ status: "ready", release: RELEASE });
    expect(openApi.json()).toMatchObject({
      info: { version: RELEASE.version },
    });
  });

  it("returns a redacted 503 readiness response when the dependency fails", async () => {
    const { app } = await buildApp({
      db: {} as Db,
      releaseMetadata: RELEASE,
      readinessProbe: async () => {
        throw new Error(
          ["postgresql", "://app:synthetic-redaction-secret@database.example/tab10"].join(""),
        );
      },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "not_ready",
      release: RELEASE,
    });
    expect(response.body).not.toContain("secret");
    expect(response.body).not.toContain("postgresql");
  });

  it("never writes raw request exceptions to provider logs", async () => {
    const sentinel = [
      "postgresql",
      "://runtime:request-secret@database.invalid/tab10",
    ].join("");
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...values: unknown[]) => {
      logged.push(values.map(String).join(" "));
    });
    const { app } = await buildApp({
      db: {} as Db,
      releaseMetadata: RELEASE,
      readinessProbe: async () => undefined,
    });
    apps.push(app);
    app.get("/__test/runtime-error", async () => {
      throw new Error(sentinel);
    });

    const response = await app.inject({
      method: "GET",
      url: "/__test/runtime-error",
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: "INTERNAL",
      message: "Внутренняя ошибка сервера",
    });
    expect(logged).toEqual([
      JSON.stringify({
        level: "error",
        event: "request_failed",
        code: "INTERNAL",
      }),
    ]);
    expect(logged.join("\n")).not.toContain(sentinel);
    expect(logged.join("\n")).not.toContain("request-secret");
  });
});
