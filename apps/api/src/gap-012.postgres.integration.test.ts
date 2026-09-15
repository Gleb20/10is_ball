import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { buildApp } from "./app.js";
import { createPostgresDb, type Db } from "./db/client.js";
import { runPostgresMigrations } from "./db/migrations.js";
import { resolveTestDatabaseUrl } from "./db/test-database-url.js";
import { auditLogs, notifications, tournamentInvitations, tournamentParticipants, tournaments, users } from "./db/schema.js";
import * as schema from "./db/schema.js";

const databaseUrl = resolveTestDatabaseUrl(process.env, { required: process.env.REQUIRE_TEST_DATABASE_URL === "1" });
const describePostgres = databaseUrl ? describe : describe.skip;

async function waitUntilBlocked(observer: postgres.Sql, applicationName: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await observer<{ blocked: boolean }[]>`
      select exists (select 1 from pg_stat_activity where application_name = ${applicationName} and wait_event_type = 'Lock') as blocked
    `;
    if (row?.blocked) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`${applicationName} did not block on a database lock`);
}

describePostgres.sequential("GAP-012 PostgreSQL roster serialization", () => {
  let db: Db;
  let close: () => Promise<void>;
  const clients: postgres.Sql[] = [];
  const organizer = "00000000-0000-4000-8000-000000012301";
  const invitee = "00000000-0000-4000-8000-000000012302";
  const playerA = "00000000-0000-4000-8000-000000012303";
  const playerB = "00000000-0000-4000-8000-000000012304";
  const playerC = "00000000-0000-4000-8000-000000012305";
  const late = "00000000-0000-4000-8000-000000012306";

  beforeAll(async () => {
    const reset = postgres(databaseUrl!, { max: 1 });
    try {
      await reset.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    } finally {
      await reset.end({ timeout: 5 });
    }
    await runPostgresMigrations(databaseUrl!, "apply");
    const context = await createPostgresDb(databaseUrl!);
    db = context.db;
    close = context.close;
    await db.insert(users).values([organizer, invitee, playerA, playerB, playerC, late].map((id, index) => ({
      id, email: `gap012-${index}@postgres.test`, passwordHash: "x",
      firstName: `Player${index}`, lastName: "GAP012", mustChangePassword: false,
    })));
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.end({ timeout: 5 })));
    await close?.();
  });

  function isolated(applicationName: string) {
    const client = postgres(databaseUrl!, { max: 1, connection: { application_name: applicationName } });
    clients.push(client);
    return buildApp({
      db: drizzle(client, { schema }) as unknown as Db,
      clock: new FakeClock(new Date("2026-09-13T12:00:00Z")),
    });
  }

  async function holdTournament(tournamentId: string) {
    const blocker = postgres(databaseUrl!, { max: 1 });
    const observer = postgres(databaseUrl!, { max: 1 });
    clients.push(blocker, observer);
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const heldReady = new Promise<void>((resolve) => { ready = resolve; });
    const held = blocker.begin(async (transaction) => {
      await transaction`select id from tournaments where id = ${tournamentId} for update`;
      ready();
      await gate;
    });
    await heldReady;
    return { observer, release, held };
  }

  it("serializes invitation acceptance before a confirmed manual add into one active row", async () => {
    const setup = await isolated("gap012_invite_setup");
    const tournament = await setup.services.tournaments.create({
      title: "Invitation race", format: "single_elimination", createdByUserId: organizer,
      organizerParticipates: false, requireParticipantConsent: true,
    });
    const invitation = await setup.services.tournaments.invite({
      tournamentId: tournament!.id, invitedUserId: invitee, invitedByUserId: organizer,
    });
    const lock = await holdTournament(tournament!.id);
    const accepter = await isolated("gap012_accept_first");
    const adder = await isolated("gap012_add_second");
    const acceptPromise = accepter.services.tournaments.respondInvitation({ invitationId: invitation!.id, userId: invitee, accept: true });
    await waitUntilBlocked(lock.observer, "gap012_accept_first");
    const addPromise = adder.services.tournaments.addParticipant({
      tournamentId: tournament!.id, actorUserId: organizer, userId: invitee,
      confirmManualOverride: true, idempotencyKey: "00000000-0000-4000-8000-000000012311",
    });
    await waitUntilBlocked(lock.observer, "gap012_add_second");
    lock.release(); await lock.held;
    await expect(acceptPromise).resolves.toEqual({ status: "accepted" });
    await expect(addPromise).rejects.toMatchObject({ code: "ALREADY_IN_TOURNAMENT" });
    expect(await db.query.tournamentParticipants.findMany({
      where: and(eq(tournamentParticipants.tournamentId, tournament!.id), eq(tournamentParticipants.userId, invitee), eq(tournamentParticipants.status, "active")),
    })).toHaveLength(1);
    expect(await db.query.tournamentInvitations.findFirst({ where: eq(tournamentInvitations.id, invitation!.id) }))
      .toMatchObject({ status: "accepted", terminalReason: null });
    await setup.app.close(); await accepter.app.close(); await adder.app.close();
  });

  it("lets a confirmed manual add close the invitation before a concurrent acceptance", async () => {
    const setup = await isolated("gap012_manual_setup");
    const tournament = await setup.services.tournaments.create({
      title: "Manual add race", format: "single_elimination", createdByUserId: organizer,
      organizerParticipates: false, requireParticipantConsent: true,
    });
    const invitation = await setup.services.tournaments.invite({
      tournamentId: tournament!.id, invitedUserId: invitee, invitedByUserId: organizer,
    });
    const lock = await holdTournament(tournament!.id);
    const adder = await isolated("gap012_manual_first");
    const accepter = await isolated("gap012_accept_second");
    const addPromise = adder.services.tournaments.addParticipant({
      tournamentId: tournament!.id, actorUserId: organizer, userId: invitee,
      confirmManualOverride: true, idempotencyKey: "00000000-0000-4000-8000-000000012314",
    });
    await waitUntilBlocked(lock.observer, "gap012_manual_first");
    const acceptPromise = accepter.services.tournaments.respondInvitation({
      invitationId: invitation!.id, userId: invitee, accept: true,
    });
    await waitUntilBlocked(lock.observer, "gap012_accept_second");
    lock.release(); await lock.held;
    await expect(addPromise).resolves.toMatchObject({
      userId: invitee, additionSource: "manual_override", addedByUserId: organizer,
    });
    await expect(acceptPromise).rejects.toMatchObject({ code: "EXPIRED" });
    expect(await db.query.tournamentParticipants.findMany({
      where: and(eq(tournamentParticipants.tournamentId, tournament!.id), eq(tournamentParticipants.userId, invitee), eq(tournamentParticipants.status, "active")),
    })).toHaveLength(1);
    expect(await db.query.tournamentInvitations.findFirst({ where: eq(tournamentInvitations.id, invitation!.id) }))
      .toMatchObject({ status: "cancelled", terminalReason: "manual_override", respondedAt: expect.any(Date) });
    expect(await db.query.notifications.findMany({
      where: and(eq(notifications.userId, invitee), eq(notifications.type, "tournament_invitation")),
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ payload: expect.objectContaining({ invitationId: invitation!.id }), readAt: expect.any(Date) }),
    ]));
    await setup.app.close(); await adder.app.close(); await accepter.app.close();
  });

  it("lets start win the tournament lock and rejects the late add without roster, audit, or bracket writes", async () => {
    const setup = await isolated("gap012_start_setup");
    const tournament = await setup.services.tournaments.create({
      title: "Start race", format: "single_elimination", createdByUserId: organizer, organizerParticipates: false,
    });
    for (const userId of [playerA, playerB, playerC]) {
      await setup.services.tournaments.addParticipant({ tournamentId: tournament!.id, actorUserId: organizer, userId });
    }
    await setup.services.tournaments.generateBracket(tournament!.id, organizer, { rng: () => 0.5 });
    const auditsBefore = await db.query.auditLogs.findMany({ where: eq(auditLogs.entityType, "tournament_participant") });
    const lock = await holdTournament(tournament!.id);
    const starter = await isolated("gap012_start_first");
    const adder = await isolated("gap012_add_after_start");
    const startPromise = starter.services.tournaments.start(tournament!.id, organizer);
    await waitUntilBlocked(lock.observer, "gap012_start_first");
    const addPromise = adder.services.tournaments.addParticipant({
      tournamentId: tournament!.id, actorUserId: organizer, userId: late,
      confirmBracketRegeneration: true, idempotencyKey: "00000000-0000-4000-8000-000000012312",
    });
    await waitUntilBlocked(lock.observer, "gap012_add_after_start");
    lock.release(); await lock.held;
    const started = await startPromise;
    expect(started).toMatchObject({ status: "in_progress" });
    await expect(addPromise).rejects.toMatchObject({ code: "INVALID_STATUS" });
    const after = await setup.services.tournaments.get(tournament!.id);
    expect(after!.participants.some((participant) => participant.userId === late)).toBe(false);
    expect(after!.bracketJson).toEqual(started!.bracketJson);
    expect(after!.bracketStateVersion).toBe(started!.bracketStateVersion);
    expect(await db.query.auditLogs.findMany({ where: eq(auditLogs.entityType, "tournament_participant") })).toHaveLength(auditsBefore.length);
    expect(await db.query.tournaments.findFirst({ where: eq(tournaments.id, tournament!.id) })).toMatchObject({ status: "in_progress" });
    await setup.app.close(); await starter.app.close(); await adder.app.close();
  });

  it("regenerates a real PostgreSQL bracket once and appends the new seed on exact replay", async () => {
    const setup = await isolated("gap012_regenerate");
    const tournament = await setup.services.tournaments.create({
      title: "Postgres regeneration", format: "single_elimination", createdByUserId: organizer, organizerParticipates: false,
    });
    for (const userId of [playerA, playerB, playerC]) {
      await setup.services.tournaments.addParticipant({ tournamentId: tournament!.id, actorUserId: organizer, userId });
    }
    await setup.services.tournaments.generateBracket(tournament!.id, organizer, { rng: () => 0.5 });
    const before = await setup.services.tournaments.get(tournament!.id);
    const beforeSeeds = (before!.bracketJson as { seedOrder: string[] }).seedOrder;
    const input = {
      tournamentId: tournament!.id, actorUserId: organizer, userId: late,
      confirmBracketRegeneration: true, idempotencyKey: "00000000-0000-4000-8000-000000012313",
    };
    const first = await setup.services.tournaments.addParticipant(input);
    const after = await setup.services.tournaments.get(tournament!.id);
    const replay = await setup.services.tournaments.addParticipant(input);
    expect(replay!.id).toBe(first!.id);
    expect((after!.bracketJson as { seedOrder: string[] }).seedOrder.slice(0, beforeSeeds.length)).toEqual(beforeSeeds);
    expect((after!.bracketJson as { seedOrder: string[] }).seedOrder.at(-1)).toBe(first!.id);
    expect((await setup.services.tournaments.get(tournament!.id))!.bracketStateVersion).toBe(after!.bracketStateVersion);
    await setup.app.close();
  });

  it("serializes concurrent post-bracket additions without dropping either participant or the existing seed prefix", async () => {
    const setup = await isolated("gap012_parallel_setup");
    const tournament = await setup.services.tournaments.create({
      title: "Concurrent additions", format: "single_elimination", createdByUserId: organizer, organizerParticipates: false,
    });
    for (const userId of [playerA, playerB, playerC]) {
      await setup.services.tournaments.addParticipant({ tournamentId: tournament!.id, actorUserId: organizer, userId });
    }
    await setup.services.tournaments.generateBracket(tournament!.id, organizer, { rng: () => 0.5 });
    const before = await setup.services.tournaments.get(tournament!.id);
    const seedPrefix = (before!.bracketJson as { seedOrder: string[] }).seedOrder;
    const lock = await holdTournament(tournament!.id);
    const firstAdder = await isolated("gap012_parallel_first");
    const secondAdder = await isolated("gap012_parallel_second");
    const firstInput = {
      tournamentId: tournament!.id, actorUserId: organizer, userId: invitee,
      confirmBracketRegeneration: true, idempotencyKey: "00000000-0000-4000-8000-000000012315",
    };
    const secondInput = {
      tournamentId: tournament!.id, actorUserId: organizer, userId: late,
      confirmBracketRegeneration: true, idempotencyKey: "00000000-0000-4000-8000-000000012316",
    };
    const firstPromise = firstAdder.services.tournaments.addParticipant(firstInput);
    await waitUntilBlocked(lock.observer, "gap012_parallel_first");
    const secondPromise = secondAdder.services.tournaments.addParticipant(secondInput);
    await waitUntilBlocked(lock.observer, "gap012_parallel_second");
    lock.release(); await lock.held;
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    const after = await setup.services.tournaments.get(tournament!.id);
    const activeIds = after!.participants.filter((participant) => participant.status === "active").map((participant) => participant.id);
    const seedOrder = (after!.bracketJson as { seedOrder: string[] }).seedOrder;
    expect(after).toMatchObject({ status: "bracket_generated" });
    expect(seedOrder.slice(0, seedPrefix.length)).toEqual(seedPrefix);
    expect(seedOrder).toHaveLength(5);
    expect(new Set(seedOrder)).toEqual(new Set(activeIds));
    expect(seedOrder).toEqual(expect.arrayContaining([first!.id, second!.id]));
    const replay = await firstAdder.services.tournaments.addParticipant(firstInput);
    expect(replay!.id).toBe(first!.id);
    expect((await setup.services.tournaments.get(tournament!.id))!.bracketStateVersion).toBe(after!.bracketStateVersion);
    await setup.app.close(); await firstAdder.app.close(); await secondAdder.app.close();
  });
});
