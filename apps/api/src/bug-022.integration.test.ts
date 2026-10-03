import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import {
  authSessions,
  tournamentInvitations,
  tournamentParticipants,
  tournaments,
  users,
} from "./db/schema.js";
import { hashToken } from "./modules/auth/auth-service.js";

describe("BUG-022 version-fenced bracket generation", () => {
  let db: Db;
  let app: FastifyInstance;
  let services: AppServices;
  let closeDb: () => Promise<void>;

  const organizer = "00000000-0000-4000-8000-000000022001";
  const playerA = "00000000-0000-4000-8000-000000022002";
  const playerB = "00000000-0000-4000-8000-000000022003";
  const playerC = "00000000-0000-4000-8000-000000022004";
  const invitee = "00000000-0000-4000-8000-000000022005";
  const admin = "00000000-0000-4000-8000-000000022006";
  const cookies = (token: string) => ({ tab10_session: token });

  beforeEach(async () => {
    const context = await createMigratedPgliteDb();
    db = context.db;
    closeDb = context.close;
    const built = await buildApp({
      db,
      clock: new FakeClock(new Date("2026-10-03T12:00:00.000Z")),
      randomIndex: () => 0,
    });
    app = built.app;
    services = built.services;
    await db.insert(users).values([
      { id: organizer, email: "organizer@bug022.test", passwordHash: "x", firstName: "Bracket", lastName: "Owner", mustChangePassword: false },
      { id: playerA, email: "a@bug022.test", passwordHash: "x", firstName: "A", lastName: "Player", mustChangePassword: false },
      { id: playerB, email: "b@bug022.test", passwordHash: "x", firstName: "B", lastName: "Player", mustChangePassword: false },
      { id: playerC, email: "c@bug022.test", passwordHash: "x", firstName: "C", lastName: "Player", mustChangePassword: false },
      { id: invitee, email: "invitee@bug022.test", passwordHash: "x", firstName: "Invited", lastName: "Player", mustChangePassword: false },
      { id: admin, email: "admin@bug022.test", passwordHash: "x", firstName: "Active", lastName: "Admin", role: "admin", mustChangePassword: false },
    ]);
    for (const [userId, token] of [[organizer, "organizer"], [playerA, "player"], [invitee, "invitee"], [admin, "admin"]] as const) {
      await db.insert(authSessions).values({
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date("2026-10-04T12:00:00.000Z"),
      });
    }
  });

  afterEach(async () => {
    await app.close();
    await closeDb();
  });

  async function createRoster() {
    const tournament = await services.tournaments.create({
      title: "Version fence",
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
    return (await services.tournaments.get(tournament!.id))!;
  }

  it("exposes organizer-only context, rejects legacy generation, and validates the new request before writes", async () => {
    const tournament = await createRoster();
    const invitation = await services.tournaments.invite({
      tournamentId: tournament.id,
      invitedUserId: invitee,
      invitedByUserId: organizer,
    });
    const before = await services.tournaments.get(tournament.id);

    const context = await app.inject({
      method: "GET",
      url: `/api/v1/tournaments/${tournament.id}/bracket-generation-context`,
      cookies: cookies("organizer"),
    });
    expect(context.statusCode).toBe(200);
    expect(context.json().tournament).toMatchObject({
      id: tournament.id,
      bracketStateVersion: before!.bracketStateVersion,
    });

    for (const token of ["player", "admin"]) {
      const forbidden = await app.inject({
        method: "GET",
        url: `/api/v1/tournaments/${tournament.id}/bracket-generation-context`,
        cookies: cookies(token),
      });
      expect(forbidden.statusCode, token).toBe(403);
    }
    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/tournaments/00000000-0000-4000-8000-000000022099/bracket-generation-context",
      cookies: cookies("organizer"),
    });
    expect(missing.statusCode).toBe(404);

    const legacy = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${tournament.id}/bracket`,
      cookies: cookies("organizer"),
      payload: { constructionAlgorithm: "compact" },
    });
    expect(legacy.statusCode).toBe(409);
    expect(legacy.json()).toMatchObject({
      code: "VERSIONED_BRACKET_GENERATION_REQUIRED",
      message: "Обновите страницу, чтобы построить сетку",
    });
    for (const token of ["player", "admin"]) {
      const forbidden = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tournament.id}/bracket`,
        cookies: cookies(token),
        payload: {},
      });
      expect(forbidden.statusCode, token).toBe(403);
    }
    const legacyMissing = await app.inject({
      method: "POST",
      url: "/api/v1/tournaments/00000000-0000-4000-8000-000000022099/bracket",
      cookies: cookies("organizer"),
      payload: {},
    });
    expect(legacyMissing.statusCode).toBe(404);

    for (const payload of [
      { constructionAlgorithm: "compact" },
      { expectedVersion: -1, constructionAlgorithm: "compact" },
      { expectedVersion: 1.5, constructionAlgorithm: "compact" },
      { expectedVersion: before!.bracketStateVersion, constructionAlgorithm: "compact", extra: true },
    ]) {
      const invalid = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tournament.id}/bracket-generations`,
        cookies: cookies("organizer"),
        payload,
      });
      expect(invalid.statusCode, JSON.stringify(payload)).toBe(400);
      expect(invalid.json()).toMatchObject({ code: "VALIDATION" });
    }
    expect(await services.tournaments.get(tournament.id)).toMatchObject({
      bracketJson: before!.bracketJson,
      bracketStateVersion: before!.bracketStateVersion,
      status: before!.status,
    });
    expect(await db.query.tournamentParticipants.findMany({
      where: eq(tournamentParticipants.tournamentId, tournament.id),
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ seed: null, status: "active" }),
    ]));
    expect(await db.query.tournamentInvitations.findFirst({
      where: eq(tournamentInvitations.id, invitation!.id),
    })).toMatchObject({ status: "pending", respondedAt: null, terminalReason: null });
  });

  it("generates once for an exact version and rejects a stale duplicate without persisted changes", async () => {
    const tournament = await createRoster();
    const generated = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${tournament.id}/bracket-generations`,
      cookies: cookies("organizer"),
      payload: {
        expectedVersion: tournament.bracketStateVersion,
        constructionAlgorithm: "compact",
      },
    });
    expect(generated.statusCode).toBe(200);
    expect(generated.json().tournament).toMatchObject({
      id: tournament.id,
      status: "bracket_generated",
      bracketStateVersion: tournament.bracketStateVersion + 1,
    });
    const snapshot = await services.tournaments.get(tournament.id);

    const stale = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${tournament.id}/bracket-generations`,
      cookies: cookies("organizer"),
      payload: {
        expectedVersion: tournament.bracketStateVersion,
        constructionAlgorithm: "power_of_two",
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "BRACKET_VERSION_CONFLICT" });
    expect(await services.tournaments.get(tournament.id)).toMatchObject({
      bracketJson: snapshot!.bracketJson,
      bracketStateVersion: snapshot!.bracketStateVersion,
      status: snapshot!.status,
    });
  });

  it("keeps an empty, same-slot, or net-zero bracket patch from invalidating the generation fence", async () => {
    const tournament = await createRoster();
    await services.tournaments.generateBracketVersioned(tournament.id, organizer, {
      expectedVersion: tournament.bracketStateVersion,
      constructionAlgorithm: "compact",
      rng: () => 0.5,
    });
    const context = await app.inject({
      method: "GET",
      url: `/api/v1/tournaments/${tournament.id}/bracket-generation-context`,
      cookies: cookies("organizer"),
    });
    expect(context.statusCode).toBe(200);
    const expectedVersion = context.json().tournament.bracketStateVersion as number;
    const before = await services.tournaments.get(tournament.id);
    const seedsBefore = before!.participants.map(({ id, seed }) => ({ id, seed }));

    for (const swaps of [
      [],
      [{ slotIdA: "seed:1", slotIdB: "seed:1" }],
      [
        { slotIdA: "seed:1", slotIdB: "seed:2" },
        { slotIdA: "seed:1", slotIdB: "seed:2" },
      ],
    ]) {
      const patched = await app.inject({
        method: "PATCH",
        url: `/api/v1/tournaments/${tournament.id}/bracket`,
        cookies: cookies("organizer"),
        payload: { swaps },
      });
      expect(patched.statusCode, JSON.stringify(swaps)).toBe(200);
      const afterPatch = await services.tournaments.get(tournament.id);
      expect(afterPatch).toMatchObject({
        bracketJson: before!.bracketJson,
        bracketStateVersion: expectedVersion,
      });
      expect(afterPatch!.participants.map(({ id, seed }) => ({ id, seed }))).toEqual(seedsBefore);
    }

    const generated = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${tournament.id}/bracket-generations`,
      cookies: cookies("organizer"),
      payload: { expectedVersion, constructionAlgorithm: "compact" },
    });
    expect(generated.statusCode).toBe(200);
    expect(generated.json().tournament.bracketStateVersion).toBe(expectedVersion + 1);
  });

  it("heals the organizer only through the locked context and makes the prior version stale", async () => {
    const tournament = await services.tournaments.create({
      title: "Heal under lock",
      format: "single_elimination",
      createdByUserId: organizer,
      organizerParticipates: true,
    });
    const organizerParticipant = tournament!.participants.find((participant) => participant.userId === organizer)!;
    await db.delete(tournamentParticipants).where(eq(tournamentParticipants.id, organizerParticipant.id));
    const versionBefore = tournament!.bracketStateVersion;

    await services.tournaments.get(tournament!.id);
    expect(await db.query.tournamentParticipants.findMany({
      where: and(
        eq(tournamentParticipants.tournamentId, tournament!.id),
        eq(tournamentParticipants.userId, organizer),
      ),
    })).toHaveLength(0);

    const context = await app.inject({
      method: "GET",
      url: `/api/v1/tournaments/${tournament!.id}/bracket-generation-context`,
      cookies: cookies("organizer"),
    });
    expect(context.statusCode).toBe(200);
    expect(context.json().tournament).toMatchObject({
      bracketStateVersion: versionBefore + 1,
      participants: expect.arrayContaining([expect.objectContaining({ userId: organizer, status: "active" })]),
    });
    const stale = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${tournament!.id}/bracket-generations`,
      cookies: cookies("organizer"),
      payload: { expectedVersion: versionBefore, constructionAlgorithm: "compact" },
    });
    expect(stale.statusCode).toBe(409);
  });

  it("bumps only actual generation inputs and keeps admin rebuild at one atomic increment", async () => {
    const tournament = await createRoster();
    const addKey = "00000000-0000-4000-8000-000000022111";
    const added = await services.tournaments.addParticipant({
      tournamentId: tournament.id,
      actorUserId: organizer,
      userId: invitee,
      idempotencyKey: addKey,
    });
    const afterAdd = (await services.tournaments.get(tournament.id))!;
    expect(afterAdd.bracketStateVersion).toBe(tournament.bracketStateVersion + 1);
    await services.tournaments.addParticipant({
      tournamentId: tournament.id,
      actorUserId: organizer,
      userId: invitee,
      idempotencyKey: addKey,
    });
    expect((await services.tournaments.get(tournament.id))!.bracketStateVersion).toBe(afterAdd.bracketStateVersion);

    await services.tournaments.patch(tournament.id, organizer, {
      title: "Metadata only",
      pointsToWin: 21,
      mercyEnabled: false,
      organizerParticipates: false,
      format: "single_elimination",
    });
    expect((await services.tournaments.get(tournament.id))!.bracketStateVersion).toBe(afterAdd.bracketStateVersion);
    await services.tournaments.patch(tournament.id, organizer, { organizerParticipates: true });
    const afterOrganizer = (await services.tournaments.get(tournament.id))!;
    expect(afterOrganizer.bracketStateVersion).toBe(afterAdd.bracketStateVersion + 1);
    await services.tournaments.patch(tournament.id, organizer, { format: "double_elimination" });
    const afterFormat = (await services.tournaments.get(tournament.id))!;
    expect(afterFormat.bracketStateVersion).toBe(afterOrganizer.bracketStateVersion + 1);
    await services.tournaments.patch(tournament.id, organizer, { format: "double_elimination" });
    expect((await services.tournaments.get(tournament.id))!.bracketStateVersion).toBe(afterFormat.bracketStateVersion);
    await services.tournaments.patch(tournament.id, organizer, { format: "single_elimination" });
    const restoredFormat = (await services.tournaments.get(tournament.id))!;
    expect(restoredFormat.bracketStateVersion).toBe(afterFormat.bracketStateVersion + 1);

    const invitation = await services.tournaments.invite({
      tournamentId: tournament.id,
      invitedUserId: admin,
      invitedByUserId: organizer,
    });
    expect((await services.tournaments.get(tournament.id))!.bracketStateVersion).toBe(restoredFormat.bracketStateVersion);
    await services.tournaments.respondInvitation({ invitationId: invitation!.id, userId: admin, accept: false });
    expect((await services.tournaments.get(tournament.id))!.bracketStateVersion).toBe(restoredFormat.bracketStateVersion);

    await services.tournaments.generateBracketVersioned(tournament.id, organizer, {
      expectedVersion: restoredFormat.bracketStateVersion,
      constructionAlgorithm: "compact",
      rng: () => 0.5,
    });
    const generated = (await services.tournaments.get(tournament.id))!;
    await services.tournaments.addParticipant({
      tournamentId: tournament.id,
      actorUserId: admin,
      userId: playerA,
      confirmManualOverride: true,
      confirmBracketRegeneration: true,
      idempotencyKey: "00000000-0000-4000-8000-000000022112",
    }).catch((error: unknown) => {
      expect(error).toMatchObject({ code: "ALREADY_IN_TOURNAMENT" });
    });
    expect((await services.tournaments.get(tournament.id))!.bracketStateVersion).toBe(generated.bracketStateVersion);

    const freshUser = "00000000-0000-4000-8000-000000022007";
    await db.insert(users).values({ id: freshUser, email: "fresh@bug022.test", passwordHash: "x", firstName: "Fresh", lastName: "Player", mustChangePassword: false });
    await services.tournaments.addParticipant({
      tournamentId: tournament.id,
      actorUserId: admin,
      userId: freshUser,
      confirmManualOverride: true,
      confirmBracketRegeneration: true,
      idempotencyKey: "00000000-0000-4000-8000-000000022113",
    });
    const rebuilt = (await services.tournaments.get(tournament.id))!;
    expect(rebuilt.bracketStateVersion).toBe(generated.bracketStateVersion + 1);
    expect(rebuilt.status).toBe("bracket_generated");
  });

  it("increments acceptance/removal once and starts after pre-generation version bumps", async () => {
    const tournament = await createRoster();
    const invitation = await services.tournaments.invite({
      tournamentId: tournament.id,
      invitedUserId: invitee,
      invitedByUserId: organizer,
    });
    const beforeAccept = (await services.tournaments.get(tournament.id))!;
    await services.tournaments.respondInvitation({ invitationId: invitation!.id, userId: invitee, accept: true });
    const accepted = (await services.tournaments.get(tournament.id))!;
    expect(accepted.bracketStateVersion).toBe(beforeAccept.bracketStateVersion + 1);
    expect(await db.query.tournamentInvitations.findFirst({ where: eq(tournamentInvitations.id, invitation!.id) })).toMatchObject({ status: "accepted" });

    const acceptedParticipant = accepted.participants.find((participant) => participant.userId === invitee)!;
    await services.tournaments.removeParticipant({ tournamentId: tournament.id, participantId: acceptedParticipant.id, actorUserId: organizer });
    const removed = (await services.tournaments.get(tournament.id))!;
    expect(removed.bracketStateVersion).toBe(accepted.bracketStateVersion + 1);
    await services.tournaments.removeParticipant({ tournamentId: tournament.id, participantId: acceptedParticipant.id, actorUserId: organizer });
    expect((await services.tournaments.get(tournament.id))!.bracketStateVersion).toBe(removed.bracketStateVersion);

    await services.tournaments.withdraw({ tournamentId: tournament.id, userId: playerC });
    const withdrawn = (await services.tournaments.get(tournament.id))!;
    expect(withdrawn.bracketStateVersion).toBe(removed.bracketStateVersion + 1);
    await services.tournaments.addParticipant({ tournamentId: tournament.id, actorUserId: organizer, userId: playerC });
    const restored = (await services.tournaments.get(tournament.id))!;
    expect(restored.bracketStateVersion).toBe(withdrawn.bracketStateVersion + 1);

    await services.tournaments.generateBracketVersioned(tournament.id, organizer, {
      expectedVersion: restored.bracketStateVersion,
      constructionAlgorithm: "compact",
      rng: () => 0.5,
    });
    const beforeStart = (await services.tournaments.get(tournament.id))!;
    const started = await services.tournaments.start(tournament.id, organizer);
    expect(started).toMatchObject({
      status: "in_progress",
      bracketStateVersion: beforeStart.bracketStateVersion + 1,
    });
    expect(started!.matches.length).toBeGreaterThan(0);
  });
});
