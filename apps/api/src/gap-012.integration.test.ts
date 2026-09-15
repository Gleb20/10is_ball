import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { generateSingleEliminationBracket } from "@tab10/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import {
  auditLogs,
  authSessions,
  notifications,
  tournamentParticipants,
  tournamentInvitations,
  tournaments,
  users,
} from "./db/schema.js";
import { hashToken } from "./modules/auth/auth-service.js";

describe("GAP-012 operator-first game setup", () => {
  let db: Db;
  let app: FastifyInstance;
  let services: AppServices;
  let close: () => Promise<void>;
  let closeApp: () => Promise<void>;

  const organizer = "00000000-0000-4000-8000-000000012001";
  const playerA = "00000000-0000-4000-8000-000000012002";
  const playerB = "00000000-0000-4000-8000-000000012003";
  const playerC = "00000000-0000-4000-8000-000000012004";
  const admin = "00000000-0000-4000-8000-000000012005";
  const outsider = "00000000-0000-4000-8000-000000012006";
  const cookies = (token: string) => ({ tab10_session: token });

  beforeEach(async () => {
    const context = await createMigratedPgliteDb();
    db = context.db;
    close = context.close;
    const built = await buildApp({
      db,
      clock: new FakeClock(new Date("2026-09-13T18:00:00Z")),
      randomIndex: () => 0,
    });
    app = built.app;
    services = built.services;
    closeApp = () => built.app.close();
    await db.insert(users).values([
      { id: organizer, email: "organizer@gap012.test", passwordHash: "x", firstName: "Phone", lastName: "Owner", mustChangePassword: false },
      { id: playerA, email: "a@gap012.test", passwordHash: "x", firstName: "One", lastName: "Player", mustChangePassword: false },
      { id: playerB, email: "b@gap012.test", passwordHash: "x", firstName: "Two", lastName: "Player", mustChangePassword: false },
      { id: playerC, email: "c@gap012.test", passwordHash: "x", firstName: "Three", lastName: "Player", mustChangePassword: false },
      { id: admin, email: "admin@gap012.test", passwordHash: "x", firstName: "Global", lastName: "Admin", role: "admin", mustChangePassword: false },
      { id: outsider, email: "outsider@gap012.test", passwordHash: "x", firstName: "Other", lastName: "User", mustChangePassword: false },
    ]);
    for (const [id, token] of [[organizer, "organizer"], [admin, "admin"], [outsider, "outsider"]] as const) {
      await db.insert(authSessions).values({
        userId: id,
        tokenHash: hashToken(token),
        expiresAt: new Date("2026-09-14T18:00:00Z"),
      });
    }
  });

  it("exposes the operator-first policy through the HTTP contract and returns actionable conflicts", async () => {
    const directMatch = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: cookies("organizer"),
      payload: {
        title: "HTTP direct selection",
        format: "1v1",
        participants: [
          { side: "A", userId: playerA },
          { side: "B", userId: playerB },
        ],
      },
    });
    expect(directMatch.statusCode).toBe(200);
    expect(directMatch.json().match).toMatchObject({
      createdByUserId: organizer,
      invitations: [],
    });

    const invalidChallenge = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: cookies("organizer"),
      payload: {
        title: "Challenge requires its initiator",
        format: "1v1",
        source: "challenge",
        participants: [
          { side: "A", userId: playerA },
          { side: "B", userId: playerB },
        ],
      },
    });
    expect(invalidChallenge.statusCode).toBe(400);
    expect(invalidChallenge.json()).toMatchObject({ code: "VALIDATION" });

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tournaments",
      cookies: cookies("organizer"),
      payload: {
        title: "HTTP consent policy",
        requireParticipantConsent: true,
        organizerParticipates: false,
      },
    });
    expect(created.statusCode).toBe(200);
    const tournamentId = created.json().tournament.id as string;
    expect(created.json().tournament.requireParticipantConsent).toBe(true);

    const immutablePolicy = await app.inject({
      method: "PATCH",
      url: `/api/v1/tournaments/${tournamentId}`,
      cookies: cookies("organizer"),
      payload: { requireParticipantConsent: false },
    });
    expect(immutablePolicy.statusCode).toBe(400);
    expect(immutablePolicy.json()).toMatchObject({ code: "VALIDATION" });

    const confirmationRequired = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${tournamentId}/participants`,
      cookies: cookies("organizer"),
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000012111" },
      payload: { userId: playerA },
    });
    expect(confirmationRequired.statusCode).toBe(409);
    expect(confirmationRequired.json()).toMatchObject({
      code: "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED",
      message: "Подтвердите добавление участника без его согласия",
    });

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${tournamentId}/participants`,
      cookies: cookies("organizer"),
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000012111" },
      payload: { userId: playerA, confirmManualOverride: true },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toMatchObject({
      participant: { userId: playerA, additionSource: "manual_override" },
      tournament: { id: tournamentId, requireParticipantConsent: true },
    });

    const adminList = await app.inject({
      method: "GET",
      url: "/api/v1/tournaments",
      cookies: cookies("admin"),
    });
    expect(adminList.statusCode).toBe(200);
    expect(adminList.json().tournaments).toEqual(expect.arrayContaining([
      { id: tournamentId, title: "HTTP consent policy", status: "collecting" },
    ]));
    const adminDetail = await app.inject({
      method: "GET",
      url: `/api/v1/tournaments/${tournamentId}`,
      cookies: cookies("admin"),
    });
    expect(Object.keys(adminDetail.json().tournament).sort()).toEqual([
      "createdByUserId", "format", "id", "participants",
      "requireParticipantConsent", "status", "title",
    ]);
  });

  afterEach(async () => {
    await closeApp?.();
    await close?.();
  });

  it("does not auto-invite selected players and starts A-vs-B by nonplaying C with explicit voluntary invitations pending", async () => {
    const noInvite = await services.matches.createMatch({
      createdByUserId: organizer,
      title: "Selection is not invitation",
      format: "1v1",
      firstServerMethod: "random",
      participants: [
        { side: "A", userId: playerA },
        { side: "B", userId: playerB },
      ],
    });
    expect(noInvite?.invitations).toEqual([]);

    const match = await services.matches.createMatch({
      createdByUserId: organizer,
      title: "A vs B by C",
      format: "1v1",
      firstServerMethod: "random",
      sendPlayerInvitations: true,
      participants: [
        { side: "A", userId: playerA },
        { side: "B", userId: playerB },
      ],
    });
    expect(match?.participants.map((participant) => participant.userId).sort()).toEqual([playerA, playerB]);
    expect(match?.invitations).toHaveLength(2);

    const started = await services.matches.startMatch(match!.id, organizer);
    expect(started).toMatchObject({ status: "in_progress", createdByUserId: organizer });
    expect(started?.invitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "player", status: "cancelled", expiryReason: "match_started" }),
      expect.objectContaining({ kind: "player", status: "cancelled", expiryReason: "match_started" }),
    ]));
    const invitationIds = started!.invitations.map((invitation) => invitation.id);
    expect(await db.query.notifications.findMany({
      where: and(eq(notifications.type, "match_invitation")),
    })).toEqual(expect.arrayContaining(invitationIds.map((invitationId) =>
      expect.objectContaining({ payload: expect.objectContaining({ invitationId }), readAt: expect.any(Date) }),
    )));
  });

  it("persists both tournament policies and limits required-consent override to organizer/admin with named audit", async () => {
    const created = await services.tournaments.create({
      title: "Consent required",
      format: "single_elimination",
      createdByUserId: organizer,
      organizerParticipates: false,
      requireParticipantConsent: true,
    } as Parameters<AppServices["tournaments"]["create"]>[0]);
    expect(created).toMatchObject({ requireParticipantConsent: true });
    const organizerView = await services.tournaments.getVisible(created!.id, organizer);
    expect(organizerView).toHaveProperty("invitations");
    const adminView = await services.tournaments.getVisible(created!.id, admin);
    expect(Object.keys(adminView!).sort()).toEqual([
      "createdByUserId", "format", "id", "participants",
      "requireParticipantConsent", "status", "title",
    ]);
    expect((adminView as { invitations?: unknown }).invitations).toBeUndefined();
    expect(await services.tournaments.listCatalog(admin)).toEqual(expect.arrayContaining([
      { id: created!.id, title: created!.title, status: created!.status },
    ]));
    const adminOwned = await services.tournaments.create({
      title: "Admin-owned context",
      format: "single_elimination",
      createdByUserId: admin,
      organizerParticipates: false,
    });
    expect(await services.tournaments.getVisible(adminOwned!.id, admin)).toHaveProperty("invitations");

    const organizerPlaying = await services.tournaments.create({
      title: "Organizer withdrawal stays withdrawn",
      format: "single_elimination",
      createdByUserId: organizer,
      organizerParticipates: true,
    });
    const organizerParticipant = organizerPlaying!.participants.find(
      (participant) => participant.userId === organizer,
    );
    expect(organizerParticipant).toBeDefined();
    const withdrawn = await services.tournaments.withdraw({
      tournamentId: organizerPlaying!.id,
      userId: organizer,
    });
    expect(withdrawn!.participants.some(
      (participant) => participant.userId === organizer && participant.status === "active",
    )).toBe(false);
    const rosterBeforeAdminRead = await db.query.tournamentParticipants.findMany({
      where: eq(tournamentParticipants.tournamentId, organizerPlaying!.id),
    });
    await services.tournaments.getVisible(organizerPlaying!.id, admin);
    expect(await db.query.tournamentParticipants.findMany({
      where: eq(tournamentParticipants.tournamentId, organizerPlaying!.id),
    })).toEqual(rosterBeforeAdminRead);

    const outsiderResult = await services.tournaments.addParticipant({
      tournamentId: created!.id,
      actorUserId: outsider,
      userId: playerA,
      confirmManualOverride: true,
      idempotencyKey: "00000000-0000-4000-8000-000000012101",
    } as Parameters<AppServices["tournaments"]["addParticipant"]>[0]).then(() => "allowed", (error: { code?: string }) => error.code);
    expect(outsiderResult).toBe("FORBIDDEN");

    await expect(services.tournaments.addParticipant({
      tournamentId: created!.id,
      actorUserId: organizer,
      userId: playerA,
      idempotencyKey: "00000000-0000-4000-8000-000000012102",
    } as Parameters<AppServices["tournaments"]["addParticipant"]>[0])).rejects.toMatchObject({ code: "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED" });

    const participant = await services.tournaments.addParticipant({
      tournamentId: created!.id,
      actorUserId: admin,
      userId: playerA,
      confirmManualOverride: true,
      idempotencyKey: "00000000-0000-4000-8000-000000012103",
    } as Parameters<AppServices["tournaments"]["addParticipant"]>[0]);
    expect(participant).toMatchObject({ userId: playerA, additionSource: "manual_override", addedByUserId: admin });
    expect(await db.query.auditLogs.findMany({
      where: and(eq(auditLogs.action, "tournament.participant_manually_added"), eq(auditLogs.actorUserId, admin)),
    })).toEqual([expect.objectContaining({
      entityId: participant!.id,
      meta: expect.objectContaining({ source: "manual_override", consentRequired: true }),
    })]);
  });

  it("adds once to a generated bracket, regenerates atomically and replays the idempotency key", async () => {
    const tournament = await services.tournaments.create({
      title: "Atomic roster regeneration",
      format: "single_elimination",
      createdByUserId: organizer,
      organizerParticipates: false,
      requireParticipantConsent: false,
    } as Parameters<AppServices["tournaments"]["create"]>[0]);
    for (const userId of [playerA, playerB, playerC]) {
      await services.tournaments.addParticipant({ tournamentId: tournament!.id, actorUserId: organizer, userId } as Parameters<AppServices["tournaments"]["addParticipant"]>[0]);
    }
    await services.tournaments.generateBracket(tournament!.id, organizer, { rng: () => 0.5 });
    const before = await services.tournaments.get(tournament!.id);
    const beforeSeeds = (before!.bracketJson as { seedOrder: string[] }).seedOrder;

    const input = {
      tournamentId: tournament!.id,
      actorUserId: organizer,
      userId: outsider,
      confirmBracketRegeneration: true,
      idempotencyKey: "00000000-0000-4000-8000-000000012104",
    } as Parameters<AppServices["tournaments"]["addParticipant"]>[0];
    const first = await services.tournaments.addParticipant(input);
    const afterFirst = await services.tournaments.get(tournament!.id);
    const replay = await services.tournaments.addParticipant(input);
    const afterReplay = await services.tournaments.get(tournament!.id);

    expect(replay!.id).toBe(first!.id);
    expect(afterFirst).toMatchObject({ status: "bracket_generated" });
    expect((afterFirst!.bracketJson as { seedOrder: string[] }).seedOrder.slice(0, beforeSeeds.length)).toEqual(beforeSeeds);
    expect(afterReplay!.bracketStateVersion).toBe(afterFirst!.bracketStateVersion);
    expect(await db.query.tournamentParticipants.findMany({
      where: and(eq(tournamentParticipants.tournamentId, tournament!.id), eq(tournamentParticipants.userId, outsider), eq(tournamentParticipants.status, "active")),
    })).toHaveLength(1);
    await expect(services.tournaments.addParticipant({
      ...input,
      userId: playerA,
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    await db.update(tournaments).set({ status: "in_progress" }).where(eq(tournaments.id, tournament!.id));
    const snapshot = await services.tournaments.get(tournament!.id);
    const participantCount = snapshot!.participants.length;
    const auditCount = (await db.query.auditLogs.findMany({
      where: eq(auditLogs.entityType, "tournament_participant"),
    })).length;
    const recoveredReplay = await services.tournaments.addParticipant(input);
    expect(recoveredReplay!.id).toBe(first!.id);
    expect((await services.tournaments.get(tournament!.id))!.bracketStateVersion).toBe(snapshot!.bracketStateVersion);
    await expect(services.tournaments.addParticipant({
      tournamentId: tournament!.id,
      actorUserId: organizer,
      guestFirstName: "Late",
      guestLastName: "Guest",
      idempotencyKey: "00000000-0000-4000-8000-000000012105",
    } as Parameters<AppServices["tournaments"]["addParticipant"]>[0])).rejects.toMatchObject({ code: "INVALID_STATUS" });
    expect(await services.tournaments.get(tournament!.id)).toMatchObject({
      bracketJson: snapshot!.bracketJson,
      bracketStateVersion: snapshot!.bracketStateVersion,
    });
    expect((await services.tournaments.get(tournament!.id))!.participants).toHaveLength(participantCount);
    expect((await db.query.auditLogs.findMany({
      where: eq(auditLogs.entityType, "tournament_participant"),
    }))).toHaveLength(auditCount);
  });

  it("preserves a legacy V1 manual seed swap when a confirmed add regenerates the bracket", async () => {
    const tournament = await services.tournaments.create({
      title: "Legacy swap regeneration",
      format: "single_elimination",
      createdByUserId: organizer,
      organizerParticipates: false,
    });
    for (const userId of [playerA, playerB, playerC]) {
      await services.tournaments.addParticipant({
        tournamentId: tournament!.id,
        actorUserId: organizer,
        userId,
      });
    }
    const roster = (await services.tournaments.get(tournament!.id))!.participants
      .filter((participant) => participant.status === "active");
    let slot = 0;
    const legacy = generateSingleEliminationBracket(
      roster.map((participant) => participant.id),
      () => `gap012_legacy_${++slot}`,
    );
    for (let index = 0; index < roster.length; index += 1) {
      await db.update(tournamentParticipants).set({ seed: index + 1 })
        .where(eq(tournamentParticipants.id, roster[index]!.id));
    }
    const seedSlots = legacy.slots
      .filter((entry) => entry.round === 0 && entry.side === "main" && !entry.isBye && entry.participantId)
      .sort((a, b) => a.position - b.position);
    const firstParticipant = seedSlots[0]!.participantId;
    seedSlots[0]!.participantId = seedSlots[1]!.participantId;
    seedSlots[1]!.participantId = firstParticipant;
    await db.update(tournaments).set({
      status: "bracket_generated",
      bracketJson: legacy,
      bracketConstructionAlgorithm: null,
    }).where(eq(tournaments.id, tournament!.id));
    const expectedPrefix = [
      roster[1]!.id,
      roster[0]!.id,
      roster[2]!.id,
    ];

    await services.tournaments.addParticipant({
      tournamentId: tournament!.id,
      actorUserId: organizer,
      userId: outsider,
      confirmBracketRegeneration: true,
      idempotencyKey: "00000000-0000-4000-8000-000000012106",
    });

    const regenerated = await services.tournaments.get(tournament!.id);
    expect((regenerated!.bracketJson as { seedOrder: string[] }).seedOrder.slice(0, 3))
      .toEqual(expectedPrefix);
  });

  it("rolls back participant, invitation closure, audit and bracket when regeneration fails", async () => {
    const tournament = await services.tournaments.create({
      title: "Fault-injected regeneration",
      format: "single_elimination",
      createdByUserId: organizer,
      organizerParticipates: false,
    });
    for (const userId of [playerA, playerB, playerC]) {
      await services.tournaments.addParticipant({
        tournamentId: tournament!.id,
        actorUserId: organizer,
        userId,
      });
    }
    await services.tournaments.generateBracket(tournament!.id, organizer, { rng: () => 0.5 });
    const [invitation] = await db.insert(tournamentInvitations).values({
      tournamentId: tournament!.id,
      invitedByUserId: organizer,
      invitedUserId: outsider,
      expiresAt: new Date("2026-09-14T18:00:00Z"),
      status: "pending",
    }).returning();
    await db.insert(notifications).values({
      userId: outsider,
      type: "tournament_invitation",
      title: "Приглашение в турнир",
      body: "Вас пригласили в турнир",
      payload: { invitationId: invitation!.id, tournamentId: tournament!.id },
    });
    const before = await services.tournaments.get(tournament!.id);
    const beforeAuditCount = (await db.query.auditLogs.findMany()).length;

    await db.execute(`
      CREATE FUNCTION gap012_fail_regeneration() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected bracket regeneration failure';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.execute(`
      CREATE TRIGGER gap012_fail_regeneration BEFORE UPDATE OF bracket_json ON tournaments
      FOR EACH ROW EXECUTE FUNCTION gap012_fail_regeneration();
    `);

    await expect(services.tournaments.addParticipant({
      tournamentId: tournament!.id,
      actorUserId: organizer,
      userId: outsider,
      confirmBracketRegeneration: true,
      idempotencyKey: "00000000-0000-4000-8000-000000012112",
    })).rejects.toThrow(/update "tournaments"/);

    const after = await services.tournaments.get(tournament!.id);
    expect(after).toMatchObject({
      bracketJson: before!.bracketJson,
      bracketStateVersion: before!.bracketStateVersion,
    });
    expect(after!.participants).toHaveLength(before!.participants.length);
    expect(after!.participants.some((participant) => participant.userId === outsider)).toBe(false);
    expect(await db.query.tournamentInvitations.findFirst({
      where: eq(tournamentInvitations.id, invitation!.id),
    })).toMatchObject({ status: "pending", respondedAt: null, terminalReason: null });
    expect(await services.notifications.unread(outsider)).toEqual([
      expect.objectContaining({
        type: "tournament_invitation",
        payload: expect.objectContaining({ invitationId: invitation!.id }),
      }),
    ]);
    expect(await db.query.auditLogs.findMany()).toHaveLength(beforeAuditCount);
  });
});
