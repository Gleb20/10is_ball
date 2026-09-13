import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { buildApp } from "./app.js";
import { createPostgresDb, type Db } from "./db/client.js";
import { runPostgresMigrations } from "./db/migrations.js";
import { resolveTestDatabaseUrl } from "./db/test-database-url.js";
import { authSessions, judgeSessions, matches, tournaments, users } from "./db/schema.js";
import * as schema from "./db/schema.js";

const databaseUrl = resolveTestDatabaseUrl(process.env, { required: process.env.REQUIRE_TEST_DATABASE_URL === "1" });
const describePostgres = databaseUrl ? describe : describe.skip;

async function waitUntilBlocked(observer: postgres.Sql, applicationName: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await observer<{ blocked: boolean }[]>`
      select exists (
        select 1
        from pg_stat_activity
        where application_name = ${applicationName}
          and wait_event_type = 'Lock'
      ) as blocked
    `;
    if (row?.blocked) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`${applicationName} did not block on a database lock`);
}

describePostgres.sequential("GAP-006 PostgreSQL tournament transitions", () => {
  let db: Db;
  let close: () => Promise<void>;
  const clients: postgres.Sql[] = [];
  const actor = "00000000-0000-4000-8000-000000000811";

  beforeAll(async () => {
    const reset = postgres(databaseUrl!, { max: 1 });
    await reset.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await reset.end({ timeout: 5 });
    await runPostgresMigrations(databaseUrl!, "apply");
    const context = await createPostgresDb(databaseUrl!); db = context.db; close = context.close;
    await db.insert(users).values({ id: actor, email: "gap006-pg@test.local", passwordHash: "x", firstName: "Actor", lastName: "Atomic", mustChangePassword: false });
  });
  afterAll(async () => { await Promise.all(clients.map((client) => client.end({ timeout: 5 }))); await close?.(); });

  function isolated(name: string) {
    const client = postgres(databaseUrl!, { max: 1, connection: { application_name: name } }); clients.push(client);
    const isolatedDb = drizzle(client, { schema }) as unknown as Db;
    return buildApp({ db: isolatedDb, clock: new FakeClock(new Date("2026-09-13T10:00:00Z")) });
  }

  it("serializes start before dissolve without leaving matches under a collecting tournament", async () => {
    const setup = await isolated("gap006_setup");
    const tournament = (await setup.services.tournaments.create({ title: "Start dissolve", format: "single_elimination", createdByUserId: actor, organizerParticipates: true }))!;
    for (const name of ["Guest A", "Guest B"]) await setup.services.tournaments.addParticipant({ tournamentId: tournament.id, actorUserId: actor, guestFirstName: name, guestLastName: "Fixture" });
    await setup.services.tournaments.generateBracket(tournament.id, actor, { constructionAlgorithm: "compact", rng: () => 0.5 });
    const blocker = postgres(databaseUrl!, { max: 1 }); clients.push(blocker);
    let release!: () => void; let ready!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const heldReady = new Promise<void>((resolve) => { ready = resolve; });
    const held = blocker.begin(async (tx) => { await tx`select id from tournaments where id = ${tournament.id} for update`; ready(); await gate; });
    await heldReady;
    const starter = await isolated("gap006_start_first");
    const dissolver = await isolated("gap006_dissolve_second");
    const observer = postgres(databaseUrl!, { max: 1 }); clients.push(observer);
    const startPromise = starter.services.tournaments.start(tournament.id, actor);
    await waitUntilBlocked(observer, "gap006_start_first");
    const dissolvePromise = dissolver.services.tournaments.dissolveBracket(tournament.id, actor);
    await waitUntilBlocked(observer, "gap006_dissolve_second");
    release(); await held;
    const outcomes = await Promise.allSettled([startPromise, dissolvePromise]);
    expect(outcomes[0]!.status).toBe("fulfilled");
    expect(outcomes[1]!).toMatchObject({ status: "rejected", reason: { code: "INVALID_STATUS" } });
    expect(await db.query.tournaments.findFirst({ where: eq(tournaments.id, tournament.id) })).toMatchObject({ status: "in_progress" });
    expect(await db.query.matches.findMany({ where: eq(matches.tournamentId, tournament.id) })).not.toHaveLength(0);
    await setup.app.close(); await starter.app.close(); await dissolver.app.close();
  });

  it("serializes match completion before stop and releases every active judge", async () => {
    const ids = [
      "00000000-0000-4000-8000-000000000831",
      "00000000-0000-4000-8000-000000000832",
      "00000000-0000-4000-8000-000000000833",
    ];
    await db.insert(users).values(ids.map((id, index) => ({
      id,
      email: `gap006-finish-${index}@test.local`,
      passwordHash: "x",
      firstName: `P${index}`,
      lastName: "Finish",
      mustChangePassword: false,
    })));
    const setup = await isolated("gap006_finish_setup");
    const tournament = (await setup.services.tournaments.create({
      title: "Finish stop",
      format: "single_elimination",
      createdByUserId: ids[0]!,
      organizerParticipates: true,
    }))!;
    await setup.services.tournaments.addParticipant({ tournamentId: tournament.id, actorUserId: ids[0]!, userId: ids[1] });
    await setup.services.tournaments.addParticipant({ tournamentId: tournament.id, actorUserId: ids[0]!, userId: ids[2] });
    await setup.services.tournaments.generateBracket(tournament.id, ids[0]!, { constructionAlgorithm: "compact", rng: () => 0.5 });
    const started = await setup.services.tournaments.start(tournament.id, ids[0]!);
    const firstMatch = started?.matches.find((match) => match.status === "waiting");
    expect(firstMatch).toBeDefined();
    const waitingDetail = await setup.services.matches.getMatch(firstMatch!.id);
    let detail = await setup.services.matches.startMatch(
      firstMatch!.id,
      ids[0]!,
      waitingDetail!.participants[0]!.id,
    );
    const [authSession] = await db
      .insert(authSessions)
      .values({ userId: ids[0]!, tokenHash: "gap006-finish-session", expiresAt: new Date("2026-09-14T10:00:00Z") })
      .returning();
    await setup.services.matches.acquireJudge({ matchId: firstMatch!.id, userId: ids[0]!, authSessionId: authSession!.id });
    for (let point = 0; point < 20 && detail?.status === "in_progress"; point += 1) {
      detail = await setup.services.matches.awardPoint({
        matchId: firstMatch!.id,
        side: "A",
        idempotencyKey: `gap006-finish-${point}`,
        expectedVersion: detail!.version,
        judgeUserId: ids[0]!,
        authSessionId: authSession!.id,
      });
    }
    expect(detail).toMatchObject({ status: "pending_confirmation", winnerSide: "A" });

    const blocker = postgres(databaseUrl!, { max: 1 }); clients.push(blocker);
    let release!: () => void; let ready!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const heldReady = new Promise<void>((resolve) => { ready = resolve; });
    const held = blocker.begin(async (tx) => { await tx`select id from tournaments where id = ${tournament.id} for update`; ready(); await gate; });
    await heldReady;
    const confirmer = await isolated("gap006_finish_first");
    const stopper = await isolated("gap006_stop_second");
    const finishPromise = confirmer.services.matches.confirmFinish({ matchId: firstMatch!.id, judgeUserId: ids[0]!, authSessionId: authSession!.id });
    const observer = postgres(databaseUrl!, { max: 1 }); clients.push(observer);
    await waitUntilBlocked(observer, "gap006_finish_first");
    const stopPromise = stopper.services.tournaments.stop(tournament.id, ids[0]!);
    await waitUntilBlocked(observer, "gap006_stop_second");
    release(); await held;

    const outcomes = await Promise.allSettled([finishPromise, stopPromise]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await db.query.tournaments.findFirst({ where: eq(tournaments.id, tournament.id) })).toMatchObject({ status: "stopped" });
    expect(await db.query.matches.findFirst({ where: eq(matches.id, firstMatch!.id) })).toMatchObject({ status: "finished" });
    const tournamentMatches = await db.query.matches.findMany({ where: eq(matches.tournamentId, tournament.id) });
    expect(tournamentMatches.every((match) => match.status === "finished" || match.status === "cancelled")).toBe(true);
    const sessions = await db.query.judgeSessions.findMany();
    expect(sessions.filter((session) => tournamentMatches.some((match) => match.id === session.matchId)).every((session) => session.releasedAt != null)).toBe(true);
    await setup.app.close(); await confirmer.app.close(); await stopper.app.close();
  });
});
