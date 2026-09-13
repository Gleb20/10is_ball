import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { and, eq, inArray } from "drizzle-orm";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import {
  auditLogs,
  authSessions,
  notifications,
  teamMemberships,
  teams,
  tournamentParticipants,
  tournaments,
  users,
  matches,
} from "./db/schema.js";

describe("GAP-008 transactional event notifications", () => {
  let db: Db;
  let services: AppServices;
  let close: () => Promise<void>;
  let closeApp: () => Promise<void>;
  const admin = "00000000-0000-4000-8000-000000008201";
  const actor = "00000000-0000-4000-8000-000000008202";
  const target = "00000000-0000-4000-8000-000000008203";
  const judge = "00000000-0000-4000-8000-000000008204";
  const handoverTarget = "00000000-0000-4000-8000-000000008205";

  beforeEach(async () => {
    const context = await createMigratedPgliteDb();
    db = context.db;
    close = context.close;
    const built = await buildApp({
      db,
      clock: new FakeClock(new Date("2026-09-13T13:00:00Z")),
    });
    services = built.services;
    closeApp = () => built.app.close();
    await db.insert(users).values([
      { id: admin, email: "admin@events.test", passwordHash: "x", role: "admin", firstName: "Admin", lastName: "Events", mustChangePassword: false },
      { id: actor, email: "actor@events.test", passwordHash: "x", firstName: "Actor", lastName: "Events", mustChangePassword: false },
      { id: target, email: "target@events.test", passwordHash: "x", firstName: "Target", lastName: "Events", mustChangePassword: false },
      { id: judge, email: "judge@events.test", passwordHash: "x", firstName: "Judge", lastName: "Events", mustChangePassword: false },
      { id: handoverTarget, email: "handover@events.test", passwordHash: "x", firstName: "Next", lastName: "Judge", mustChangePassword: false },
    ]);
  });

  afterEach(async () => {
    await closeApp();
    await close();
  });

  it("notifies distinct registered participants once for match stop and cancel", async () => {
    const stopped = await services.matches.createMatch({
      createdByUserId: actor,
      title: "Stopped event",
      format: "1v1",
      firstServerMethod: "random",
      participants: [
        { side: "A", userId: actor },
        { side: "B", userId: target },
      ],
    });
    await services.matches.respondInvitation(stopped!.invitations[0]!.id, target, true);
    await services.matches.startMatch(stopped!.id, actor);
    await services.matches.stopMatch({
      matchId: stopped!.id,
      winnerSide: "A",
      reasonCode: "time",
      actorUserId: actor,
    });

    const cancelled = await services.matches.createMatch({
      createdByUserId: actor,
      title: "Cancelled event",
      format: "1v1",
      participants: [
        { side: "A", userId: actor },
        { side: "B", userId: target },
      ],
    });
    const cancelledOnce = await services.matches.cancelMatch({
      matchId: cancelled!.id,
      actorUserId: actor,
      expectedVersion: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000008211",
    });
    await services.matches.cancelMatch({
      matchId: cancelled!.id,
      actorUserId: actor,
      expectedVersion: cancelledOnce!.version,
      idempotencyKey: "00000000-0000-4000-8000-000000008211",
    });

    const rows = await db.query.notifications.findMany({
      where: inArray(notifications.type, ["match_stopped", "match_cancelled"]),
    });
    expect(
      rows
        .map((row) => ({ userId: row.userId, type: row.type }))
        .sort((a, b) => a.type.localeCompare(b.type)),
    ).toEqual([
      { userId: target, type: "match_cancelled" },
      { userId: target, type: "match_stopped" },
    ]);
  });

  it("notifies only the handover target and does not duplicate a replay", async () => {
    const match = await services.matches.createMatch({
      createdByUserId: actor,
      title: "Judge handover",
      format: "1v1",
      participants: [
        { side: "A", userId: actor },
        { side: "B", guestFirstName: "Guest", guestLastName: "Player" },
      ],
    });
    const [session] = await db.insert(authSessions).values({
      userId: judge,
      tokenHash: "handover-session",
      expiresAt: new Date("2026-09-14T13:00:00Z"),
    }).returning();
    await services.matches.acquireJudge({
      matchId: match!.id,
      userId: judge,
      authSessionId: session!.id,
    });
    const input = {
      matchId: match!.id,
      fromUserId: judge,
      fromAuthSessionId: session!.id,
      toUserId: handoverTarget,
    };
    await services.matches.handoverJudge(input);
    await services.matches.handoverJudge(input);
    const rows = await db.query.notifications.findMany({
      where: eq(notifications.type, "judge_handover_offered"),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: handoverTarget,
      payload: { matchId: match!.id },
    });
  });

  it("notifies the target for each effective account access change without secrets", async () => {
    await services.auth.updateUserRole(admin, target, "admin");
    const reset = await services.auth.resetPassword(admin, target);
    await services.auth.blockUser(admin, target);
    await services.auth.unblockUser(admin, target);
    await services.auth.unblockUser(admin, target);
    const rows = await db.query.notifications.findMany({
      where: and(
        eq(notifications.userId, target),
        eq(notifications.type, "account_access_changed"),
      ),
    });
    expect(rows.map((row) => (row.payload as { change?: string }).change).sort()).toEqual([
      "blocked",
      "password_reset",
      "role_changed",
      "unblocked",
    ]);
    expect(JSON.stringify(rows)).not.toContain(reset.temporaryPassword);
    expect(rows.flatMap((row) => Object.keys((row.payload ?? {}) as object))).not.toContain(
      "temporaryPassword",
    );
  });

  it("notifies active tournament participants on stop and a teammate on direct addition", async () => {
    const [team] = await db.insert(teams).values({
      name: "Event team",
      slug: "event-team",
      captainUserId: actor,
    }).returning();
    await db.insert(teamMemberships).values([
      { teamId: team!.id, userId: actor },
      { teamId: team!.id, userId: target },
    ]);
    const collecting = await services.tournaments.create({
      title: "Team addition",
      format: "single_elimination",
      createdByUserId: actor,
      organizerParticipates: false,
    });
    await services.tournaments.addParticipant({
      tournamentId: collecting!.id,
      actorUserId: actor,
      userId: target,
    });
    const invited = await services.tournaments.create({
      title: "Explicit teammate invite",
      format: "single_elimination",
      createdByUserId: actor,
      organizerParticipates: false,
    });
    const explicitInvite = await services.tournaments.invite({
      tournamentId: invited!.id,
      invitedUserId: target,
      invitedByUserId: actor,
    });
    await services.tournaments.respondInvitation({
      invitationId: explicitInvite!.id,
      userId: target,
      accept: true,
    });

    const [stopping] = await db.insert(tournaments).values({
      title: "Stopped tournament",
      format: "single_elimination",
      createdByUserId: actor,
      defaultJudgeUserId: actor,
      status: "in_progress",
    }).returning();
    await db.insert(tournamentParticipants).values([
      { tournamentId: stopping!.id, userId: actor, status: "active" },
      { tournamentId: stopping!.id, userId: target, status: "active" },
    ]);
    await services.tournaments.stop(stopping!.id, actor, { code: "other", text: "Fixture" });
    await expect(
      services.tournaments.stop(stopping!.id, actor, { code: "other", text: "Fixture" }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });

    const rows = await db.query.notifications.findMany({
      where: inArray(notifications.type, ["tournament_team_added", "tournament_stopped"]),
    });
    expect(
      rows
        .map((row) => ({ userId: row.userId, type: row.type }))
        .sort((a, b) => a.type.localeCompare(b.type)),
    ).toEqual([
      { userId: target, type: "tournament_stopped" },
      { userId: target, type: "tournament_team_added" },
    ]);
  });

  it("stores stable terminal reasons when tournament invitations close", async () => {
    const cancelled = await services.tournaments.create({
      title: "Cancelled invitations",
      format: "single_elimination",
      createdByUserId: actor,
      organizerParticipates: false,
    });
    const cancelledInvite = await services.tournaments.invite({
      tournamentId: cancelled!.id,
      invitedUserId: target,
      invitedByUserId: actor,
    });
    await services.tournaments.cancel(cancelled!.id, actor);

    const closed = await services.tournaments.create({
      title: "Closed roster",
      format: "single_elimination",
      createdByUserId: actor,
    });
    await services.tournaments.addParticipant({
      tournamentId: closed!.id,
      actorUserId: actor,
      guestFirstName: "Bracket",
      guestLastName: "One",
    });
    await services.tournaments.addParticipant({
      tournamentId: closed!.id,
      actorUserId: actor,
      guestFirstName: "Bracket",
      guestLastName: "Two",
    });
    const closedInvite = await services.tournaments.invite({
      tournamentId: closed!.id,
      invitedUserId: handoverTarget,
      invitedByUserId: actor,
    });
    await services.tournaments.generateBracket(closed!.id, actor, {
      constructionAlgorithm: "compact",
      rng: () => 0.5,
    });

    const rows = await db.query.notifications.findMany({
      where: eq(notifications.type, "tournament_invitation"),
    });
    const reasonByInvitation = new Map(rows.map((row) => {
      const payload = row.payload as { invitationId: string; reasonCode?: string };
      return [payload.invitationId, payload.reasonCode] as const;
    }));
    expect(reasonByInvitation.get(cancelledInvite!.id)).toBe("event_cancelled");
    expect(reasonByInvitation.get(closedInvite!.id)).toBe("roster_closed");
  });

  it("rolls back source transitions when event notification persistence fails", async () => {
    const match = await services.matches.createMatch({
      createdByUserId: actor,
      title: "Rollback notification",
      format: "1v1",
      participants: [
        { side: "A", userId: actor },
        { side: "B", userId: target },
      ],
    });
    await db.execute(`
      CREATE FUNCTION gap008_fail_event_notification() RETURNS trigger AS $$
      BEGIN
        IF NEW.type IN ('match_cancelled', 'account_access_changed', 'tournament_team_added') THEN
          RAISE EXCEPTION 'injected GAP-008 event notification failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.execute(`
      CREATE TRIGGER gap008_fail_event_notification
      BEFORE INSERT ON notifications
      FOR EACH ROW EXECUTE FUNCTION gap008_fail_event_notification();
    `);

    await expect(services.matches.cancelMatch({
      matchId: match!.id,
      actorUserId: actor,
      expectedVersion: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000008212",
    })).rejects.toThrow(/insert into "notifications"/);
    expect(await db.query.matches.findFirst({
      where: eq(matches.id, match!.id),
    })).toMatchObject({ status: "waiting", version: 0 });

    await expect(
      services.auth.updateUserRole(admin, target, "admin"),
    ).rejects.toThrow(/insert into "notifications"/);
    expect(await db.query.users.findFirst({ where: eq(users.id, target) })).toMatchObject({
      role: "user",
    });
    expect(await db.query.auditLogs.findMany({
      where: and(
        eq(auditLogs.entityId, target),
        eq(auditLogs.action, "user.role_changed"),
      ),
    })).toEqual([]);

    const [team] = await db.insert(teams).values({
      name: "Rollback team",
      slug: "rollback-team",
      captainUserId: actor,
    }).returning();
    await db.insert(teamMemberships).values([
      { teamId: team!.id, userId: actor },
      { teamId: team!.id, userId: target },
    ]);
    const tournament = await services.tournaments.create({
      title: "Rollback tournament addition",
      format: "single_elimination",
      createdByUserId: actor,
      organizerParticipates: false,
    });
    await expect(services.tournaments.addParticipant({
      tournamentId: tournament!.id,
      actorUserId: actor,
      userId: target,
    })).rejects.toThrow(/insert into "notifications"/);
    expect(await db.query.tournamentParticipants.findMany({
      where: eq(tournamentParticipants.tournamentId, tournament!.id),
    })).toEqual([]);
  });
});
