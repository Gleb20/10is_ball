import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { users } from "./db/schema.js";
import { createPgliteDb } from "./db/client.js";
import { buildApp } from "./app.js";
import type { FastifyInstance } from "fastify";
import type { AppServices } from "./app.js";

describe("API_GET_health__ok", () => {
  let app: FastifyInstance;
  let close: () => Promise<void>;

  beforeEach(async () => {
    const ctx = await createPgliteDb();
    close = ctx.close;
    const built = await buildApp({ db: ctx.db, clock: new FakeClock() });
    app = built.app;
  });

  afterEach(async () => {
    if (app) await app.close();
    if (close) await close();
  });

  it("returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });
});

describe("auth and admin integration", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let close: () => Promise<void>;
  let clock: FakeClock;

  beforeEach(async () => {
    const ctx = await createPgliteDb();
    close = ctx.close;
    clock = new FakeClock();
    const built = await buildApp({ db: ctx.db, clock });
    app = built.app;
    services = built.services;
    await services.auth.seedAdmin("admin@tab10.local", "AdminPass1!");
  });

  afterEach(async () => {
    if (app) await app.close();
    if (close) await close();
  });

  async function loginAsAdmin() {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@tab10.local", password: "AdminPass1!" },
    });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === "tab10_session");
    return cookie?.value as string;
  }

  it("API_POST_auth_login__invalid_credentials", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@tab10.local", password: "wrong" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("INVALID_CREDENTIALS");
  });

  it("API_POST_admin_users__returns_temp_password_once", async () => {
    const token = await loginAsAdmin();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      cookies: { tab10_session: token },
      payload: {
        email: "Player@X.test",
        firstName: "Иван",
        lastName: "Иванов",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.temporaryPassword).toBeTruthy();
    expect(body.user.email).toBe("player@x.test");
    expect(body.user.mustChangePassword).toBe(true);

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      cookies: { tab10_session: token },
      payload: {
        email: "user@x.test",
        firstName: "A",
        lastName: "B",
      },
    });
    expect(first.statusCode).toBe(200);

    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      cookies: { tab10_session: token },
      payload: {
        email: "User@x.test",
        firstName: "A",
        lastName: "B",
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("EMAIL_TAKEN");
  });

  it("API_POST_auth_password_first_change__one_time_temp", async () => {
    const adminToken = await loginAsAdmin();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      cookies: { tab10_session: adminToken },
      payload: {
        email: "new@tab10.local",
        firstName: "New",
        lastName: "User",
      },
    });
    const temp = created.json().temporaryPassword as string;

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "new@tab10.local", password: temp },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.mustChangePassword).toBe(true);
    const userCookie = login.cookies.find((c) => c.name === "tab10_session")!
      .value;

    const homeBlocked = await app.inject({
      method: "GET",
      url: "/api/v1/home",
      cookies: { tab10_session: userCookie },
    });
    expect(homeBlocked.statusCode).toBe(403);
    expect(homeBlocked.json().code).toBe("PASSWORD_CHANGE_REQUIRED");

    const change = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/first-change",
      cookies: { tab10_session: userCookie },
      payload: { newPassword: "NewPass12!" },
    });
    expect(change.statusCode).toBe(200);

    const oldLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "new@tab10.local", password: temp },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "new@tab10.local", password: "NewPass12!" },
    });
    expect(newLogin.statusCode).toBe(200);
    expect(newLogin.json().user.mustChangePassword).toBe(false);
  });

  it("INT_admin__block_revokes_sessions and last admin guard", async () => {
    const adminToken = await loginAsAdmin();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      cookies: { tab10_session: adminToken },
      payload: {
        email: "blockme@tab10.local",
        firstName: "Block",
        lastName: "Me",
      },
    });
    const temp = created.json().temporaryPassword as string;
    const userId = created.json().user.id as string;

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "blockme@tab10.local", password: temp },
    });
    const userCookie = login.cookies.find((c) => c.name === "tab10_session")!
      .value;

    await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/first-change",
      cookies: { tab10_session: userCookie },
      payload: { newPassword: "BlockPass1!" },
    });

    const login2 = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "blockme@tab10.local", password: "BlockPass1!" },
    });
    const sessionCookie = login2.cookies.find(
      (c) => c.name === "tab10_session",
    )!.value;

    const block = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${userId}/block`,
      cookies: { tab10_session: adminToken },
    });
    expect(block.statusCode).toBe(200);

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      cookies: { tab10_session: sessionCookie },
    });
    expect(me.statusCode).toBe(401);

    const adminUser = await services.auth.listUsers();
    const admin = adminUser.find((u: typeof users.$inferSelect) => u.email === "admin@tab10.local")!;
    const last = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${admin.id}/block`,
      cookies: { tab10_session: adminToken },
    });
    expect(last.statusCode).toBe(409);
    expect(last.json().code).toBe("LAST_ADMIN");
  });

  it("INT_auth__session_sliding_ttl_7d", async () => {
    const token = await loginAsAdmin();
    clock.advanceMs(6 * 24 * 60 * 60 * 1000);
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      cookies: { tab10_session: token },
    });
    expect(me.statusCode).toBe(200);
    // No activity for 8 days after last slide → expired
    clock.advanceMs(8 * 24 * 60 * 60 * 1000);
    const expired = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      cookies: { tab10_session: token },
    });
    expect(expired.statusCode).toBe(401);
  });

  it("API_GET_users_directory__lists_active_excludes_self", async () => {
    const adminToken = await loginAsAdmin();
    await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      cookies: { tab10_session: adminToken },
      payload: {
        email: "picker@tab10.local",
        firstName: "Pick",
        lastName: "Er",
      },
    });
    const dir = await app.inject({
      method: "GET",
      url: "/api/v1/users/directory",
      cookies: { tab10_session: adminToken },
    });
    expect(dir.statusCode).toBe(200);
    const users = dir.json().users as Array<{
      id: string;
      displayName: string;
      email?: string;
    }>;
    expect(users.some((u) => u.displayName.includes("Er"))).toBe(true);
    expect(users.every((u) => !("email" in u && u.email))).toBe(true);
    const adminMe = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      cookies: { tab10_session: adminToken },
    });
    const adminId = adminMe.json().user.id as string;
    expect(users.every((u) => u.id !== adminId)).toBe(true);
  });
});
