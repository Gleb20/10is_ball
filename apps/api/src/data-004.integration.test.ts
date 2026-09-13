import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import {
  notifications,
  teamInvitations,
  teamMemberships,
  tournamentInvitations,
  tournamentParticipants,
  users,
} from "./db/schema.js";

const ORGANIZER_ID = "00000000-0000-4000-8000-000000000101";
const INVITEE_ID = "00000000-0000-4000-8000-000000000102";
const OTHER_ID = "00000000-0000-4000-8000-000000000103";

describe("DATA-004 invitation and membership concurrency", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let db: Db;
  let clock: FakeClock;
  let client: Awaited<ReturnType<typeof createMigratedPgliteDb>>["client"];
  let close: () => Promise<void>;

  beforeEach(async () => {
    const context = await createMigratedPgliteDb();
    db = context.db;
    client = context.client;
    close = context.close;
    clock = new FakeClock(new Date("2026-09-07T10:00:00.000Z"));
    const built = await buildApp({ db, clock });
    app = built.app;
    services = built.services;

    await db.insert(users).values([
      {
        id: ORGANIZER_ID,
        email: "organizer@data-004.test",
        passwordHash: "synthetic-hash",
        firstName: "Organizer",
        lastName: "Test",
        mustChangePassword: false,
      },
      {
        id: INVITEE_ID,
        email: "invitee@data-004.test",
        passwordHash: "synthetic-hash",
        firstName: "Invitee",
        lastName: "Test",
        mustChangePassword: false,
      },
      {
        id: OTHER_ID,
        email: "other@data-004.test",
        passwordHash: "synthetic-hash",
        firstName: "Other",
        lastName: "Test",
        mustChangePassword: false,
      },
    ]);
  });

  afterEach(async () => {
    await app.close();
    await close();
  });

  it("AT-TEAM-001/AT-NOTIF-001: concurrent team invite is one atomic pending invitation", async () => {
    const team = await services.teams.create({
      name: "DATA-004 team",
      captainUserId: ORGANIZER_ID,
    });

    const [first, replay] = await Promise.all([
      services.teams.invite({
        teamId: team!.id,
        invitedUserId: INVITEE_ID,
        invitedByUserId: ORGANIZER_ID,
      }),
      services.teams.invite({
        teamId: team!.id,
        invitedUserId: INVITEE_ID,
        invitedByUserId: ORGANIZER_ID,
      }),
    ]);

    expect(replay!.id).toBe(first!.id);
    expect(
      await db.query.teamInvitations.findMany({
        where: and(
          eq(teamInvitations.teamId, team!.id),
          eq(teamInvitations.invitedUserId, INVITEE_ID),
          eq(teamInvitations.status, "pending"),
        ),
      }),
    ).toHaveLength(1);
    expect(
      (await db.query.notifications.findMany()).filter(
        (row) => row.type === "team_invitation",
      ),
    ).toHaveLength(1);

    const beforeForbidden = await db.query.teamInvitations.findMany();
    await expect(
      services.teams.invite({
        teamId: team!.id,
        invitedUserId: OTHER_ID,
        invitedByUserId: INVITEE_ID,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.query.teamInvitations.findMany()).toEqual(beforeForbidden);

    const faultTeam = await services.teams.create({
      name: "DATA-004 invite fault team",
      captainUserId: ORGANIZER_ID,
    });
    await client.exec(`
      CREATE OR REPLACE FUNCTION data_004_fail_notification_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.type = 'team_invitation' THEN
          RAISE EXCEPTION 'injected DATA-004 invite failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER data_004_fail_notification_insert
      BEFORE INSERT ON notifications
      FOR EACH ROW EXECUTE FUNCTION data_004_fail_notification_insert();
    `);
    await expect(
      services.teams.invite({
        teamId: faultTeam!.id,
        invitedUserId: OTHER_ID,
        invitedByUserId: ORGANIZER_ID,
      }),
    ).rejects.toThrow();
    expect(
      await db.query.teamInvitations.findMany({
        where: and(
          eq(teamInvitations.teamId, faultTeam!.id),
          eq(teamInvitations.invitedUserId, OTHER_ID),
        ),
      }),
    ).toHaveLength(0);
  });

  it("AT-TEAM-002/AT-NOTIF-001: concurrent team accept is idempotent and rolls back on notification failure", async () => {
    const team = await services.teams.create({
      name: "DATA-004 accept team",
      captainUserId: ORGANIZER_ID,
    });
    const invitation = await services.teams.invite({
      teamId: team!.id,
      invitedUserId: INVITEE_ID,
      invitedByUserId: ORGANIZER_ID,
    });

    const [first, replay] = await Promise.all([
      services.teams.respondInvitation({
        invitationId: invitation!.id,
        userId: INVITEE_ID,
        accept: true,
      }),
      services.teams.respondInvitation({
        invitationId: invitation!.id,
        userId: INVITEE_ID,
        accept: true,
      }),
    ]);
    expect(first).toEqual({ status: "accepted", teamId: team!.id });
    expect(replay).toEqual({ status: "accepted", teamId: team!.id });
    expect(
      await db.query.teamMemberships.findMany({
        where: and(
          eq(teamMemberships.teamId, team!.id),
          eq(teamMemberships.userId, INVITEE_ID),
          isNull(teamMemberships.leftAt),
        ),
      }),
    ).toHaveLength(1);
    await expect(
      services.teams.respondInvitation({
        invitationId: invitation!.id,
        userId: OTHER_ID,
        accept: false,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      services.teams.respondInvitation({
        invitationId: invitation!.id,
        userId: INVITEE_ID,
        accept: true,
      }),
    ).resolves.toEqual({ status: "accepted", teamId: team!.id });

    const notification = (
      await db.query.notifications.findMany({
        where: eq(notifications.userId, INVITEE_ID),
      })
    ).find((row) => row.type === "team_invitation");
    expect(notification?.readAt).toEqual(clock.now());

    const secondInvitation = await services.teams.invite({
      teamId: team!.id,
      invitedUserId: OTHER_ID,
      invitedByUserId: ORGANIZER_ID,
    });
    await client.exec(`
      CREATE OR REPLACE FUNCTION data_004_fail_team_notification_update()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.type = 'team_invitation' THEN
          RAISE EXCEPTION 'injected DATA-004 notification failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER data_004_fail_team_notification_update
      BEFORE UPDATE OF read_at ON notifications
      FOR EACH ROW EXECUTE FUNCTION data_004_fail_team_notification_update();
    `);

    await expect(
      services.teams.respondInvitation({
        invitationId: secondInvitation!.id,
        userId: OTHER_ID,
        accept: true,
      }),
    ).rejects.toThrow();
    expect(
      await db.query.teamInvitations.findFirst({
        where: eq(teamInvitations.id, secondInvitation!.id),
      }),
    ).toMatchObject({ status: "pending", respondedAt: null });
    expect(
      await db.query.teamMemberships.findMany({
        where: and(
          eq(teamMemberships.teamId, team!.id),
          eq(teamMemberships.userId, OTHER_ID),
          isNull(teamMemberships.leftAt),
        ),
      }),
    ).toHaveLength(0);
  });

  it("AT-TRN-004/AT-NOTIF-001: tournament invite and membership races converge once", async () => {
    const tournament = await services.tournaments.create({
      title: "DATA-004 tournament",
      format: "single_elimination",
      createdByUserId: ORGANIZER_ID,
      organizerParticipates: false,
    });

    const [first, replay] = await Promise.all([
      services.tournaments.invite({
        tournamentId: tournament!.id,
        invitedUserId: INVITEE_ID,
        invitedByUserId: ORGANIZER_ID,
      }),
      services.tournaments.invite({
        tournamentId: tournament!.id,
        invitedUserId: INVITEE_ID,
        invitedByUserId: ORGANIZER_ID,
      }),
    ]);
    expect(replay!.id).toBe(first!.id);

    const [response, directAdd] = await Promise.allSettled([
      services.tournaments.respondInvitation({
        invitationId: first!.id,
        userId: INVITEE_ID,
        accept: true,
      }),
      services.tournaments.addParticipant({
        tournamentId: tournament!.id,
        actorUserId: ORGANIZER_ID,
        userId: INVITEE_ID,
      }),
    ]);
    expect(response).toEqual({
      status: "fulfilled",
      value: { status: "accepted" },
    });
    if (directAdd.status === "rejected") {
      expect(directAdd.reason).toMatchObject({ code: "ALREADY_IN_TOURNAMENT" });
    } else {
      expect(directAdd.value?.userId).toBe(INVITEE_ID);
    }
    expect(
      await db.query.tournamentParticipants.findMany({
        where: and(
          eq(tournamentParticipants.tournamentId, tournament!.id),
          eq(tournamentParticipants.userId, INVITEE_ID),
          eq(tournamentParticipants.status, "active"),
        ),
      }),
    ).toHaveLength(1);
    expect(
      await db.query.tournamentInvitations.findMany({
        where: and(
          eq(tournamentInvitations.tournamentId, tournament!.id),
          eq(tournamentInvitations.invitedUserId, INVITEE_ID),
          eq(tournamentInvitations.status, "pending"),
        ),
      }),
    ).toHaveLength(0);
    await expect(
      services.tournaments.respondInvitation({
        invitationId: first!.id,
        userId: INVITEE_ID,
        accept: true,
      }),
    ).resolves.toEqual({ status: "accepted" });

    const beforeForbidden = await db.query.tournamentInvitations.findMany();
    await expect(
      services.tournaments.invite({
        tournamentId: tournament!.id,
        invitedUserId: OTHER_ID,
        invitedByUserId: INVITEE_ID,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.query.tournamentInvitations.findMany()).toEqual(
      beforeForbidden,
    );
  });

  it("AT-TEAM-002/AT-NOTIF-002/003: expiry and cancellation are terminal, non-actionable, and atomic", async () => {
    const team = await services.teams.create({
      name: "DATA-004 expiry team",
      captainUserId: ORGANIZER_ID,
    });
    const teamInvitation = await services.teams.invite({
      teamId: team!.id,
      invitedUserId: INVITEE_ID,
      invitedByUserId: ORGANIZER_ID,
    });
    clock.advanceMs(14 * 24 * 60 * 60 * 1000);

    const expiredList = await services.notifications.list(INVITEE_ID);
    const expiredNotification = expiredList.find(
      (row) => row.type === "team_invitation",
    );
    expect(expiredNotification).toMatchObject({ lifecycle: "expired" });
    expect(expiredNotification?.readAt).toEqual(clock.now());
    expect(
      await db.query.teamInvitations.findFirst({
        where: eq(teamInvitations.id, teamInvitation!.id),
      }),
    ).toMatchObject({ status: "expired", respondedAt: clock.now() });
    expect(await services.notifications.unread(INVITEE_ID)).toHaveLength(0);
    expect(await services.notifications.unreadCount(INVITEE_ID)).toBe(0);

    const tournament = await services.tournaments.create({
      title: "DATA-004 cancelled tournament",
      format: "single_elimination",
      createdByUserId: ORGANIZER_ID,
      organizerParticipates: false,
    });
    await services.tournaments.invite({
      tournamentId: tournament!.id,
      invitedUserId: OTHER_ID,
      invitedByUserId: ORGANIZER_ID,
    });
    await services.tournaments.cancel(tournament!.id, ORGANIZER_ID);
    const cancelledList = await services.notifications.list(OTHER_ID);
    expect(
      cancelledList.find((row) => row.type === "tournament_invitation"),
    ).toMatchObject({ lifecycle: "cancelled", readAt: clock.now() });
    expect(await services.notifications.unread(OTHER_ID)).toHaveLength(0);

    const faultTeam = await services.teams.create({
      name: "DATA-004 expiry fault team",
      captainUserId: ORGANIZER_ID,
    });
    const faultInvitation = await services.teams.invite({
      teamId: faultTeam!.id,
      invitedUserId: OTHER_ID,
      invitedByUserId: ORGANIZER_ID,
    });
    clock.advanceMs(14 * 24 * 60 * 60 * 1000);
    await client.exec(`
      CREATE OR REPLACE FUNCTION data_004_fail_expiry_notification_update()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.type = 'team_invitation' THEN
          RAISE EXCEPTION 'injected DATA-004 expiry failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER data_004_fail_expiry_notification_update
      BEFORE UPDATE OF read_at ON notifications
      FOR EACH ROW EXECUTE FUNCTION data_004_fail_expiry_notification_update();
    `);
    await expect(services.notifications.list(OTHER_ID)).rejects.toThrow();
    expect(
      await db.query.teamInvitations.findFirst({
        where: eq(teamInvitations.id, faultInvitation!.id),
      }),
    ).toMatchObject({ status: "pending", respondedAt: null });
  });
});
