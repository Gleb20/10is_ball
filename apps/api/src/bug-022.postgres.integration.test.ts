import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { buildApp } from "./app.js";
import { createPostgresDb, type Db } from "./db/client.js";
import { runPostgresMigrations } from "./db/migrations.js";
import { resolveTestDatabaseUrl } from "./db/test-database-url.js";
import {
  tournamentInvitations,
  tournamentParticipants,
  tournaments,
  users,
} from "./db/schema.js";
import * as schema from "./db/schema.js";

const databaseUrl = resolveTestDatabaseUrl(process.env, {
  required: process.env.REQUIRE_TEST_DATABASE_URL === "1",
});
const describePostgres = databaseUrl ? describe : describe.skip;

async function waitUntilBlocked(observer: postgres.Sql, applicationName: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await observer<{ blocked: boolean }[]>`
      select exists (
        select 1 from pg_stat_activity
        where application_name = ${applicationName} and wait_event_type = 'Lock'
      ) as blocked
    `;
    if (row?.blocked) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`${applicationName} did not block on a database lock`);
}

describePostgres.sequential("BUG-022 PostgreSQL generation serialization", () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  const clients: postgres.Sql[] = [];
  const organizer = "00000000-0000-4000-8000-000000022301";
  const playerA = "00000000-0000-4000-8000-000000022302";
  const playerB = "00000000-0000-4000-8000-000000022303";
  const playerC = "00000000-0000-4000-8000-000000022304";
  const lateA = "00000000-0000-4000-8000-000000022305";
  const lateB = "00000000-0000-4000-8000-000000022306";

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
    closeDb = context.close;
    await db.insert(users).values(
      [organizer, playerA, playerB, playerC, lateA, lateB].map((id, index) => ({
        id,
        email: `bug022-${index}@postgres.test`,
        passwordHash: "x",
        firstName: `Player${index}`,
        lastName: "BUG022",
        mustChangePassword: false,
      })),
    );
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.end({ timeout: 5 })));
    await closeDb?.();
  });

  function isolated(applicationName: string) {
    const client = postgres(databaseUrl!, {
      max: 1,
      connection: { application_name: applicationName },
    });
    clients.push(client);
    return buildApp({
      db: drizzle(client, { schema }) as unknown as Db,
      clock: new FakeClock(new Date("2026-10-03T12:00:00.000Z")),
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

  async function createRoster(applicationName: string) {
    const setup = await isolated(applicationName);
    const tournament = await setup.services.tournaments.create({
      title: applicationName,
      format: "single_elimination",
      createdByUserId: organizer,
      organizerParticipates: false,
    });
    for (const [index, guestFirstName] of ["Alpha", "Beta", "Gamma"].entries()) {
      await setup.services.tournaments.addParticipant({
        tournamentId: tournament!.id,
        actorUserId: organizer,
        guestFirstName,
        guestLastName: `${applicationName}-${index}`,
      });
    }
    return { setup, tournament: (await setup.services.tournaments.get(tournament!.id))! };
  }

  it("allows exactly one of two generation requests for the same version", async () => {
    const { setup, tournament } = await createRoster("bug022_two_generations_setup");
    const lock = await holdTournament(tournament.id);
    const first = await isolated("bug022_generation_first");
    const second = await isolated("bug022_generation_second");
    const firstPromise = first.services.tournaments.generateBracketVersioned(tournament.id, organizer, {
      expectedVersion: tournament.bracketStateVersion,
      constructionAlgorithm: "compact",
      rng: () => 0.5,
    });
    await waitUntilBlocked(lock.observer, "bug022_generation_first");
    const secondPromise = second.services.tournaments.generateBracketVersioned(tournament.id, organizer, {
      expectedVersion: tournament.bracketStateVersion,
      constructionAlgorithm: "power_of_two",
      rng: () => 0.5,
    });
    await waitUntilBlocked(lock.observer, "bug022_generation_second");
    lock.release();
    await lock.held;

    await expect(firstPromise).resolves.toMatchObject({ status: "bracket_generated" });
    await expect(secondPromise).rejects.toMatchObject({ code: "BRACKET_VERSION_CONFLICT" });
    const after = await setup.services.tournaments.get(tournament.id);
    expect(after).toMatchObject({
      status: "bracket_generated",
      bracketStateVersion: tournament.bracketStateVersion + 1,
      bracketConstructionAlgorithm: "compact",
    });
    await setup.app.close();
    await first.app.close();
    await second.app.close();
  });

  it("serializes add before generation and generation before add without losing roster or version", async () => {
    const firstCase = await createRoster("bug022_add_before_generation_setup");
    const firstLock = await holdTournament(firstCase.tournament.id);
    const adder = await isolated("bug022_add_before_generation");
    const generator = await isolated("bug022_generation_after_add");
    const addPromise = adder.services.tournaments.addParticipant({
      tournamentId: firstCase.tournament.id,
      actorUserId: organizer,
      userId: lateA,
    });
    await waitUntilBlocked(firstLock.observer, "bug022_add_before_generation");
    const staleGeneration = generator.services.tournaments.generateBracketVersioned(firstCase.tournament.id, organizer, {
      expectedVersion: firstCase.tournament.bracketStateVersion,
      constructionAlgorithm: "compact",
      rng: () => 0.5,
    });
    await waitUntilBlocked(firstLock.observer, "bug022_generation_after_add");
    firstLock.release();
    await firstLock.held;
    await expect(addPromise).resolves.toMatchObject({ userId: lateA });
    await expect(staleGeneration).rejects.toMatchObject({ code: "BRACKET_VERSION_CONFLICT" });
    expect(await firstCase.setup.services.tournaments.get(firstCase.tournament.id)).toMatchObject({
      bracketJson: null,
      bracketStateVersion: firstCase.tournament.bracketStateVersion + 1,
    });

    const secondCase = await createRoster("bug022_generation_before_add_setup");
    const secondLock = await holdTournament(secondCase.tournament.id);
    const firstGenerator = await isolated("bug022_generation_before_add");
    const lateAdder = await isolated("bug022_add_after_generation");
    const generationPromise = firstGenerator.services.tournaments.generateBracketVersioned(secondCase.tournament.id, organizer, {
      expectedVersion: secondCase.tournament.bracketStateVersion,
      constructionAlgorithm: "compact",
      rng: () => 0.5,
    });
    await waitUntilBlocked(secondLock.observer, "bug022_generation_before_add");
    const lateAddPromise = lateAdder.services.tournaments.addParticipant({
      tournamentId: secondCase.tournament.id,
      actorUserId: organizer,
      userId: lateB,
      confirmBracketRegeneration: true,
    });
    await waitUntilBlocked(secondLock.observer, "bug022_add_after_generation");
    secondLock.release();
    await secondLock.held;
    await expect(generationPromise).resolves.toMatchObject({ status: "bracket_generated" });
    await expect(lateAddPromise).resolves.toMatchObject({ userId: lateB });
    const regenerated = await secondCase.setup.services.tournaments.get(secondCase.tournament.id);
    expect(regenerated).toMatchObject({
      status: "bracket_generated",
      bracketStateVersion: secondCase.tournament.bracketStateVersion + 2,
    });
    expect(regenerated!.participants).toEqual(expect.arrayContaining([expect.objectContaining({ userId: lateB, status: "active" })]));

    for (const built of [firstCase.setup, adder, generator, secondCase.setup, firstGenerator, lateAdder]) {
      await built.app.close();
    }
  });

  it("serializes invitation acceptance on both sides of generation", async () => {
    const acceptFirst = await createRoster("bug022_accept_before_generation_setup");
    const firstInvitation = await acceptFirst.setup.services.tournaments.invite({
      tournamentId: acceptFirst.tournament.id,
      invitedUserId: lateA,
      invitedByUserId: organizer,
    });
    const firstLock = await holdTournament(acceptFirst.tournament.id);
    const accepter = await isolated("bug022_accept_before_generation");
    const generator = await isolated("bug022_generation_after_accept");
    const acceptPromise = accepter.services.tournaments.respondInvitation({ invitationId: firstInvitation!.id, userId: lateA, accept: true });
    await waitUntilBlocked(firstLock.observer, "bug022_accept_before_generation");
    const staleGeneration = generator.services.tournaments.generateBracketVersioned(acceptFirst.tournament.id, organizer, {
      expectedVersion: acceptFirst.tournament.bracketStateVersion,
      constructionAlgorithm: "compact",
      rng: () => 0.5,
    });
    await waitUntilBlocked(firstLock.observer, "bug022_generation_after_accept");
    firstLock.release();
    await firstLock.held;
    await expect(acceptPromise).resolves.toEqual({ status: "accepted" });
    await expect(staleGeneration).rejects.toMatchObject({ code: "BRACKET_VERSION_CONFLICT" });
    expect(await acceptFirst.setup.services.tournaments.get(acceptFirst.tournament.id)).toMatchObject({
      bracketStateVersion: acceptFirst.tournament.bracketStateVersion + 1,
      participants: expect.arrayContaining([expect.objectContaining({ userId: lateA, status: "active" })]),
    });

    const generationFirst = await createRoster("bug022_generation_before_accept_setup");
    const secondInvitation = await generationFirst.setup.services.tournaments.invite({
      tournamentId: generationFirst.tournament.id,
      invitedUserId: lateB,
      invitedByUserId: organizer,
    });
    const secondLock = await holdTournament(generationFirst.tournament.id);
    const firstGenerator = await isolated("bug022_generation_before_accept");
    const lateAccepter = await isolated("bug022_accept_after_generation");
    const generationPromise = firstGenerator.services.tournaments.generateBracketVersioned(generationFirst.tournament.id, organizer, {
      expectedVersion: generationFirst.tournament.bracketStateVersion,
      constructionAlgorithm: "compact",
      rng: () => 0.5,
    });
    await waitUntilBlocked(secondLock.observer, "bug022_generation_before_accept");
    const lateAcceptPromise = lateAccepter.services.tournaments.respondInvitation({ invitationId: secondInvitation!.id, userId: lateB, accept: true });
    await waitUntilBlocked(secondLock.observer, "bug022_accept_after_generation");
    secondLock.release();
    await secondLock.held;
    await expect(generationPromise).resolves.toMatchObject({ status: "bracket_generated" });
    await expect(lateAcceptPromise).rejects.toMatchObject({ code: "EXPIRED" });
    const after = await generationFirst.setup.services.tournaments.get(generationFirst.tournament.id);
    expect(after!.participants.some((participant) => participant.userId === lateB && participant.status === "active")).toBe(false);
    expect(await db.query.tournamentInvitations.findFirst({ where: eq(tournamentInvitations.id, secondInvitation!.id) })).toMatchObject({
      status: "expired",
      terminalReason: "roster_closed",
    });

    for (const built of [acceptFirst.setup, accepter, generator, generationFirst.setup, firstGenerator, lateAccepter]) {
      await built.app.close();
    }
  });

  it("serializes start on both sides of regeneration and preserves monotonic versions", async () => {
    const startFirst = await createRoster("bug022_start_before_generation_setup");
    await startFirst.setup.services.tournaments.generateBracketVersioned(startFirst.tournament.id, organizer, {
      expectedVersion: startFirst.tournament.bracketStateVersion,
      constructionAlgorithm: "compact",
      rng: () => 0.5,
    });
    const beforeStart = (await startFirst.setup.services.tournaments.get(startFirst.tournament.id))!;
    const firstLock = await holdTournament(startFirst.tournament.id);
    const starter = await isolated("bug022_start_before_generation");
    const generator = await isolated("bug022_generation_after_start");
    const startPromise = starter.services.tournaments.start(startFirst.tournament.id, organizer);
    await waitUntilBlocked(firstLock.observer, "bug022_start_before_generation");
    const lateGeneration = generator.services.tournaments.generateBracketVersioned(startFirst.tournament.id, organizer, {
      expectedVersion: beforeStart.bracketStateVersion,
      constructionAlgorithm: "compact",
      rng: () => 0.5,
    });
    await waitUntilBlocked(firstLock.observer, "bug022_generation_after_start");
    firstLock.release();
    await firstLock.held;
    await expect(startPromise).resolves.toMatchObject({ status: "in_progress" });
    await expect(lateGeneration).rejects.toMatchObject({ code: "BRACKET_VERSION_CONFLICT" });

    const generationFirst = await createRoster("bug022_generation_before_start_setup");
    await generationFirst.setup.services.tournaments.generateBracketVersioned(generationFirst.tournament.id, organizer, {
      expectedVersion: generationFirst.tournament.bracketStateVersion,
      constructionAlgorithm: "compact",
      rng: () => 0.5,
    });
    const beforeRegeneration = (await generationFirst.setup.services.tournaments.get(generationFirst.tournament.id))!;
    const secondLock = await holdTournament(generationFirst.tournament.id);
    const firstGenerator = await isolated("bug022_generation_before_start");
    const lateStarter = await isolated("bug022_start_after_generation");
    const regenerationPromise = firstGenerator.services.tournaments.generateBracketVersioned(generationFirst.tournament.id, organizer, {
      expectedVersion: beforeRegeneration.bracketStateVersion,
      constructionAlgorithm: "power_of_two",
      rng: () => 0.5,
    });
    await waitUntilBlocked(secondLock.observer, "bug022_generation_before_start");
    const lateStartPromise = lateStarter.services.tournaments.start(generationFirst.tournament.id, organizer);
    await waitUntilBlocked(secondLock.observer, "bug022_start_after_generation");
    secondLock.release();
    await secondLock.held;
    await expect(regenerationPromise).resolves.toMatchObject({ status: "bracket_generated" });
    await expect(lateStartPromise).resolves.toMatchObject({
      status: "in_progress",
      bracketStateVersion: beforeRegeneration.bracketStateVersion + 2,
    });

    for (const built of [startFirst.setup, starter, generator, generationFirst.setup, firstGenerator, lateStarter]) {
      await built.app.close();
    }
  });

  it("rolls back seeds, invitation closure, bracket, and version when generation fails after writes begin", async () => {
    const { setup, tournament } = await createRoster("bug022_generation_rollback_setup");
    const invitation = await setup.services.tournaments.invite({
      tournamentId: tournament.id,
      invitedUserId: lateA,
      invitedByUserId: organizer,
    });
    const control = postgres(databaseUrl!, { max: 1 });
    clients.push(control);
    await control.unsafe(`
      create or replace function bug022_fail_generation() returns trigger language plpgsql as $$
      begin
        if new.status = 'bracket_generated' then
          raise exception 'BUG022 forced generation failure';
        end if;
        return new;
      end $$;
      create trigger bug022_fail_generation_trigger
      before update on tournaments
      for each row execute function bug022_fail_generation();
    `);
    try {
      await expect(setup.services.tournaments.generateBracketVersioned(tournament.id, organizer, {
        expectedVersion: tournament.bracketStateVersion,
        constructionAlgorithm: "compact",
        rng: () => 0.5,
      })).rejects.toThrow();
    } finally {
      await control.unsafe(`
        drop trigger if exists bug022_fail_generation_trigger on tournaments;
        drop function if exists bug022_fail_generation();
      `);
    }

    expect(await db.query.tournaments.findFirst({ where: eq(tournaments.id, tournament.id) })).toMatchObject({
      status: "collecting",
      bracketJson: null,
      bracketStateVersion: tournament.bracketStateVersion,
    });
    expect(await db.query.tournamentParticipants.findMany({ where: eq(tournamentParticipants.tournamentId, tournament.id) }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ seed: null })]));
    expect(await db.query.tournamentInvitations.findFirst({ where: and(eq(tournamentInvitations.id, invitation!.id), eq(tournamentInvitations.tournamentId, tournament.id)) }))
      .toMatchObject({ status: "pending", respondedAt: null, terminalReason: null });
    await setup.app.close();
  });
});
