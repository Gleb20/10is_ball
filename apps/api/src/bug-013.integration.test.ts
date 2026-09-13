import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import { notifications, users } from "./db/schema.js";

const ADMIN_EMAIL = "admin@bug-013.test";
const ADMIN_PASSWORD = "AdminPass1!";
const VIEWER_ID = "00000000-0000-4000-8000-000000000131";

describe("BUG-013 notification read and timestamp semantics", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let db: Db;
  let clock: FakeClock;
  let close: () => Promise<void>;
  let adminId: string;
  let adminCookie: string;

  beforeEach(async () => {
    const context = await createMigratedPgliteDb();
    db = context.db;
    close = context.close;
    clock = new FakeClock(new Date("2026-09-07T12:00:00.000Z"));
    const built = await buildApp({ db, clock });
    app = built.app;
    services = built.services;

    const admin = await services.auth.seedAdmin(ADMIN_EMAIL, ADMIN_PASSWORD);
    adminId = admin.user.id;
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    adminCookie = login.cookies.find(
      (cookie) => cookie.name === "tab10_session",
    )!.value;

    await db.insert(users).values({
      id: VIEWER_ID,
      email: "viewer@bug-013.test",
      passwordHash: "synthetic-hash",
      firstName: "Viewer",
      lastName: "Test",
      mustChangePassword: false,
    });
  });

  afterEach(async () => {
    await app.close();
    await close();
  });

  it("AT-NOTIF-004: a single read uses the injected clock and is idempotent", async () => {
    const created = await services.notifications.create({
      userId: adminId,
      type: "captain_assigned",
      title: "Вы капитан",
      body: "Команда передана вам",
    });

    await services.notifications.markRead(adminId, created!.id);
    const firstReadAt = (await db.query.notifications.findFirst())!.readAt;
    expect(firstReadAt).toEqual(clock.now());

    clock.advanceMs(60_000);
    await services.notifications.markRead(adminId, created!.id);
    expect((await db.query.notifications.findFirst())!.readAt).toEqual(
      firstReadAt,
    );
  });

  it("AT-NOTIF-004: read-visible marks only owned visible rows and creates no events", async () => {
    const [visible, hidden, foreign] = await db
      .insert(notifications)
      .values([
        {
          userId: adminId,
          type: "captain_assigned",
          title: "Visible",
          body: "Visible body",
          createdAt: new Date("2026-09-07T11:57:00.000Z"),
        },
        {
          userId: adminId,
          type: "tournament_finished",
          title: "Hidden",
          body: "Hidden body",
          createdAt: new Date("2026-09-07T11:58:00.000Z"),
        },
        {
          userId: VIEWER_ID,
          type: "captain_assigned",
          title: "Foreign",
          body: "Foreign body",
          createdAt: new Date("2026-09-07T11:59:00.000Z"),
        },
      ])
      .returning();

    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/read-visible",
      payload: { notificationIds: [visible!.id] },
    });
    expect(unauthorized.statusCode).toBe(401);

    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/read-visible",
      cookies: { tab10_session: adminCookie },
      payload: { notificationIds: [] },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "VALIDATION" });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/read-visible",
      cookies: { tab10_session: adminCookie },
      payload: { notificationIds: [visible!.id, foreign!.id] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      updated: 1,
      notifications: [
        { id: visible!.id, readAt: clock.now().toISOString() },
      ],
    });
    const rows = await db.query.notifications.findMany();
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.id === visible!.id)?.readAt).toEqual(
      clock.now(),
    );
    expect(rows.find((row) => row.id === hidden!.id)?.readAt).toBeNull();
    expect(rows.find((row) => row.id === foreign!.id)?.readAt).toBeNull();
  });

  it("AT-NOTIF-002/003/005: expired and cancelled invitations expose terminal reason timestamps", async () => {
    const team = await services.teams.create({
      name: "BUG-013 team",
      captainUserId: adminId,
    });
    await services.teams.invite({
      teamId: team!.id,
      invitedUserId: VIEWER_ID,
      invitedByUserId: adminId,
    });
    clock.advanceMs(14 * 24 * 60 * 60 * 1000);

    const [expired] = await services.notifications.list(VIEWER_ID);
    expect(expired).toMatchObject({
      lifecycle: "expired",
      actionable: false,
      reasonCode: "timeout",
      lifecycleAt: clock.now(),
    });
    expect(await services.notifications.unreadCount(VIEWER_ID)).toBe(0);

    const tournament = await services.tournaments.create({
      title: "BUG-013 revoked invitation",
      format: "single_elimination",
      createdByUserId: adminId,
      organizerParticipates: false,
    });
    await services.tournaments.invite({
      tournamentId: tournament!.id,
      invitedUserId: VIEWER_ID,
      invitedByUserId: adminId,
    });
    clock.advanceMs(60_000);
    await services.tournaments.cancel(tournament!.id, adminId);

    const revoked = (await services.notifications.list(VIEWER_ID)).find(
      (notification) => notification.type === "tournament_invitation",
    );
    expect(revoked).toMatchObject({
      lifecycle: "cancelled",
      actionable: false,
      reasonCode: "event_cancelled",
      lifecycleAt: clock.now(),
      readAt: clock.now(),
    });
  });
});
