import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { FakeClock } from "@tab10/test-utils";
import { generateSingleEliminationBracket } from "@tab10/shared";
import { buildApp } from "./app.js";
import { createPostgresDb, type Db } from "./db/client.js";
import { runPostgresMigrations } from "./db/migrations.js";
import { resolveTestDatabaseUrl } from "./db/test-database-url.js";
import {
  auditLogs,
  authSessions,
  guestIdentities,
  guestIdentityRequests,
  matchParticipants,
  matches,
  tournamentParticipants,
  tournaments,
  users,
} from "./db/schema.js";
import * as schema from "./db/schema.js";
import { hashToken } from "./modules/auth/auth-service.js";

const databaseUrl = resolveTestDatabaseUrl(process.env, { required: process.env.REQUIRE_TEST_DATABASE_URL === "1" });
const postgresSuite = databaseUrl ? describe : describe.skip;
const ACTOR = "00000000-0000-4000-8000-000000040301";
const ADMIN = "00000000-0000-4000-8000-000000040302";
const CREATE_KEY = "00000000-0000-4000-8000-000000040311";

postgresSuite.sequential("D40 PostgreSQL reusable guest serialization", () => {
  const clients: postgres.Sql[] = [];
  const apps: Array<Awaited<ReturnType<typeof buildApp>>["app"]> = [];
  let db: Db;
  let closeDb: () => Promise<void>;

  async function isolated(name: string) {
    const client = postgres(databaseUrl!, { max: 1, connection: { application_name: name } });
    clients.push(client);
    const built = await buildApp({ db: drizzle(client, { schema }) as unknown as Db, clock: new FakeClock(new Date("2026-10-03T12:00:00.000Z")) });
    apps.push(built.app);
    return built.services.guests;
  }

  async function isolatedApp(name: string) {
    const client = postgres(databaseUrl!, { max: 1, connection: { application_name: name } });
    clients.push(client);
    const built = await buildApp({ db: drizzle(client, { schema }) as unknown as Db, clock: new FakeClock(new Date("2026-10-03T12:00:00.000Z")) });
    apps.push(built.app);
    return built;
  }

  async function createReusableGuest(
    services: Awaited<ReturnType<typeof buildApp>>["services"],
    requestSuffix: number,
    firstName: string,
    lastName: string,
  ) {
    return services.guests.create({
      actorUserId: ACTOR,
      requestId: `00000000-0000-4000-8000-${String(requestSuffix).padStart(12, "0")}`,
      firstName,
      lastName,
    });
  }

  async function findTournamentMatchWithGuest(tournamentId: string, guestId: string) {
    const rows = await db.query.matches.findMany({ where: eq(matches.tournamentId, tournamentId) });
    for (const match of rows) {
      const participants = await db.query.matchParticipants.findMany({ where: eq(matchParticipants.matchId, match.id) });
      if (participants.some((participant) => participant.guestIdentityId === guestId)) {
        return { match, participants };
      }
    }
    throw new Error(`No materialized match for guest ${guestId}`);
  }

  beforeAll(async () => {
    const reset = postgres(databaseUrl!, { max: 1 });
    try { await reset.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public"); }
    finally { await reset.end({ timeout: 5 }); }
    await runPostgresMigrations(databaseUrl!, "apply");
    const context = await createPostgresDb(databaseUrl!);
    db = context.db;
    closeDb = context.close;
    await db.insert(users).values([
      { id: ACTOR, email: "actor-gap040-pg@test.local", passwordHash: "x", firstName: "Actor", lastName: "Guest", mustChangePassword: false },
      { id: ADMIN, email: "admin-gap040-pg@test.local", passwordHash: "x", firstName: "Admin", lastName: "Guest", role: "admin", mustChangePassword: false },
    ]);
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await Promise.all(clients.map((client) => client.end({ timeout: 5 })));
    await closeDb?.();
  });

  it("serializes concurrent same-key create into one identity and one receipt", async () => {
    const first = await isolated("gap040_create_first");
    const second = await isolated("gap040_create_second");
    const input = { actorUserId: ACTOR, requestId: CREATE_KEY, firstName: "Ada", lastName: "Lovelace" };
    const [a, b] = await Promise.all([first.create(input), second.create(input)]);
    expect(b.id).toBe(a.id);
    expect(await db.query.guestIdentities.findMany({ where: eq(guestIdentities.createdByUserId, ACTOR) })).toHaveLength(1);
    expect(await db.query.guestIdentityRequests.findMany({ where: eq(guestIdentityRequests.requestId, CREATE_KEY) })).toHaveLength(1);
    expect(await db.query.auditLogs.findMany({ where: eq(auditLogs.entityId, a.id) })).toEqual([
      expect.objectContaining({ action: "guest_identity.created" }),
    ]);
  });

  it("fences concurrent rename and leaves exactly one committed version", async () => {
    const first = await isolated("gap040_rename_first");
    const second = await isolated("gap040_rename_second");
    const guest = await db.query.guestIdentities.findFirst({ where: eq(guestIdentities.createdByUserId, ACTOR) });
    const results = await Promise.allSettled([
      first.rename({ actorUserId: ACTOR, guestId: guest!.id, requestId: "00000000-0000-4000-8000-000000040312", expectedVersion: 0, firstName: "Ada", lastName: "Byron" }),
      second.rename({ actorUserId: ACTOR, guestId: guest!.id, requestId: "00000000-0000-4000-8000-000000040313", expectedVersion: 0, firstName: "Ada", lastName: "King" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "VERSION_CONFLICT" });
    expect(await db.query.guestIdentities.findFirst({ where: eq(guestIdentities.id, guest!.id) })).toMatchObject({ version: 1 });
    expect(await db.query.auditLogs.findMany({ where: eq(auditLogs.entityId, guest!.id) }))
      .toHaveLength(2);
  });

  it("rolls identity creation back when the receipt write fails", async () => {
    const control = postgres(databaseUrl!, { max: 1 });
    clients.push(control);
    await control.unsafe(`
      CREATE OR REPLACE FUNCTION gap040_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END;
      $$;
      CREATE TRIGGER gap040_fail_receipt_trigger BEFORE INSERT ON guest_identity_requests
      FOR EACH ROW EXECUTE FUNCTION gap040_fail_receipt();
    `);
    try {
      const service = await isolated("gap040_receipt_rollback");
      const existing = await db.query.guestIdentities.findFirst({ where: eq(guestIdentities.createdByUserId, ACTOR) });
      const beforeRenameAudits = await db.query.auditLogs.findMany({ where: eq(auditLogs.entityId, existing!.id) });
      await expect(service.rename({
        actorUserId: ADMIN,
        guestId: existing!.id,
        requestId: "00000000-0000-4000-8000-000000040315",
        expectedVersion: existing!.version,
        firstName: existing!.firstName,
        lastName: "Must roll back",
      })).rejects.toThrow();
      expect(await db.query.guestIdentities.findFirst({ where: eq(guestIdentities.id, existing!.id) }))
        .toMatchObject({ version: existing!.version, lastName: existing!.lastName });
      expect(await db.query.auditLogs.findMany({ where: eq(auditLogs.entityId, existing!.id) }))
        .toHaveLength(beforeRenameAudits.length);
      await expect(service.create({ actorUserId: ADMIN, requestId: "00000000-0000-4000-8000-000000040314", firstName: "Rollback", lastName: "Guest" })).rejects.toThrow();
      expect(await db.query.guestIdentities.findMany({ where: eq(guestIdentities.createdByUserId, ADMIN) })).toHaveLength(0);
      expect(await db.query.auditLogs.findMany({ where: eq(auditLogs.actorUserId, ADMIN) })).toHaveLength(0);
    } finally {
      await control.unsafe(`
        DROP TRIGGER gap040_fail_receipt_trigger ON guest_identity_requests;
        DROP FUNCTION gap040_fail_receipt();
      `);
    }
  });

  it("materializes and advances exact reusable identities in a V1 same-name bracket", async () => {
    const setup = await isolatedApp("gap040_v1_identity_advancement");
    const guests = await Promise.all([
      createReusableGuest(setup.services, 40401, "Same", "Name"),
      createReusableGuest(setup.services, 40402, "Same", "Name"),
      createReusableGuest(setup.services, 40403, "Third", "Guest"),
      createReusableGuest(setup.services, 40404, "Fourth", "Guest"),
    ]);
    const tournament = await setup.services.tournaments.create({
      title: "V1 reusable guests",
      format: "single_elimination",
      createdByUserId: ACTOR,
      organizerParticipates: false,
    });
    const roster = [];
    for (const guest of guests) {
      roster.push(await setup.services.tournaments.addParticipant({
        tournamentId: tournament!.id,
        actorUserId: ACTOR,
        guestIdentityId: guest.id,
      }));
    }
    let slot = 0;
    const bracket = generateSingleEliminationBracket(roster.map((participant) => participant!.id), () => `gap040_v1_${++slot}`);
    await db.update(tournaments).set({
      status: "bracket_generated",
      bracketJson: bracket,
      bracketConstructionAlgorithm: null,
    }).where(eq(tournaments.id, tournament!.id));
    await setup.services.tournaments.start(tournament!.id, ACTOR);

    const materialized = await findTournamentMatchWithGuest(tournament!.id, guests[0]!.id);
    expect(materialized.participants.map((participant) => participant.guestIdentityId))
      .toEqual(expect.arrayContaining([guests[0]!.id, guests[1]!.id]));
    const winner = materialized.participants.find((participant) => participant.guestIdentityId === guests[0]!.id)!;
    await db.update(matches).set({ status: "finished", winnerSide: winner.side, finishedAt: new Date("2026-10-03T12:10:00.000Z") })
      .where(eq(matches.id, materialized.match.id));
    await setup.services.tournaments.onMatchFinished(materialized.match.id, db);

    const targetSlotId = bracket.slots.find((bracketSlot) => bracketSlot.participantId === roster[0]!.id)!.advancesToSlotId;
    const advanced = await db.query.tournaments.findFirst({ where: eq(tournaments.id, tournament!.id) });
    const target = (advanced!.bracketJson as typeof bracket).slots.find((bracketSlot) => bracketSlot.id === targetSlotId);
    expect(target?.participantId).toBe(roster[0]!.id);
    expect(target?.participantId).not.toBe(roster[1]!.id);
  });

  it("materializes and advances exact reusable identities in a V2 same-name bracket", async () => {
    const setup = await isolatedApp("gap040_v2_identity_advancement");
    const guests = await Promise.all([
      createReusableGuest(setup.services, 40411, "Twin", "Guest"),
      createReusableGuest(setup.services, 40412, "Twin", "Guest"),
      createReusableGuest(setup.services, 40413, "Other", "Three"),
      createReusableGuest(setup.services, 40414, "Other", "Four"),
    ]);
    const tournament = await setup.services.tournaments.create({
      title: "V2 reusable guests",
      format: "single_elimination",
      createdByUserId: ACTOR,
      organizerParticipates: false,
    });
    const roster = [];
    for (const guest of guests) {
      roster.push(await setup.services.tournaments.addParticipant({ tournamentId: tournament!.id, actorUserId: ACTOR, guestIdentityId: guest.id }));
    }
    const beforeGenerate = await setup.services.tournaments.get(tournament!.id);
    await setup.services.tournaments.generateBracketVersioned(tournament!.id, ACTOR, {
      expectedVersion: beforeGenerate!.bracketStateVersion,
      constructionAlgorithm: "compact",
      rng: () => 0.999,
    });
    await setup.services.tournaments.start(tournament!.id, ACTOR);

    const materialized = await findTournamentMatchWithGuest(tournament!.id, guests[0]!.id);
    expect(materialized.match.tournamentBracketMatchId).toEqual(expect.any(String));
    const winner = materialized.participants.find((participant) => participant.guestIdentityId === guests[0]!.id)!;
    await db.update(matches).set({ status: "finished", winnerSide: winner.side, finishedAt: new Date("2026-10-03T12:20:00.000Z") })
      .where(eq(matches.id, materialized.match.id));
    await setup.services.tournaments.onMatchFinished(materialized.match.id, db);

    const advanced = await db.query.tournaments.findFirst({ where: eq(tournaments.id, tournament!.id) });
    const graph = advanced!.bracketJson as { matches: Array<{ id: string; winnerParticipantId: string | null; loserParticipantId: string | null }> };
    const node = graph.matches.find((candidate) => candidate.id === materialized.match.tournamentBracketMatchId);
    expect(node?.winnerParticipantId).toBe(roster[0]!.id);
    expect(node?.winnerParticipantId).not.toBe(roster[1]!.id);
  });

  it("keeps V1 name fallback only for unlinked legacy guest rows", async () => {
    const setup = await isolatedApp("gap040_v1_legacy_fallback");
    const tournament = await setup.services.tournaments.create({
      title: "V1 legacy guests",
      format: "single_elimination",
      createdByUserId: ACTOR,
      organizerParticipates: false,
    });
    const roster = [];
    for (const [firstName, lastName] of [["Legacy", "One"], ["Legacy", "Two"], ["Legacy", "Three"], ["Legacy", "Four"]]) {
      roster.push(await setup.services.tournaments.addParticipant({
        tournamentId: tournament!.id,
        actorUserId: ACTOR,
        guestFirstName: firstName,
        guestLastName: lastName,
      }));
    }
    let slot = 0;
    const bracket = generateSingleEliminationBracket(roster.map((participant) => participant!.id), () => `gap040_legacy_${++slot}`);
    await db.update(tournaments).set({ status: "bracket_generated", bracketJson: bracket, bracketConstructionAlgorithm: null })
      .where(eq(tournaments.id, tournament!.id));
    await setup.services.tournaments.start(tournament!.id, ACTOR);
    const firstMatch = (await db.query.matches.findMany({ where: eq(matches.tournamentId, tournament!.id) }))[0]!;
    const participants = await db.query.matchParticipants.findMany({ where: eq(matchParticipants.matchId, firstMatch.id) });
    expect(participants.every((participant) => participant.guestIdentityId === null)).toBe(true);
    await db.update(matches).set({ status: "finished", winnerSide: participants[0]!.side, finishedAt: new Date("2026-10-03T12:30:00.000Z") })
      .where(eq(matches.id, firstMatch.id));
    await setup.services.tournaments.onMatchFinished(firstMatch.id, db);
    const winnerRoster = roster.find((participant) =>
      participant!.guestFirstName === participants[0]!.guestFirstName && participant!.guestLastName === participants[0]!.guestLastName,
    )!;
    const advanced = await db.query.tournaments.findFirst({ where: eq(tournaments.id, tournament!.id) });
    const targetSlotId = bracket.slots.find((bracketSlot) => bracketSlot.participantId === winnerRoster!.id)!.advancesToSlotId;
    expect((advanced!.bracketJson as typeof bracket).slots.find((bracketSlot) => bracketSlot.id === targetSlotId)?.participantId)
      .toBe(winnerRoster!.id);
  });

  it("paginates 23 timestamp-tied terminal events on PostgreSQL without leaks, duplicates or omissions", async () => {
    const setup = await isolatedApp("gap040_history_pagination");
    const firstGuest = await createReusableGuest(setup.services, 40421, "History", "Primary");
    const secondGuest = await createReusableGuest(setup.services, 40422, "History", "Other");
    const sessionToken = "gap040-history-session";
    await db.insert(authSessions).values({
      id: "00000000-0000-4000-8000-000000040423",
      userId: ACTOR,
      tokenHash: hashToken(sessionToken),
      expiresAt: new Date("2026-10-04T12:00:00.000Z"),
    });
    const finishedAt = new Date("2026-10-03T12:40:00.123Z");
    const terminalMatches = Array.from({ length: 23 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(40430 + index).padStart(12, "0")}`,
      title: `PostgreSQL history ${index}`,
      createdByUserId: ACTOR,
      status: "finished" as const,
      winnerSide: "A",
      finishedAt,
    }));
    await db.insert(matches).values(terminalMatches);
    await db.insert(matchParticipants).values(terminalMatches.flatMap((match) => [
      {
        matchId: match.id,
        side: "A" as const,
        guestIdentityId: firstGuest.id,
        guestFirstName: firstGuest.firstName,
        guestLastName: firstGuest.lastName,
        guestAvatarKey: firstGuest.avatarKey,
      },
      { matchId: match.id, side: "B" as const, userId: ADMIN },
    ]));

    const first = await setup.app.inject({
      method: "GET",
      url: `/api/v1/guests/${firstGuest.id}/history`,
      cookies: { tab10_session: sessionToken },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(20);
    expect(first.json().nextCursor).toEqual(expect.any(String));
    const second = await setup.app.inject({
      method: "GET",
      url: `/api/v1/guests/${firstGuest.id}/history?cursor=${encodeURIComponent(first.json().nextCursor)}`,
      cookies: { tab10_session: sessionToken },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().items).toHaveLength(3);
    expect(second.json().nextCursor).toBeNull();
    const ids = [...first.json().items, ...second.json().items].map((item: { id: string }) => item.id);
    expect(ids).toEqual([...terminalMatches].sort((left, right) => right.id.localeCompare(left.id)).map((match) => match.id));
    expect(new Set(ids).size).toBe(23);

    const malformed = await setup.app.inject({
      method: "GET",
      url: `/api/v1/guests/${firstGuest.id}/history?cursor=not-a-cursor`,
      cookies: { tab10_session: sessionToken },
    });
    expect(malformed.statusCode).toBe(400);
    const wrongGuest = await setup.app.inject({
      method: "GET",
      url: `/api/v1/guests/${secondGuest.id}/history?cursor=${encodeURIComponent(first.json().nextCursor)}`,
      cookies: { tab10_session: sessionToken },
    });
    expect(wrongGuest.statusCode).toBe(400);
    expect(wrongGuest.json()).not.toHaveProperty("items");
  });
});
