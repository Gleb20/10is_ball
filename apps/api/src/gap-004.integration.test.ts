import { FakeClock } from "@tab10/test-utils";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import {
  teamMemberships,
  teams,
  users,
  userStats,
} from "./db/schema.js";

describe("GAP-004 complete ranking slice", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let db: Db;
  let close: () => Promise<void>;
  let admin: { id: string; cookie: string };
  let anna: { id: string; cookie: string };
  let boris: { id: string; cookie: string };
  let blockedId: string;
  const teamId = "11111111-1111-4111-8111-111111111111";

  beforeEach(async () => {
    const ctx = await createMigratedPgliteDb();
    db = ctx.db;
    close = ctx.close;
    const built = await buildApp({
      db,
      clock: new FakeClock(new Date("2026-09-07T10:00:00.000Z")),
    });
    app = built.app;
    services = built.services;

    const seeded = await services.auth.seedAdmin(
      "admin@gap-004.local",
      "AdminPass1!",
    );
    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@gap-004.local", password: "AdminPass1!" },
    });
    admin = {
      id: seeded.user.id,
      cookie: adminLogin.cookies.find((c) => c.name === "tab10_session")!.value,
    };
    anna = await createActiveUser("anna", "Анна", "Смирнова");
    boris = await createActiveUser("boris", "Борис", "Иванов");
    const blocked = await services.auth.createUser({
      email: "blocked@gap-004.local",
      firstName: "Блок",
      lastName: "Игрок",
      role: "user",
      issuedByAdminId: admin.id,
    });
    blockedId = blocked.user.id;
    await db.update(users).set({ status: "blocked" }).where(eq(users.id, blockedId));

    await db.insert(teams).values({
      id: teamId,
      name: "Ракетки",
      slug: "raketki-gap-004",
      captainUserId: admin.id,
      status: "active",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await db.insert(teamMemberships).values([
      {
        teamId,
        userId: admin.id,
        joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        teamId,
        userId: anna.id,
        joinedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      {
        teamId,
        userId: blockedId,
        joinedAt: new Date("2026-01-03T00:00:00.000Z"),
      },
      {
        teamId,
        userId: boris.id,
        joinedAt: new Date("2026-01-04T00:00:00.000Z"),
        leftAt: new Date("2026-02-01T00:00:00.000Z"),
        leaveReason: "left",
      },
    ]);
    await db.insert(userStats).values([
      { userId: admin.id, winsAllTime: 2, lossesAllTime: 1 },
      { userId: anna.id, winsAllTime: 5, lossesAllTime: 2 },
      { userId: boris.id, winsAllTime: 20, lossesAllTime: 1 },
      { userId: blockedId, winsAllTime: 99, lossesAllTime: 0 },
    ]);
  });

  afterEach(async () => {
    await app.close();
    await close();
  });

  async function createActiveUser(label: string, firstName: string, lastName: string) {
    const email = `${label}@gap-004.local`;
    const created = await services.auth.createUser({
      email,
      firstName,
      lastName,
      role: "user",
      issuedByAdminId: admin.id,
    });
    const temporaryLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: created.temporaryPassword },
    });
    const temporaryCookie = temporaryLogin.cookies.find(
      (c) => c.name === "tab10_session",
    )!.value;
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/first-change",
      cookies: { tab10_session: temporaryCookie },
      payload: { newPassword: "UserPass1!" },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: "UserPass1!" },
    });
    return {
      id: created.user.id,
      cookie: login.cookies.find((c) => c.name === "tab10_session")!.value,
    };
  }

  it("RANK-002/004 + D3/Q2: filters to current active teammates and returns the all-time team aggregate", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/rankings?scope=all_time&teamId=${teamId}`,
      cookies: { tab10_session: admin.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      scope: "all_time",
      team: {
        id: teamId,
        name: "Ракетки",
        activeMemberCount: 2,
        winsAllTime: 7,
      },
      availableTeams: [{ id: teamId, name: "Ракетки" }],
    });
    expect(
      response.json().rankings.map((entry: { userId: string }) => entry.userId),
    ).toEqual([anna.id, admin.id]);
  });

  it("RANK-004: rejects arbitrary team access and malformed ranking queries without leaking a team", async () => {
    await expect(
      services.rankings.list({
        actorUserId: boris.id,
        scope: "all_time",
        teamId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const outsider = await app.inject({
      method: "GET",
      url: `/api/v1/rankings?teamId=${teamId}`,
      cookies: { tab10_session: boris.cookie },
    });
    expect(outsider.statusCode, JSON.stringify(outsider.json())).toBe(404);
    expect(outsider.json().code).toBe("NOT_FOUND");

    const invalidScope = await app.inject({
      method: "GET",
      url: "/api/v1/rankings?scope=quarter",
      cookies: { tab10_session: admin.cookie },
    });
    expect(invalidScope.statusCode).toBe(400);
    expect(invalidScope.json().code).toBe("VALIDATION");

    const invalidTeam = await app.inject({
      method: "GET",
      url: "/api/v1/rankings?teamId=not-a-uuid",
      cookies: { tab10_session: admin.cookie },
    });
    expect(invalidTeam.statusCode).toBe(400);
    expect(invalidTeam.json().code).toBe("VALIDATION");

    const unknownField = await app.inject({
      method: "GET",
      url: "/api/v1/rankings?unexpected=1",
      cookies: { tab10_session: admin.cookie },
    });
    expect(unknownField.statusCode).toBe(400);
    expect(unknownField.json().code).toBe("VALIDATION");
  });

});
