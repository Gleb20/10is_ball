import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { FakeClock } from "@tab10/test-utils";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb } from "./db/client.js";
import {
  adminPasswordResetRequests,
  auditLogs,
  authSessions,
  notifications,
  temporaryPasswordIssues,
  users,
} from "./db/schema.js";

const REQUEST_A = "00000000-0000-4000-8000-0000000000a1";
const REQUEST_B = "00000000-0000-4000-8000-0000000000b2";
const REQUEST_C = "00000000-0000-4000-8000-0000000000c3";

describe("BUG-038 correlated admin password reset", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let close: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createMigratedPgliteDb>>["db"];
  let adminCookie: string;
  let targetId: string;
  let originalTemporaryPassword: string;

  beforeEach(async () => {
    const context = await createMigratedPgliteDb();
    db = context.db;
    close = context.close;
    const built = await buildApp({
      db,
      clock: new FakeClock(new Date("2026-10-03T12:00:00.000Z")),
    });
    app = built.app;
    services = built.services;
    await services.auth.seedAdmin("admin@reset.test", "AdminPass1!");
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@reset.test", password: "AdminPass1!" },
    });
    adminCookie = login.cookies.find((cookie) => cookie.name === "tab10_session")!.value;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      cookies: { tab10_session: adminCookie },
      payload: {
        email: "target@reset.test",
        firstName: "Reset",
        lastName: "Target",
      },
    });
    expect(created.statusCode).toBe(200);
    targetId = created.json().user.id as string;
    originalTemporaryPassword = created.json().temporaryPassword as string;
  });

  afterEach(async () => {
    await app?.close();
    await close?.();
  });

  const stateUrl = () => `/api/v1/admin/users/${targetId}/reset-password/state`;
  const receiptUrl = (requestId: string) =>
    `/api/v1/admin/users/${targetId}/reset-password/requests/${requestId}`;

  async function reset(
    requestId: string | undefined,
    body: {
      expectedLastAppliedRequestId: string | null;
      supersedesRequestId?: string;
      confirmReplacement?: true;
    },
  ) {
    return app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${targetId}/reset-password`,
      cookies: { tab10_session: adminCookie },
      headers: requestId ? { "idempotency-key": requestId } : undefined,
      payload: body,
    });
  }

  it("fails closed for an unkeyed legacy POST before any mutation", async () => {
    const before = await db.query.users.findFirst({ where: eq(users.id, targetId) });

    const response = await reset(undefined, {
      expectedLastAppliedRequestId: null,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(await db.query.users.findFirst({ where: eq(users.id, targetId) })).toMatchObject({
      passwordHash: before!.passwordHash,
      lastAdminPasswordResetRequestId: null,
    });
    expect(await db.query.adminPasswordResetRequests.findMany()).toHaveLength(0);
  });

  it("keeps every reset route private and rejects incomplete replacement intent", async () => {
    const unauthorized = await app.inject({ method: "GET", url: stateUrl() });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.headers["cache-control"]).toBe("no-store");

    const incomplete = await reset(REQUEST_A, {
      expectedLastAppliedRequestId: null,
      supersedesRequestId: REQUEST_B,
    });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.headers["cache-control"]).toBe("no-store");
    expect(await db.query.adminPasswordResetRequests.findMany()).toHaveLength(0);
  });

  it("returns the secret once and exact receipt/replay only return the applied outcome", async () => {
    const preflight = await app.inject({
      method: "GET",
      url: stateUrl(),
      cookies: { tab10_session: adminCookie },
    });
    expect(preflight.statusCode).toBe(200);
    expect(preflight.headers["cache-control"]).toBe("no-store");
    expect(preflight.json()).toEqual({ targetUserId: targetId, lastAppliedRequestId: null });

    const first = await reset(REQUEST_A, { expectedLastAppliedRequestId: null });
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.json()).toMatchObject({
      requestId: REQUEST_A,
      outcome: "applied",
      secretAvailable: true,
      current: true,
    });
    expect(typeof first.json().temporaryPassword).toBe("string");
    const issuedSecret = first.json().temporaryPassword as string;
    expect(
      JSON.stringify({
        receipts: await db.query.adminPasswordResetRequests.findMany(),
        audits: await db.query.auditLogs.findMany({
          where: eq(auditLogs.entityId, targetId),
        }),
        notifications: await db.query.notifications.findMany({
          where: eq(notifications.userId, targetId),
        }),
        issues: await db.query.temporaryPasswordIssues.findMany({
          where: eq(temporaryPasswordIssues.userId, targetId),
        }),
      }),
    ).not.toContain(issuedSecret);

    const countsBeforeReplay = {
      issues: (await db.query.temporaryPasswordIssues.findMany({
        where: eq(temporaryPasswordIssues.userId, targetId),
      })).length,
      audits: (await db.query.auditLogs.findMany({
        where: and(eq(auditLogs.entityId, targetId), eq(auditLogs.action, "user.password_reset")),
      })).length,
      notifications: (await db.query.notifications.findMany({
        where: eq(notifications.userId, targetId),
      })).length,
    };

    const replay = await reset(REQUEST_A, { expectedLastAppliedRequestId: null });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({
      requestId: REQUEST_A,
      outcome: "applied",
      secretAvailable: false,
      current: true,
    });
    expect(replay.body).not.toContain("temporaryPassword");

    const receipt = await app.inject({
      method: "GET",
      url: receiptUrl(REQUEST_A),
      cookies: { tab10_session: adminCookie },
    });
    expect(receipt.statusCode).toBe(200);
    expect(receipt.headers["cache-control"]).toBe("no-store");
    expect(receipt.json()).toMatchObject({
      requestId: REQUEST_A,
      targetUserId: targetId,
      outcome: "applied",
      secretAvailable: false,
      current: true,
    });
    expect(receipt.body).not.toContain("temporaryPassword");
    expect({
      issues: (await db.query.temporaryPasswordIssues.findMany({
        where: eq(temporaryPasswordIssues.userId, targetId),
      })).length,
      audits: (await db.query.auditLogs.findMany({
        where: and(eq(auditLogs.entityId, targetId), eq(auditLogs.action, "user.password_reset")),
      })).length,
      notifications: (await db.query.notifications.findMany({
        where: eq(notifications.userId, targetId),
      })).length,
    }).toEqual(countsBeforeReplay);
  });

  it("rejects reuse of one request ID with a different immutable fingerprint", async () => {
    expect((await reset(REQUEST_A, { expectedLastAppliedRequestId: null })).statusCode).toBe(200);

    const reused = await reset(REQUEST_A, {
      expectedLastAppliedRequestId: REQUEST_B,
    });

    expect(reused.statusCode).toBe(409);
    expect(reused.json().code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect((await db.query.adminPasswordResetRequests.findMany())).toHaveLength(1);
  });

  it("makes a confirmed replacement authoritative in A then B order", async () => {
    expect((await reset(REQUEST_A, { expectedLastAppliedRequestId: null })).statusCode).toBe(200);

    const replacement = await reset(REQUEST_B, {
      expectedLastAppliedRequestId: null,
      supersedesRequestId: REQUEST_A,
      confirmReplacement: true,
    });

    expect(replacement.statusCode).toBe(200);
    expect(replacement.json()).toMatchObject({ requestId: REQUEST_B, outcome: "applied" });
    const state = await app.inject({ method: "GET", url: stateUrl(), cookies: { tab10_session: adminCookie } });
    expect(state.json().lastAppliedRequestId).toBe(REQUEST_B);
    const aReceipt = await app.inject({ method: "GET", url: receiptUrl(REQUEST_A), cookies: { tab10_session: adminCookie } });
    expect(aReceipt.json()).toMatchObject({ outcome: "applied", current: false });
  });

  it("makes B authoritative when it commits before delayed A", async () => {
    const replacement = await reset(REQUEST_B, {
      expectedLastAppliedRequestId: null,
      supersedesRequestId: REQUEST_A,
      confirmReplacement: true,
    });
    expect(replacement.statusCode).toBe(200);

    const delayedA = await reset(REQUEST_A, { expectedLastAppliedRequestId: null });

    expect(delayedA.statusCode).toBe(409);
    expect(delayedA.json()).toMatchObject({
      code: "RESET_STATE_CHANGED",
      requestId: REQUEST_A,
      outcome: "rejected_state_changed",
      currentLastAppliedRequestId: REQUEST_B,
    });
    expect((await app.inject({ method: "GET", url: stateUrl(), cookies: { tab10_session: adminCookie } })).json().lastAppliedRequestId).toBe(REQUEST_B);
  });

  it("keeps the A to C to B chain conflict terminal without credential writes for C", async () => {
    expect((await reset(REQUEST_A, { expectedLastAppliedRequestId: null })).statusCode).toBe(200);
    const afterA = await db.query.users.findFirst({ where: eq(users.id, targetId) });

    const c = await reset(REQUEST_C, {
      expectedLastAppliedRequestId: null,
      supersedesRequestId: REQUEST_B,
      confirmReplacement: true,
    });

    expect(c.statusCode).toBe(409);
    expect(c.json()).toMatchObject({ code: "RESET_STATE_CHANGED", outcome: "rejected_state_changed" });
    expect(await db.query.users.findFirst({ where: eq(users.id, targetId) })).toMatchObject({
      passwordHash: afterA!.passwordHash,
      lastAdminPasswordResetRequestId: REQUEST_A,
    });
    expect(await db.query.adminPasswordResetRequests.findFirst({
      where: eq(adminPasswordResetRequests.requestId, REQUEST_C),
    })).toMatchObject({ outcome: "rejected_state_changed" });

    const b = await reset(REQUEST_B, {
      expectedLastAppliedRequestId: null,
      supersedesRequestId: REQUEST_A,
      confirmReplacement: true,
    });
    expect(b.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: stateUrl(), cookies: { tab10_session: adminCookie } })).json().lastAppliedRequestId).toBe(REQUEST_B);
  });

  it("rolls back receipt, credential, sessions, issue, audit and notification on an injected notification failure", async () => {
    const before = await db.query.users.findFirst({ where: eq(users.id, targetId) });
    await db.execute(`
      CREATE OR REPLACE FUNCTION fail_password_reset_notification() RETURNS trigger AS $$
      BEGIN
        IF NEW.type = 'account_access_changed' AND NEW.payload->>'change' = 'password_reset' THEN
          RAISE EXCEPTION 'injected password reset notification failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.execute(`
      CREATE TRIGGER fail_password_reset_notification
      BEFORE INSERT ON notifications
      FOR EACH ROW EXECUTE FUNCTION fail_password_reset_notification();
    `);

    const failed = await reset(REQUEST_A, { expectedLastAppliedRequestId: null });

    expect(failed.statusCode).toBe(500);
    expect(failed.headers["cache-control"]).toBe("no-store");
    expect(await db.query.users.findFirst({ where: eq(users.id, targetId) })).toMatchObject({
      passwordHash: before!.passwordHash,
      lastAdminPasswordResetRequestId: null,
    });
    expect(await db.query.adminPasswordResetRequests.findMany()).toHaveLength(0);
    expect(await db.query.auditLogs.findMany({
      where: and(eq(auditLogs.entityId, targetId), eq(auditLogs.action, "user.password_reset")),
    })).toHaveLength(0);
    expect(await db.query.notifications.findMany({ where: eq(notifications.userId, targetId) })).toHaveLength(0);
    const receipt = await app.inject({ method: "GET", url: receiptUrl(REQUEST_A), cookies: { tab10_session: adminCookie } });
    expect(receipt.json()).toEqual({
      requestId: REQUEST_A,
      targetUserId: targetId,
      outcome: "unknown",
      secretAvailable: false,
    });
  });

  it("revokes the caller session atomically for a self reset", async () => {
    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", cookies: { tab10_session: adminCookie } });
    const adminId = me.json().user.id as string;
    targetId = adminId;

    const response = await reset(REQUEST_A, { expectedLastAppliedRequestId: null });

    expect(response.statusCode).toBe(200);
    expect(response.json().secretAvailable).toBe(true);
    const after = await app.inject({ method: "GET", url: "/api/v1/auth/me", cookies: { tab10_session: adminCookie } });
    expect(after.statusCode).toBe(401);
    expect(await db.query.authSessions.findFirst({
      where: and(eq(authSessions.userId, adminId), eq(authSessions.revokeReason, "password_reset")),
    })).toBeDefined();
  });

  it("does not expose a request belonging to another target", async () => {
    expect((await reset(REQUEST_A, { expectedLastAppliedRequestId: null })).statusCode).toBe(200);
    const other = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      cookies: { tab10_session: adminCookie },
      payload: { email: "other@reset.test", firstName: "Other", lastName: "Target" },
    });
    targetId = other.json().user.id as string;

    const receipt = await app.inject({ method: "GET", url: receiptUrl(REQUEST_A), cookies: { tab10_session: adminCookie } });

    expect(receipt.statusCode).toBe(200);
    expect(receipt.json()).toMatchObject({ outcome: "unknown", secretAvailable: false });
  });

  it("invalidates the original temporary password after the correlated reset", async () => {
    expect((await reset(REQUEST_A, { expectedLastAppliedRequestId: null })).statusCode).toBe(200);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "target@reset.test", password: originalTemporaryPassword },
    });

    expect(login.statusCode).toBe(401);
  });
});
