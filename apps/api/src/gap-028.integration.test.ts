import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { eq } from "drizzle-orm";
import { buildApp } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import { matches, users } from "./db/schema.js";
import { AdminMatchRecoveryService } from "./modules/matches/admin-match-recovery-service.js";

const ADMIN_EMAIL = "gap028-admin@example.test";
const CREATOR_EMAIL = "gap028-creator@example.test";
const PASSWORD = "Gap028Pass9!";
const MATCH_ID = "00000000-0000-4000-8000-000000002801";
const MATCH_STATUSES = [
  "waiting",
  "in_progress",
  "pending_confirmation",
  "finished",
  "stopped",
  "cancelled",
  "voided",
] as const;
const MATCH_KINDS = ["standalone", "tournament", "tutorial"] as const;

const forbiddenResponseKeys = [
  "title",
  "participants",
  "scoreA",
  "scoreB",
  "activeJudge",
  "judgeReservation",
  "eventLog",
  "invitations",
  "idempotencyKeys",
  "state",
];

function expectNoClosedMatchFacts(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const key of forbiddenResponseKeys) {
    expect(serialized).not.toContain(`\"${key}\"`);
  }
  expect(serialized).not.toContain("SECRET");
}

describe("GAP-028 exact-id admin match recovery", () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let app: Awaited<ReturnType<typeof buildApp>>["app"];
  let adminCookie: string;
  let creatorCookie: string;
  let adminUserId: string;
  let creatorUserId: string;
  const clock = new FakeClock(new Date("2026-10-03T12:00:00.000Z"));

  beforeAll(async () => {
    const context = await createMigratedPgliteDb();
    db = context.db;
    closeDb = context.close;
    const built = await buildApp({
      db,
      clock,
    });
    app = built.app;

    await built.services.auth.seedAdmin(ADMIN_EMAIL, PASSWORD);
    await built.services.auth.seedAdmin(CREATOR_EMAIL, PASSWORD);
    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: ADMIN_EMAIL, password: PASSWORD },
    });
    adminCookie = adminLogin.cookies.find(
      (cookie) => cookie.name === "tab10_session",
    )!.value;
    adminUserId = adminLogin.json().user.id as string;
    const creatorLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: CREATOR_EMAIL, password: PASSWORD },
    });
    creatorUserId = creatorLogin.json().user.id as string;
    creatorCookie = creatorLogin.cookies.find(
      (cookie) => cookie.name === "tab10_session",
    )!.value;
    await db.insert(matches).values({
      id: MATCH_ID,
      title: "SECRET title must stay closed",
      createdByUserId: creatorUserId,
      kind: "standalone",
      status: "in_progress",
      version: 4,
    });
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it("keeps ordinary D17 closed and returns only the exact recovery projection", async () => {
    const ordinary = await app.inject({
      method: "GET",
      url: `/api/v1/matches/${MATCH_ID}`,
      cookies: { tab10_session: adminCookie },
    });
    expect(ordinary.statusCode).toBe(403);

    const recovery = await app.inject({
      method: "GET",
      url: `/api/v1/admin/matches/${MATCH_ID}/recovery`,
      cookies: { tab10_session: adminCookie },
    });
    expect(recovery.statusCode).toBe(200);
    expect(recovery.headers["cache-control"]).toBe("no-store");
    expect(recovery.json()).toEqual({
      recovery: {
        id: MATCH_ID,
        kind: "standalone",
        status: "in_progress",
        version: 4,
        allowedEmergencyAction: "force_close",
      },
    });
    expectNoClosedMatchFacts(recovery.json());
  });

  it("projects every persisted kind/status combination without adding semantics", async () => {
    let index = 0;
    for (const kind of MATCH_KINDS) {
      for (const status of MATCH_STATUSES) {
        index += 1;
        const id = `00000000-0000-4000-8000-${String(2820 + index).padStart(12, "0")}`;
        await db.insert(matches).values({
          id,
          title: `SECRET matrix ${kind} ${status}`,
          createdByUserId: creatorUserId,
          kind,
          status,
          version: index,
        });
        const response = await app.inject({
          method: "GET",
          url: `/api/v1/admin/matches/${id}/recovery`,
          cookies: { tab10_session: adminCookie },
        });
        const allowed =
          kind === "standalone" &&
          (status === "waiting" ||
            status === "in_progress" ||
            status === "pending_confirmation");
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
          recovery: {
            id,
            kind,
            status,
            version: index,
            allowedEmergencyAction: allowed ? "force_close" : null,
          },
        });
        expectNoClosedMatchFacts(response.json());
      }
    }
  });

  it("rejects malformed, missing, ordinary, demoted and blocked actors without match facts", async () => {
    const malformed = await app.inject({
      method: "GET",
      url: "/api/v1/admin/matches/not-a-uuid/recovery",
      cookies: { tab10_session: adminCookie },
    });
    expect(malformed.statusCode).toBe(400);
    expectNoClosedMatchFacts(malformed.json());

    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/admin/matches/00000000-0000-4000-8000-000000009999/recovery",
      cookies: { tab10_session: adminCookie },
    });
    expect(missing.statusCode).toBe(404);
    expectNoClosedMatchFacts(missing.json());

    await db.update(users).set({ role: "user" }).where(eq(users.id, creatorUserId));
    const demoted = await app.inject({
      method: "GET",
      url: `/api/v1/admin/matches/${MATCH_ID}/recovery`,
      cookies: { tab10_session: creatorCookie },
    });
    expect(demoted.statusCode).toBe(403);
    expectNoClosedMatchFacts(demoted.json());
    await db.update(users).set({ role: "admin" }).where(eq(users.id, creatorUserId));

    await db.update(users).set({ status: "blocked" }).where(eq(users.id, adminUserId));
    const blocked = await app.inject({
      method: "GET",
      url: `/api/v1/admin/matches/${MATCH_ID}/recovery`,
      cookies: { tab10_session: adminCookie },
    });
    expect(blocked.statusCode).toBe(401);
    expectNoClosedMatchFacts(blocked.json());
    await db.update(users).set({ status: "active" }).where(eq(users.id, adminUserId));
  });

  it("revalidates active admin inside the mutation transaction even for the creator", async () => {
    const id = "00000000-0000-4000-8000-000000002860";
    await db.insert(matches).values({
      id,
      title: "SECRET creator-owned",
      createdByUserId: creatorUserId,
      kind: "standalone",
      status: "waiting",
      version: 0,
    });
    await db.update(users).set({ role: "user" }).where(eq(users.id, creatorUserId));
    const service = new AdminMatchRecoveryService(db, clock);
    await expect(
      service.forceClose({
        matchId: id,
        actorAdminId: creatorUserId,
        expectedVersion: 0,
        idempotencyKey: "00000000-0000-4000-8000-000000002860",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const unchanged = await db.query.matches.findFirst({ where: eq(matches.id, id) });
    expect(unchanged).toMatchObject({ status: "waiting", version: 0 });
    await db.update(users).set({ role: "admin" }).where(eq(users.id, creatorUserId));
  });

  it("returns a narrow success and preserves terminal same-key replay", async () => {
    const id = "00000000-0000-4000-8000-000000002870";
    const key = "00000000-0000-4000-8000-000000002871";
    await db.insert(matches).values({
      id,
      title: "SECRET force close",
      createdByUserId: creatorUserId,
      kind: "standalone",
      status: "in_progress",
      version: 6,
    });
    const request = () => app.inject({
      method: "POST",
      url: `/api/v1/admin/matches/${id}/recovery/force-close`,
      cookies: { tab10_session: adminCookie },
      headers: { "idempotency-key": key },
      payload: { expectedVersion: 6 },
    });
    const first = await request();
    const replay = await request();
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(first.json()).toEqual(replay.json());
    expect(first.json()).toEqual({
      recovery: {
        id,
        kind: "standalone",
        status: "cancelled",
        version: 7,
        allowedEmergencyAction: null,
      },
    });
    expectNoClosedMatchFacts(first.json());
  });

  it("redacts stale and ineligible failures and applies different-key races once", async () => {
    const staleId = "00000000-0000-4000-8000-000000002880";
    await db.insert(matches).values({
      id: staleId,
      title: "SECRET stale",
      createdByUserId: creatorUserId,
      kind: "standalone",
      status: "waiting",
      version: 2,
    });
    const stale = await app.inject({
      method: "POST",
      url: `/api/v1/admin/matches/${staleId}/recovery/force-close`,
      cookies: { tab10_session: adminCookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000002881" },
      payload: { expectedVersion: 1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(Object.keys(stale.json()).sort()).toEqual(["code", "message", "requestId"]);
    expectNoClosedMatchFacts(stale.json());

    const tournamentId = "00000000-0000-4000-8000-000000002882";
    await db.insert(matches).values({
      id: tournamentId,
      title: "SECRET tournament",
      createdByUserId: creatorUserId,
      kind: "tournament",
      status: "waiting",
      version: 0,
    });
    const ineligible = await app.inject({
      method: "POST",
      url: `/api/v1/admin/matches/${tournamentId}/recovery/force-close`,
      cookies: { tab10_session: adminCookie },
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000002883" },
      payload: { expectedVersion: 0 },
    });
    expect(ineligible.statusCode).toBe(400);
    expectNoClosedMatchFacts(ineligible.json());

    const raceId = "00000000-0000-4000-8000-000000002884";
    await db.insert(matches).values({
      id: raceId,
      title: "SECRET race",
      createdByUserId: creatorUserId,
      kind: "standalone",
      status: "waiting",
      version: 0,
    });
    const [left, right] = await Promise.all([
      "00000000-0000-4000-8000-000000002885",
      "00000000-0000-4000-8000-000000002886",
    ].map((key) => app.inject({
      method: "POST",
      url: `/api/v1/admin/matches/${raceId}/recovery/force-close`,
      cookies: { tab10_session: adminCookie },
      headers: { "idempotency-key": key },
      payload: { expectedVersion: 0 },
    })));
    expect([left.statusCode, right.statusCode].sort()).toEqual([200, 409]);
    expectNoClosedMatchFacts(left.json());
    expectNoClosedMatchFacts(right.json());
    const raced = await db.query.matches.findFirst({ where: eq(matches.id, raceId) });
    expect(raced).toMatchObject({ status: "cancelled", version: 1 });
  });
});
