import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { FakeClock } from "@tab10/test-utils";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, createPgliteDb } from "./db/client.js";
import { runPgliteMigrations } from "./db/migrations.js";
import { readFileSync } from "node:fs";

describe("BUG-012 persisted onboarding state", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let close: () => Promise<void>;

  beforeEach(async () => {
    const context = await createMigratedPgliteDb();
    close = context.close;
    const built = await buildApp({
      db: context.db,
      clock: new FakeClock(new Date("2026-09-07T09:00:00.000Z")),
    });
    app = built.app;
    services = built.services;
    await services.auth.seedAdmin("onboarding@tab10.local", "AdminPass1!");
  });

  afterEach(async () => {
    await app?.close();
    await close?.();
  });

  async function login() {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "onboarding@tab10.local",
        password: "AdminPass1!",
      },
    });
    expect(response.statusCode).toBe(200);
    return response.cookies.find((cookie) => cookie.name === "tab10_session")!
      .value;
  }

  it("AT-ONB-001 resumes the persisted step after a new login and completes once", async () => {
    const firstSession = await login();
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/auth/me",
          cookies: { tab10_session: firstSession },
        })
      ).json().user,
    ).toMatchObject({ onboardingStep: 0, onboardingCompletedAt: null });

    const progress = await app.inject({
      method: "PATCH",
      url: "/api/v1/me/onboarding",
      cookies: { tab10_session: firstSession },
      payload: { action: "set-step", step: 4 },
    });
    expect(progress.statusCode).toBe(200);
    expect(progress.json().user).toMatchObject({
      onboardingStep: 4,
      onboardingCompletedAt: null,
    });

    const resumedSession = await login();
    const resumed = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      cookies: { tab10_session: resumedSession },
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().user).toMatchObject({
      onboardingStep: 4,
      onboardingCompletedAt: null,
    });

    const completed = await app.inject({
      method: "PATCH",
      url: "/api/v1/me/onboarding",
      cookies: { tab10_session: resumedSession },
      payload: { action: "complete" },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().user).toMatchObject({ onboardingStep: 6 });
    expect(completed.json().user.onboardingCompletedAt).toBe(
      "2026-09-07T09:00:00.000Z",
    );
  });

  it("rejects an invalid step without changing persisted progress", async () => {
    const session = await login();
    const invalid = await app.inject({
      method: "PATCH",
      url: "/api/v1/me/onboarding",
      cookies: { tab10_session: session },
      payload: { action: "set-step", step: 99 },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe("VALIDATION");

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      cookies: { tab10_session: session },
    });
    expect(me.json().user).toMatchObject({
      onboardingStep: 0,
      onboardingCompletedAt: null,
    });
  });

  it("AT-ONB-002 restarts a completed onboarding from the first step", async () => {
    const session = await login();
    await app.inject({
      method: "PATCH",
      url: "/api/v1/me/onboarding",
      cookies: { tab10_session: session },
      payload: { action: "complete" },
    });

    const restarted = await app.inject({
      method: "PATCH",
      url: "/api/v1/me/onboarding",
      cookies: { tab10_session: session },
      payload: { action: "restart" },
    });
    expect(restarted.statusCode).toBe(200);
    expect(restarted.json().user).toMatchObject({
      onboardingStep: 0,
      onboardingCompletedAt: null,
    });
  });
});

describe("BUG-012 onboarding migration", () => {
  it("keeps first-password accounts incomplete and does not force legacy active accounts into onboarding", async () => {
    const context = await createPgliteDb();
    try {
      await context.client.exec(`
        ${readFileSync(new URL("../drizzle/0000_data_003_baseline.sql", import.meta.url), "utf8")}
        INSERT INTO users (
          id, email, password_hash, first_name, last_name,
          must_change_password, updated_at
        ) VALUES
          ('00000000-0000-4000-8000-000000000001', 'legacy@tab10.local', 'hash', 'Legacy', 'User', false, '2026-09-01T10:00:00Z'),
          ('00000000-0000-4000-8000-000000000002', 'first@tab10.local', 'hash', 'First', 'Login', true, '2026-09-01T11:00:00Z');
      `);

      await runPgliteMigrations({ db: context.db, query: context.queryMigrations, mode: "adopt-unversioned" });
      const rows = await context.client.query<{
        email: string;
        onboarding_step: number;
        onboarding_completed_at: string | null;
      }>(`
        SELECT email, onboarding_step, onboarding_completed_at::text
        FROM users
        ORDER BY email
      `);
      expect(rows.rows).toEqual([
        {
          email: "first@tab10.local",
          onboarding_step: 0,
          onboarding_completed_at: null,
        },
        {
          email: "legacy@tab10.local",
          onboarding_step: 0,
          onboarding_completed_at: "2026-09-01 10:00:00+00",
        },
      ]);
    } finally {
      await context.close();
    }
  });
});
