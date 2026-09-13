import { afterEach, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { eq } from "drizzle-orm";
import { buildApp } from "./app.js";
import { createMigratedPgliteDb } from "./db/client.js";
import {
  authSessions,
  judgeSessions,
  matches,
  notifications,
  tournaments,
  users,
} from "./db/schema.js";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); });

it("GAP-006 start rolls back matches, status and notifications on downstream failure", async () => {
  const context = await createMigratedPgliteDb();
  const clock = new FakeClock(new Date("2026-09-13T10:00:00Z"));
  const { app, services } = await buildApp({ db: context.db, clock });
  cleanup = async () => { await app.close(); await context.close(); };
  const ids = [
    "00000000-0000-4000-8000-000000000801",
    "00000000-0000-4000-8000-000000000802",
    "00000000-0000-4000-8000-000000000803",
  ];
  await context.db.insert(users).values(ids.map((id, index) => ({
    id, email: `gap006-${index}@test.local`, passwordHash: "x", firstName: `P${index}`, lastName: "Atomic", mustChangePassword: false,
  })));
  const tournament = (await services.tournaments.create({ title: "Atomic start", format: "single_elimination", createdByUserId: ids[0]!, organizerParticipates: true }))!;
  await services.tournaments.addParticipant({ tournamentId: tournament.id, actorUserId: ids[0]!, userId: ids[1] });
  await services.tournaments.addParticipant({ tournamentId: tournament.id, actorUserId: ids[0]!, userId: ids[2] });
  await services.tournaments.generateBracket(tournament.id, ids[0]!, { constructionAlgorithm: "compact", rng: () => 0.5 });
  await context.db.execute(`create or replace function gap006_fail_ready_notification() returns trigger language plpgsql as $$ begin if NEW.type = 'tournament_match_ready' then raise exception 'injected'; end if; return NEW; end; $$`);
  await context.db.execute(`create trigger gap006_fail_ready_notification before insert on notifications for each row execute function gap006_fail_ready_notification()`);

  await expect(services.tournaments.start(tournament.id, ids[0]!)).rejects.toThrow();
  expect(await context.db.query.tournaments.findFirst({ where: eq(tournaments.id, tournament.id) })).toMatchObject({ status: "bracket_generated", startedAt: null });
  expect(await context.db.query.matches.findMany({ where: eq(matches.tournamentId, tournament.id) })).toHaveLength(0);
  expect(await context.db.query.notifications.findMany()).toHaveLength(0);
});

it("GAP-006 stop rolls back match and judge changes, then releases judges atomically", async () => {
  const context = await createMigratedPgliteDb();
  const clock = new FakeClock(new Date("2026-09-13T10:00:00Z"));
  const { app, services } = await buildApp({ db: context.db, clock });
  cleanup = async () => { await app.close(); await context.close(); };
  const ids = [
    "00000000-0000-4000-8000-000000000821",
    "00000000-0000-4000-8000-000000000822",
    "00000000-0000-4000-8000-000000000823",
  ];
  await context.db.insert(users).values(ids.map((id, index) => ({
    id,
    email: `gap006-stop-${index}@test.local`,
    passwordHash: "x",
    firstName: `P${index}`,
    lastName: "Stop",
    mustChangePassword: false,
  })));
  const tournament = (await services.tournaments.create({
    title: "Atomic stop",
    format: "single_elimination",
    createdByUserId: ids[0]!,
    organizerParticipates: true,
  }))!;
  await services.tournaments.addParticipant({ tournamentId: tournament.id, actorUserId: ids[0]!, userId: ids[1] });
  await services.tournaments.addParticipant({ tournamentId: tournament.id, actorUserId: ids[0]!, userId: ids[2] });
  await services.tournaments.generateBracket(tournament.id, ids[0]!, { constructionAlgorithm: "compact", rng: () => 0.5 });
  const started = await services.tournaments.start(tournament.id, ids[0]!);
  const activeMatch = started?.matches.find((match) => match.status === "waiting");
  expect(activeMatch).toBeDefined();
  const [authSession] = await context.db
    .insert(authSessions)
    .values({
      userId: ids[0]!,
      tokenHash: "gap006-stop-session",
      expiresAt: new Date("2026-09-14T10:00:00Z"),
    })
    .returning();
  const [judgeSession] = await context.db
    .insert(judgeSessions)
    .values({
      matchId: activeMatch!.id,
      userId: ids[0]!,
      authSessionId: authSession!.id,
      expiresAt: new Date("2026-09-13T10:02:00Z"),
    })
    .returning();
  await context.db.execute(`create or replace function gap006_fail_stop() returns trigger language plpgsql as $$ begin if NEW.status = 'stopped' then raise exception 'injected'; end if; return NEW; end; $$`);
  await context.db.execute(`create trigger gap006_fail_stop before update on tournaments for each row execute function gap006_fail_stop()`);

  await expect(services.tournaments.stop(tournament.id, ids[0]!)).rejects.toThrow();
  expect(await context.db.query.matches.findFirst({ where: eq(matches.id, activeMatch!.id) })).toMatchObject({ status: "waiting" });
  expect(await context.db.query.judgeSessions.findFirst({ where: eq(judgeSessions.id, judgeSession!.id) })).toMatchObject({ releasedAt: null });

  await context.db.execute(`drop trigger gap006_fail_stop on tournaments`);
  await context.db.execute(`drop function gap006_fail_stop()`);
  await services.tournaments.stop(tournament.id, ids[0]!);
  expect(await context.db.query.matches.findFirst({ where: eq(matches.id, activeMatch!.id) })).toMatchObject({ status: "cancelled" });
  expect(await context.db.query.judgeSessions.findFirst({ where: eq(judgeSessions.id, judgeSession!.id) })).toMatchObject({ releasedAt: clock.now() });
});
