import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import { authSessions, auditLogs, temporaryPasswordIssues, users } from "./db/schema.js";
import { hashToken } from "./modules/auth/auth-service.js";

describe("GAP-010 admin user catalog and edit", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let db: Db;
  let close: () => Promise<void>;
  let adminCookie: string;
  const targetId = "00000000-0000-4000-8000-000000001010";
  const targetToken = "gap010-target-token";

  beforeEach(async () => {
    const context = await createMigratedPgliteDb();
    db = context.db;
    close = context.close;
    const built = await buildApp({
      db,
      clock: new FakeClock(new Date("2026-09-13T12:00:00Z")),
    });
    app = built.app;
    services = built.services;
    await services.auth.seedAdmin("admin@tab10.local", "AdminPass1!");
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@tab10.local", password: "AdminPass1!" },
    });
    adminCookie = login.cookies.find((cookie) => cookie.name === "tab10_session")!.value;
    await db.insert(users).values({
      id: targetId,
      email: "needle@tab10.local",
      passwordHash: "not-used",
      firstName: "Иван",
      lastName: "Искомый",
      birthDate: "1990-02-03",
      organizationText: "Депо",
      positionText: "Инженер",
      status: "blocked",
      blockedAt: new Date("2026-09-12T12:00:00Z"),
      createdAt: new Date("2026-01-02T03:04:05Z"),
      lastLoginAt: new Date("2026-09-01T10:11:12Z"),
      mustChangePassword: false,
    });
    await db.insert(authSessions).values({
      userId: targetId,
      tokenHash: hashToken(targetToken),
      expiresAt: new Date("2026-09-20T12:00:00Z"),
    });
  });

  afterEach(async () => {
    await app.close();
    await close();
  });

  it("ADM-002 returns filtered safe profile DTOs and validates the query", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/users?q=NEEDLE&status=blocked",
      cookies: { tab10_session: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().users).toEqual([
      expect.objectContaining({
        id: targetId,
        email: "needle@tab10.local",
        status: "blocked",
        birthDate: "1990-02-03",
        organizationText: "Депо",
        positionText: "Инженер",
        createdAt: "2026-01-02T03:04:05.000Z",
        lastLoginAt: "2026-09-01T10:11:12.000Z",
      }),
    ]);
    expect(response.json().users[0]).not.toHaveProperty("passwordHash");
    expect(response.json().users[0]).not.toHaveProperty("uploadedAvatarPath");

    for (const url of [
      "/api/v1/admin/users?status=pending",
      "/api/v1/admin/users?unknown=value",
    ]) {
      const invalid = await app.inject({
        method: "GET",
        url,
        cookies: { tab10_session: adminCookie },
      });
      expect(invalid.statusCode, url).toBe(400);
      expect(invalid.json().code).toBe("VALIDATION");
    }
  });

  it("ADM-004/008 preserves sessions for profile edits and revokes them for role changes", async () => {
    const profile = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/users/${targetId}`,
      cookies: { tab10_session: adminCookie },
      payload: {
        firstName: "Пётр",
        birthDate: null,
        organizationText: null,
        positionText: "Мастер",
      },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().user).toMatchObject({
      firstName: "Пётр",
      birthDate: null,
      organizationText: null,
      positionText: "Мастер",
    });
    expect(
      await db.query.authSessions.findFirst({
        where: and(eq(authSessions.userId, targetId), isNull(authSessions.revokedAt)),
      }),
    ).toBeDefined();

    const combined = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/users/${targetId}`,
      cookies: { tab10_session: adminCookie },
      payload: { lastName: "Обновлённый", role: "admin" },
    });
    expect(combined.statusCode).toBe(200);
    expect(combined.json().user).toMatchObject({
      lastName: "Обновлённый",
      role: "admin",
    });
    expect(
      await db.query.authSessions.findFirst({
        where: and(eq(authSessions.userId, targetId), isNull(authSessions.revokedAt)),
      }),
    ).toBeUndefined();
    const actions = (
      await db.query.auditLogs.findMany({ where: eq(auditLogs.entityId, targetId) })
    ).map((row) => row.action);
    expect(actions).toEqual(["user.updated", "user.role_changed"]);
    const combinedAudit = await db.query.auditLogs.findFirst({ where: and(eq(auditLogs.entityId, targetId), eq(auditLogs.action, "user.role_changed")) });
    expect(combinedAudit?.meta).toMatchObject({ changedFields: expect.arrayContaining(["lastName", "role"]) });
  });

  it("ADM-008 rolls back a combined edit and session revocation when audit persistence fails", async () => {
    await db.execute(`create or replace function gap010_fail_audit() returns trigger language plpgsql as $$ begin if NEW.action = 'user.role_changed' then raise exception 'injected'; end if; return NEW; end; $$`);
    await db.execute(`create trigger gap010_fail_audit before insert on audit_logs for each row execute function gap010_fail_audit()`);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/users/${targetId}`,
      cookies: { tab10_session: adminCookie },
      payload: { firstName: "Не сохранится", role: "admin" },
    });
    expect(response.statusCode).toBe(500);
    expect(await db.query.users.findFirst({ where: eq(users.id, targetId) })).toMatchObject({
      firstName: "Иван",
      role: "user",
    });
    expect(
      await db.query.authSessions.findFirst({
        where: and(eq(authSessions.userId, targetId), isNull(authSessions.revokedAt)),
      }),
    ).toBeDefined();
    expect(
      await db.query.auditLogs.findMany({ where: eq(auditLogs.entityId, targetId) }),
    ).toHaveLength(0);
  });

  it("ADM-003/004 rejects non-admin edits, empty bodies, immutable email and invalid profile fields", async () => {
    await db.update(users).set({ status: "active", blockedAt: null }).where(eq(users.id, targetId));
    const forbidden = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/users/${targetId}`,
      cookies: { tab10_session: targetToken },
      payload: { firstName: "Нет" },
    });
    expect(forbidden.statusCode).toBe(403);

    for (const payload of [
      {},
      { email: "changed@tab10.local" },
      { firstName: "" },
      { birthDate: "2026-02-30" },
      { organizationText: "x".repeat(201) },
    ]) {
      const invalid = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${targetId}`,
        cookies: { tab10_session: adminCookie },
        payload,
      });
      expect(invalid.statusCode, JSON.stringify(payload)).toBe(400);
      expect(invalid.json().code).toBe("VALIDATION");
    }
  });

  it.each(["unblock", "reset"] as const)(
    "ADM-004 rejects a stale demoted admin before %s mutates the target",
    async (operation) => {
      const actor = await db.query.users.findFirst({
        where: eq(users.email, "admin@tab10.local"),
      });
      await db
        .update(users)
        .set({ role: "user" })
        .where(eq(users.id, actor!.id));

      const call = operation === "unblock"
        ? services.auth.unblockUser(actor!.id, targetId)
        : services.auth.resetPassword(actor!.id, targetId);
      await expect(call).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(
        await db.query.users.findFirst({ where: eq(users.id, targetId) }),
      ).toMatchObject({
        status: "blocked",
        mustChangePassword: false,
      });
      expect(
        await db.query.authSessions.findFirst({
          where: and(eq(authSessions.userId, targetId), isNull(authSessions.revokedAt)),
        }),
      ).toBeDefined();
      expect(
        await db.query.temporaryPasswordIssues.findMany({
          where: eq(temporaryPasswordIssues.userId, targetId),
        }),
      ).toHaveLength(0);
      expect(
        await db.query.auditLogs.findMany({ where: eq(auditLogs.entityId, targetId) }),
      ).toHaveLength(0);
    },
  );
});
