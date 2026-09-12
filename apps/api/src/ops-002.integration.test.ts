import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { createMigratedPgliteDb } from "./db/client.js";

const RELEASE = { sha: "0123456789abcdef0123456789abcdef01234567", version: "1.10.1", environment: "test" as const, dirty: false };

const NOW = new Date("2026-09-07T12:34:56.000Z");

describe("OPS-002 / AT-OPS-OBS-001/002 readiness and observability", () => {
  const apps: FastifyInstance[] = [];
  const databaseCloses: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(databaseCloses.splice(0).map((close) => close()));
  });

  async function setup(options: {
    readinessProbe?: () => Promise<void>;
    requestIds?: string[];
  } = {}) {
    const database = await createMigratedPgliteDb();
    databaseCloses.push(database.close);
    const logLines: string[] = [];
    const requestIds = [...(options.requestIds ?? ["ops-002-request-1"])];
    const built = await buildApp({
      db: database.db,
      releaseMetadata: RELEASE,
      clock: new FakeClock(NOW),
      readinessProbe: options.readinessProbe,
      requestIdFactory: () => requestIds.shift() ?? "ops-002-request-fallback",
      logDestination: {
        write(line: string) {
          logLines.push(line);
        },
      },
    });
    apps.push(built.app);
    return { ...built, logLines };
  }

  it("keeps liveness independent and fails readiness closed on a DB outage", async () => {
    const databaseSecret = "db-password-must-not-appear";
    const databaseScheme = "postgres" + "ql://";
    const probe = vi.fn(async () => {
      throw new Error(
        `connection failed: ${databaseScheme}ops:${databaseSecret}@db.invalid/tab10`,
      );
    });
    const { app, logLines } = await setup({
      readinessProbe: probe,
      requestIds: ["liveness-request", "readiness-request"],
    });

    const liveness = await app.inject({ method: "GET", url: "/health" });
    expect(liveness.statusCode).toBe(200);
    expect(liveness.headers["x-request-id"]).toBe("liveness-request");
    expect(probe).not.toHaveBeenCalled();

    const readiness = await app.inject({ method: "GET", url: "/ready" });
    expect(readiness.statusCode).toBe(503);
    expect(readiness.headers["x-request-id"]).toBe("readiness-request");
    expect(readiness.json()).toEqual({
      code: "NOT_READY",
      message: "Сервис временно не готов",
      status: "not_ready",
      checks: { database: "failed" },
      time: NOW.toISOString(),
      release: RELEASE,
      requestId: "readiness-request",
    });
    expect(probe).toHaveBeenCalledTimes(1);

    const serialized = logLines.join("");
    expect(serialized).not.toContain(databaseSecret);
    expect(serialized).not.toContain(databaseScheme);
    const logs = logLines.map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "readiness_failed",
          requestId: "readiness-request",
          check: "database",
        }),
        expect.objectContaining({
          event: "request_completed",
          requestId: "readiness-request",
          method: "GET",
          route: "/ready",
          statusCode: 503,
          latencyMs: expect.any(Number),
        }),
      ]),
    );
  });

  it("probes a disposable DB and emits redacted correlated request/error logs", async () => {
    const { app, services, logLines } = await setup({
      requestIds: ["ready-request", "validation-request", "error-request"],
    });

    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      status: "ready",
      checks: { database: "ok" },
      time: NOW.toISOString(),
      release: RELEASE,
    });

    const validation = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "synthetic@example.test" },
    });
    expect(validation.statusCode).toBe(400);
    expect(validation.headers["x-request-id"]).toBe("validation-request");
    expect(validation.json()).toEqual({
      code: "VALIDATION",
      message: "email и password обязательны",
      requestId: "validation-request",
    });

    const errorSecret = "raw-error-secret";
    const databaseScheme = "postgres" + "ql://";
    vi.spyOn(services.auth, "resolveSession").mockRejectedValue(
      Object.assign(
        new Error(
          `driver failed ${databaseScheme}user:${errorSecret}@db.invalid/tab10`,
        ),
        { password: "error-object-password" },
      ),
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login?password=query-secret&token=query-token",
      headers: {
        authorization: "Bear" + "er authorization-secret",
        cookie: "tab10_session=cookie-secret",
        "x-csrf-token": "csrf-secret",
      },
      payload: {
        email: "synthetic@example.test",
        password: "body-secret",
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.headers["x-request-id"]).toBe("error-request");
    expect(response.json()).toEqual({
      code: "INTERNAL",
      message: "Внутренняя ошибка сервера",
      requestId: "error-request",
    });

    const serialized = logLines.join("");
    for (const secret of [
      errorSecret,
      "error-object-password",
      "query-secret",
      "query-token",
      "authorization-secret",
      "cookie-secret",
      "csrf-secret",
      "body-secret",
      databaseScheme,
    ]) {
      expect(serialized).not.toContain(secret);
    }

    const logs = logLines.map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "request_completed",
          requestId: "validation-request",
          method: "POST",
          route: "/api/v1/auth/login",
          statusCode: 400,
          latencyMs: expect.any(Number),
        }),
        expect.objectContaining({
          event: "request_error",
          requestId: "error-request",
          error: { type: "Error", code: "INTERNAL" },
        }),
        expect.objectContaining({
          event: "request_completed",
          requestId: "error-request",
          method: "POST",
          route: "/api/v1/auth/login",
          statusCode: 500,
          latencyMs: expect.any(Number),
        }),
      ]),
    );
  });
});
