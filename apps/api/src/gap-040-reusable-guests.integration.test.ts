import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { FakeClock } from "@tab10/test-utils";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import {
  auditLogs,
  authSessions,
  guestIdentities,
  matchParticipants,
  matches,
  tournamentParticipants,
  tournaments,
  users,
} from "./db/schema.js";
import { hashToken } from "./modules/auth/auth-service.js";

const NOW = new Date("2026-10-03T12:00:00.000Z");
const ACTOR = "00000000-0000-4000-8000-000000040001";
const ADMIN = "00000000-0000-4000-8000-000000040002";
const PLAYER = "00000000-0000-4000-8000-000000040003";
const SESSION = "00000000-0000-4000-8000-000000040011";
const CREATE_KEY = "00000000-0000-4000-8000-000000040101";
const RENAME_KEY = "00000000-0000-4000-8000-000000040102";
const LAUNCH_KEY = "00000000-0000-4000-8000-000000040103";

describe("D40 reusable guest identities", () => {
  let db: Db;
  let app: FastifyInstance;
  let services: AppServices;
  let closeDb: () => Promise<void>;

  beforeEach(async () => {
    const context = await createMigratedPgliteDb();
    db = context.db;
    closeDb = context.close;
    const built = await buildApp({ db, clock: new FakeClock(NOW), randomIndex: () => 0 });
    app = built.app;
    services = built.services;
    await db.insert(users).values([
      { id: ACTOR, email: "actor@gap040.test", passwordHash: "x", firstName: "Guest", lastName: "Creator", mustChangePassword: false },
      { id: ADMIN, email: "admin@gap040.test", passwordHash: "x", firstName: "Active", lastName: "Admin", role: "admin", mustChangePassword: false },
      { id: PLAYER, email: "player@gap040.test", passwordHash: "x", firstName: "Real", lastName: "Player", mustChangePassword: false },
    ]);
    await db.insert(authSessions).values({ id: SESSION, userId: ACTOR, tokenHash: hashToken("actor"), expiresAt: new Date("2026-10-04T12:00:00.000Z") });
  });

  afterEach(async () => {
    await app.close();
    await closeDb();
  });

  async function createGuest(requestId = CREATE_KEY, firstName = "Ada", lastName = "Lovelace") {
    return app.inject({
      method: "POST",
      url: "/api/v1/guests",
      cookies: { tab10_session: "actor" },
      headers: { "idempotency-key": requestId },
      payload: { requestId, firstName, lastName },
    });
  }

  it("creates once, reconciles actor-bound receipt, and replays after rename without using the mutable label", async () => {
    const created = await createGuest();
    expect(created.statusCode).toBe(200);
    const guestId = created.json().guest.id as string;
    expect(created.json().guest).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      version: 0,
      canRename: true,
      avatarKey: expect.stringMatching(/^avatar_([1-9]|10)$/),
    });
    expect(await db.query.auditLogs.findMany({ where: eq(auditLogs.entityId, guestId) }))
      .toEqual([expect.objectContaining({
        action: "guest_identity.created",
        entityType: "guest_identity",
        meta: expect.objectContaining({
          newFirstName: "Ada",
          newLastName: "Lovelace",
          resultingVersion: 0,
        }),
      })]);

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/v1/guests/${guestId}`,
      cookies: { tab10_session: "actor" },
      headers: { "idempotency-key": RENAME_KEY },
      payload: { requestId: RENAME_KEY, expectedVersion: 0, firstName: "Ada", lastName: "Byron" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().guest).toMatchObject({ lastName: "Byron", version: 1 });

    const replay = await createGuest();
    expect(replay.statusCode).toBe(200);
    expect(replay.json().guest).toMatchObject({ id: guestId, lastName: "Byron", version: 1 });
    expect(await db.select().from(guestIdentities)).toHaveLength(1);
    expect(await db.query.auditLogs.findMany({ where: eq(auditLogs.entityId, guestId) }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ action: "guest_identity.created" }),
        expect.objectContaining({
          action: "guest_identity.renamed",
          meta: expect.objectContaining({
            oldFirstName: "Ada",
            oldLastName: "Lovelace",
            newFirstName: "Ada",
            newLastName: "Byron",
            resultingVersion: 1,
          }),
        }),
      ]));
    expect(await db.query.auditLogs.findMany({ where: eq(auditLogs.entityId, guestId) })).toHaveLength(2);

    const outcome = await app.inject({
      method: "GET",
      url: `/api/v1/guests/requests/${CREATE_KEY}`,
      cookies: { tab10_session: "actor" },
    });
    expect(outcome.headers["cache-control"]).toBe("no-store");
    expect(outcome.json()).toMatchObject({ outcome: "committed", operation: "create", guestId, resultingVersion: 0 });
  });

  it("allows only the creator or an active admin to rename", async () => {
    const guestId = (await createGuest()).json().guest.id as string;
    await expect(services.guests.rename({
      actorUserId: PLAYER,
      guestId,
      requestId: "00000000-0000-4000-8000-000000040106",
      expectedVersion: 0,
      firstName: "Ada",
      lastName: "Denied",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(services.guests.rename({
      actorUserId: ADMIN,
      guestId,
      requestId: "00000000-0000-4000-8000-000000040107",
      expectedVersion: 0,
      firstName: "Ada",
      lastName: "Admin rename",
    })).resolves.toMatchObject({ version: 1, lastName: "Admin rename" });
  });

  it("binds catalogue cursors to search and snapshots identity into atomic launch", async () => {
    const guestId = (await createGuest()).json().guest.id as string;
    await createGuest("00000000-0000-4000-8000-000000040104", "Grace", "Hopper");
    const firstPage = await app.inject({ method: "GET", url: "/api/v1/guests?q=a&limit=1", cookies: { tab10_session: "actor" } });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().guests).toHaveLength(1);
    const wrongQuery = await app.inject({ method: "GET", url: `/api/v1/guests?q=b&limit=1&cursor=${encodeURIComponent(firstPage.json().nextCursor)}`, cookies: { tab10_session: "actor" } });
    expect(wrongQuery.statusCode).toBe(400);

    const launched = await app.inject({
      method: "POST",
      url: "/api/v1/matches/launches",
      cookies: { tab10_session: "actor" },
      headers: { "idempotency-key": LAUNCH_KEY },
      payload: {
        requestId: LAUNCH_KEY,
        format: "1v1",
        firstServerMethod: "manual",
        firstServerSlot: "A1",
        roster: { A1: { guestIdentityId: guestId }, B1: { userId: PLAYER } },
      },
    });
    expect(launched.statusCode).toBe(200);
    const participant = await db.query.matchParticipants.findFirst({
      where: eq(matchParticipants.guestIdentityId, guestId),
    });
    expect(participant).toMatchObject({ guestIdentityId: guestId, guestFirstName: "Ada", guestLastName: "Lovelace", guestAvatarKey: expect.any(String) });
    await services.guests.rename({
      actorUserId: ACTOR,
      guestId,
      requestId: "00000000-0000-4000-8000-000000040108",
      expectedVersion: 0,
      firstName: "Ada",
      lastName: "Byron",
    });
    expect(await db.query.matchParticipants.findFirst({ where: eq(matchParticipants.guestIdentityId, guestId) }))
      .toMatchObject({ guestLastName: "Lovelace" });
  });

  it("keeps distinct same-name identities distinct in tournaments and history", async () => {
    const firstId = (await createGuest()).json().guest.id as string;
    const secondId = (await createGuest("00000000-0000-4000-8000-000000040105")).json().guest.id as string;
    const [tournament] = await db.insert(tournaments).values({
      title: "Guests cup",
      createdByUserId: ACTOR,
      status: "collecting",
      organizerParticipates: false,
    }).returning();
    await services.tournaments.addParticipant({ tournamentId: tournament!.id, actorUserId: ACTOR, guestIdentityId: firstId });
    await services.tournaments.addParticipant({ tournamentId: tournament!.id, actorUserId: ACTOR, guestIdentityId: secondId });
    const roster = await db.query.tournamentParticipants.findMany({ where: eq(tournamentParticipants.tournamentId, tournament!.id) });
    expect(new Set(roster.map((row) => row.guestIdentityId))).toEqual(new Set([firstId, secondId]));

    await db.insert(matches).values({ id: "00000000-0000-4000-8000-000000040201", title: "Terminal", createdByUserId: ACTOR, status: "finished", winnerSide: "A", finishedAt: NOW });
    await db.insert(matchParticipants).values([
      { matchId: "00000000-0000-4000-8000-000000040201", side: "A", guestIdentityId: firstId, guestFirstName: "Ada", guestLastName: "Lovelace", guestAvatarKey: "avatar_1" },
      { matchId: "00000000-0000-4000-8000-000000040201", side: "B", userId: PLAYER },
    ]);
    await db.insert(matches).values([
      { id: "00000000-0000-4000-8000-000000040202", title: "Active hidden", createdByUserId: ACTOR, status: "in_progress" },
      { id: "00000000-0000-4000-8000-000000040203", title: "Tutorial hidden", createdByUserId: ACTOR, status: "finished", kind: "tutorial", winnerSide: "A", finishedAt: NOW },
    ]);
    await db.insert(matchParticipants).values([
      { matchId: "00000000-0000-4000-8000-000000040202", side: "A", guestIdentityId: firstId, guestFirstName: "Ada", guestLastName: "Lovelace", guestAvatarKey: "avatar_1" },
      { matchId: "00000000-0000-4000-8000-000000040202", side: "B", userId: PLAYER },
      { matchId: "00000000-0000-4000-8000-000000040203", side: "A", guestIdentityId: firstId, guestFirstName: "Ada", guestLastName: "Lovelace", guestAvatarKey: "avatar_1" },
      { matchId: "00000000-0000-4000-8000-000000040203", side: "B", userId: PLAYER },
    ]);
    const history = await app.inject({ method: "GET", url: `/api/v1/guests/${firstId}/history`, cookies: { tab10_session: "actor" } });
    const otherHistory = await app.inject({ method: "GET", url: `/api/v1/guests/${secondId}/history`, cookies: { tab10_session: "actor" } });
    expect(history.statusCode).toBe(200);
    expect(history.json().items).toEqual([expect.objectContaining({ type: "match", result: "win" })]);
    expect(otherHistory.json().items).toEqual([]);
  });

  it("paginates 23 timestamp-tied terminal events without leaks, duplicates or omissions", async () => {
    const firstId = (await createGuest()).json().guest.id as string;
    const secondId = (await createGuest("00000000-0000-4000-8000-000000040109")).json().guest.id as string;
    const terminalMatches = Array.from({ length: 23 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(40220 + index).padStart(12, "0")}`,
      title: `History ${index}`,
      createdByUserId: ACTOR,
      status: "finished" as const,
      winnerSide: "A",
      finishedAt: NOW,
    }));
    await db.insert(matches).values(terminalMatches);
    await db.insert(matchParticipants).values(terminalMatches.flatMap((match) => [
      { matchId: match.id, side: "A", guestIdentityId: firstId, guestFirstName: "Ada", guestLastName: "Lovelace", guestAvatarKey: "avatar_1" },
      { matchId: match.id, side: "B", userId: PLAYER },
    ]));

    const first = await app.inject({ method: "GET", url: `/api/v1/guests/${firstId}/history`, cookies: { tab10_session: "actor" } });
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(20);
    expect(first.json().nextCursor).toEqual(expect.any(String));
    const second = await app.inject({ method: "GET", url: `/api/v1/guests/${firstId}/history?cursor=${encodeURIComponent(first.json().nextCursor)}`, cookies: { tab10_session: "actor" } });
    expect(second.statusCode).toBe(200);
    expect(second.json().items).toHaveLength(3);
    expect(second.json().nextCursor).toBeNull();
    const ids = [...first.json().items, ...second.json().items].map((item: { id: string }) => item.id);
    expect(ids).toEqual([...terminalMatches].sort((left, right) => right.id.localeCompare(left.id)).map((match) => match.id));
    expect(new Set(ids).size).toBe(23);

    const malformed = await app.inject({ method: "GET", url: `/api/v1/guests/${firstId}/history?cursor=not-a-cursor`, cookies: { tab10_session: "actor" } });
    expect(malformed.statusCode).toBe(400);
    const wrongGuest = await app.inject({ method: "GET", url: `/api/v1/guests/${secondId}/history?cursor=${encodeURIComponent(first.json().nextCursor)}`, cookies: { tab10_session: "actor" } });
    expect(wrongGuest.statusCode).toBe(400);
    expect(wrongGuest.json()).not.toHaveProperty("items");
  });
});
