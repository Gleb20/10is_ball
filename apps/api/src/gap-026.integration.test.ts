import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import { auditLogs, authSessions, users } from "./db/schema.js";
import { hashToken } from "./modules/auth/auth-service.js";

describe("GAP-026 admin account detail and safe audit", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let db: Db;
  let close: () => Promise<void>;
  let adminCookie: string;
  let adminId: string;
  const targetId = "00000000-0000-4000-8000-000000002600";
  const otherTargetId = "00000000-0000-4000-8000-000000002601";
  const ordinaryToken = "gap026-ordinary-token";

  beforeEach(async () => {
    const context = await createMigratedPgliteDb();
    db = context.db;
    close = context.close;
    const built = await buildApp({
      db,
      clock: new FakeClock(new Date("2026-09-18T12:00:00.000Z")),
    });
    app = built.app;
    services = built.services;
    await services.auth.seedAdmin("admin@tab10.local", "AdminPass1!");
    const admin = await db.query.users.findFirst({
      where: eq(users.email, "admin@tab10.local"),
    });
    adminId = admin!.id;
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@tab10.local", password: "AdminPass1!" },
    });
    adminCookie = login.cookies.find((cookie) => cookie.name === "tab10_session")!.value;
    await db.insert(users).values([
      {
        id: targetId,
        email: "target@tab10.local",
        passwordHash: "not-used",
        firstName: "Текущий",
        lastName: "Пользователь",
        role: "user",
        status: "active",
        mustChangePassword: false,
        birthDate: "1990-02-03",
        organizationText: "Клуб",
        positionText: "Тренер",
        createdAt: new Date("2026-01-02T03:04:05.000Z"),
        lastLoginAt: new Date("2026-09-01T10:11:12.000Z"),
      },
      {
        id: otherTargetId,
        email: "other@tab10.local",
        passwordHash: "not-used",
        firstName: "Другой",
        lastName: "Пользователь",
        role: "user",
        status: "active",
        mustChangePassword: false,
      },
    ]);
    await db.insert(authSessions).values({
      userId: targetId,
      tokenHash: hashToken(ordinaryToken),
      expiresAt: new Date("2026-09-25T12:00:00.000Z"),
    });
  });

  afterEach(async () => {
    await app.close();
    await close();
  });

  it("returns the existing AdminUser allowlist and no persistence secrets", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/users/${targetId}`,
      cookies: { tab10_session: adminCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toEqual({
      id: targetId,
      email: "target@tab10.local",
      role: "user",
      status: "active",
      firstName: "Текущий",
      lastName: "Пользователь",
      mustChangePassword: false,
      avatarKey: null,
      onboardingStep: 0,
      onboardingCompletedAt: null,
      birthDate: "1990-02-03",
      organizationText: "Клуб",
      positionText: "Тренер",
      createdAt: "2026-01-02T03:04:05.000Z",
      lastLoginAt: "2026-09-01T10:11:12.000Z",
    });
    for (const forbidden of ["passwordHash", "uploadedAvatarPath", "blockedAt", "updatedAt"]) {
      expect(response.json().user).not.toHaveProperty(forbidden);
    }
  });

  it("returns only allowlisted audit actions and field names using current actor labels", async () => {
    const at = new Date("2026-09-18T10:00:00.000Z");
    await db.insert(auditLogs).values([
      {
        id: "00000000-0000-4000-8000-000000002611",
        actorUserId: adminId,
        action: "user.updated",
        entityType: "user",
        entityId: targetId,
        meta: {
          changedFields: ["firstName", "role", "passwordHash", "sessionToken", "unknownField"],
          password: "never-return-this",
          token: "never-return-this-either",
        },
        createdAt: at,
      },
      {
        id: "00000000-0000-4000-8000-000000002612",
        actorUserId: null,
        action: "admin.bootstrap_provisioned",
        entityType: "user",
        entityId: targetId,
        meta: { source: "secret-internal-source" },
        createdAt: at,
      },
      {
        id: "00000000-0000-4000-8000-000000002613",
        actorUserId: adminId,
        action: "user.internal_secret_rotated",
        entityType: "user",
        entityId: targetId,
        meta: { secret: "must-not-leak" },
        createdAt: at,
      },
      {
        id: "00000000-0000-4000-8000-000000002614",
        actorUserId: adminId,
        action: "user.blocked",
        entityType: "user",
        entityId: otherTargetId,
        meta: { passwordHash: "must-not-leak" },
        createdAt: at,
      },
    ]);
    await db
      .update(users)
      .set({ firstName: "Нынешний", lastName: "Администратор" })
      .where(eq(users.id, adminId));

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/users/${targetId}/audit`,
      cookies: { tab10_session: adminCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: "00000000-0000-4000-8000-000000002612",
          createdAt: "2026-09-18T10:00:00.000Z",
          actor: null,
          action: "admin.bootstrap_provisioned",
          changedFields: [],
        },
        {
          id: "00000000-0000-4000-8000-000000002611",
          createdAt: "2026-09-18T10:00:00.000Z",
          actor: {
            id: adminId,
            displayName: "Администратор Нынешний",
          },
          action: "user.updated",
          changedFields: ["firstName", "role"],
        },
      ],
      nextCursor: null,
    });
    expect(JSON.stringify(response.json())).not.toContain("never-return");
    expect(JSON.stringify(response.json())).not.toContain("secret-internal");
    expect(JSON.stringify(response.json())).not.toContain("passwordHash");
  });

  it("paginates 20 rows with a target-bound (createdAt,id) keyset", async () => {
    const rowIds = Array.from({ length: 22 }, (_, index) =>
      `00000000-0000-4000-8000-${String(2700 + index).padStart(12, "0")}`,
    );
    for (const id of rowIds) {
      await db.execute(sql`
        insert into audit_logs (id, actor_user_id, action, entity_type, entity_id, meta, created_at)
        values (
          ${id}, ${adminId}, 'user.updated', 'user', ${targetId},
          ${JSON.stringify({ changedFields: ["firstName"] })}::jsonb,
          ${"2026-09-18T10:00:00.123456+00:00"}::timestamptz
        )
      `);
    }

    const first = await app.inject({
      method: "GET",
      url: `/api/v1/admin/users/${targetId}/audit`,
      cookies: { tab10_session: adminCookie },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(20);
    expect(first.json().nextCursor).toEqual(expect.any(String));

    await db.insert(auditLogs).values({
      id: "00000000-0000-4000-8000-000000002799",
      actorUserId: adminId,
      action: "user.blocked",
      entityType: "user",
      entityId: targetId,
      createdAt: new Date("2026-09-18T12:00:00.000Z"),
    });
    const second = await app.inject({
      method: "GET",
      url: `/api/v1/admin/users/${targetId}/audit?cursor=${encodeURIComponent(first.json().nextCursor)}`,
      cookies: { tab10_session: adminCookie },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().items).toHaveLength(2);
    expect(second.json().nextCursor).toBeNull();
    const firstIds = first.json().items.map((item: { id: string }) => item.id);
    const secondIds = second.json().items.map((item: { id: string }) => item.id);
    expect(firstIds).toEqual([...rowIds].reverse().slice(0, 20));
    expect(secondIds).toEqual([...rowIds].reverse().slice(20));
    expect(new Set([...firstIds, ...secondIds]).size).toBe(22);

    const wrongTarget = await app.inject({
      method: "GET",
      url: `/api/v1/admin/users/${otherTargetId}/audit?cursor=${encodeURIComponent(first.json().nextCursor)}`,
      cookies: { tab10_session: adminCookie },
    });
    expect(wrongTarget.statusCode).toBe(400);
    expect(wrongTarget.json().code).toBe("VALIDATION");
  });

  it("fails closed for non-admin, demoted admin, absent targets and malformed cursors", async () => {
    const ordinary = await app.inject({
      method: "GET",
      url: `/api/v1/admin/users/${targetId}/audit`,
      cookies: { tab10_session: ordinaryToken },
    });
    expect(ordinary.statusCode).toBe(403);

    await db.update(users).set({ role: "user" }).where(eq(users.id, adminId));
    const demoted = await app.inject({
      method: "GET",
      url: `/api/v1/admin/users/${targetId}`,
      cookies: { tab10_session: adminCookie },
    });
    expect(demoted.statusCode).toBe(403);

    await db.update(users).set({ role: "admin" }).where(eq(users.id, adminId));
    await db
      .update(users)
      .set({ role: "admin", status: "blocked" })
      .where(eq(users.id, adminId));
    const blocked = await app.inject({
      method: "GET",
      url: `/api/v1/admin/users/${targetId}`,
      cookies: { tab10_session: adminCookie },
    });
    expect(blocked.statusCode).toBe(401);

    await db
      .update(users)
      .set({ status: "active" })
      .where(eq(users.id, adminId));
    const absent = await app.inject({
      method: "GET",
      url: "/api/v1/admin/users/00000000-0000-4000-8000-000000002699",
      cookies: { tab10_session: adminCookie },
    });
    expect(absent.statusCode).toBe(404);

    const malformed = await app.inject({
      method: "GET",
      url: `/api/v1/admin/users/${targetId}/audit?cursor=not-a-cursor`,
      cookies: { tab10_session: adminCookie },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().code).toBe("VALIDATION");
  });
});
