import { afterEach, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { buildApp } from "./app.js";
import { createMigratedPgliteDb } from "./db/client.js";
import { matchParticipants, matches, teamMemberships, teams, users } from "./db/schema.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

it("MATCH-004 create options include only own active teams and real active opponents", async () => {
  const ctx = await createMigratedPgliteDb(); cleanups.push(ctx.close);
  const { app, services } = await buildApp({ db: ctx.db, clock: new FakeClock(new Date("2026-09-13T10:00:00Z")) });
  cleanups.push(() => app.close());
  const admin = await services.auth.seedAdmin("options@tab10.test", "OptionsFixture9!");
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "options@tab10.test", password: "OptionsFixture9!" } });
  const cookie = `tab10_session=${login.cookies.find((c) => c.name === "tab10_session")!.value}`;
  const actor = admin.user.id;
  const created = await ctx.db.insert(users).values([
    { email: "recent@tab10.test", passwordHash: "unused-test-fixture", firstName: "Recent", lastName: "Opponent" },
    { email: "frequent@tab10.test", passwordHash: "unused-test-fixture", firstName: "Frequent", lastName: "Opponent" },
    { email: "mate@tab10.test", passwordHash: "unused-test-fixture", firstName: "Own", lastName: "Teammate" },
    { email: "blocked@tab10.test", passwordHash: "unused-test-fixture", firstName: "Blocked", lastName: "Player", status: "blocked" },
  ]).returning();
  const [recent, frequent, mate, blocked] = created.map((u) => u.id);
  const teamRows = await ctx.db.insert(teams).values([
    { name: "Own active", slug: "own", captainUserId: actor },
    { name: "Left team", slug: "left", captainUserId: actor },
    { name: "Archived", slug: "archived", captainUserId: actor, archivedAt: new Date("2026-09-01T00:00:00Z") },
    { name: "Other team", slug: "other", captainUserId: recent! },
  ]).returning();
  await ctx.db.insert(teamMemberships).values([
    { teamId: teamRows[0]!.id, userId: actor }, { teamId: teamRows[0]!.id, userId: mate! }, { teamId: teamRows[0]!.id, userId: blocked! },
    { teamId: teamRows[1]!.id, userId: actor, leftAt: new Date("2026-09-02T00:00:00Z") },
    { teamId: teamRows[2]!.id, userId: actor }, { teamId: teamRows[3]!.id, userId: recent! },
  ]);
  async function historical(opponentId: string, day: number, kind: "standalone" | "tutorial" = "standalone", status: "finished" | "voided" = "finished") {
    const [match] = await ctx.db.insert(matches).values({ title: "Synthetic options fixture", createdByUserId: actor, kind, status, format: kind === "tutorial" ? "1v1" : "2v2", finishedAt: new Date(`2026-09-${String(day).padStart(2, "0")}T10:00:00Z`) }).returning();
    await ctx.db.insert(matchParticipants).values([{ matchId: match!.id, userId: actor, side: "A" }, { matchId: match!.id, userId: opponentId, side: "B" }, ...(kind === "tutorial" ? [] : [{ matchId: match!.id, userId: mate!, side: "A" }, { matchId: match!.id, guestFirstName: "Guest", guestLastName: "Fixture", side: "B" }])]);
  }
  await historical(frequent!, 4); await historical(frequent!, 5); await historical(recent!, 8);
  await historical(blocked!, 9); await historical(mate!, 10, "tutorial"); await historical(frequent!, 11, "standalone", "voided");
  const response = await app.inject({ method: "GET", url: "/api/v1/matches/create-options", headers: { cookie } });
  expect(response.statusCode).toBe(200);
  const result = response.json();
  expect(result.teams).toEqual([{ id: teamRows[0]!.id, name: "Own active", userIds: [mate] }]);
  expect(result.recentOpponentIds).toEqual([recent, frequent]);
  expect(result.frequentOpponentIds).toEqual([frequent, recent]);
  expect(result.users.map((u: { id: string }) => u.id).sort()).toEqual([recent, frequent, mate].sort());
  expect(Object.keys(result.users[0]).sort()).toEqual(["id", "firstName", "lastName", "displayName", "avatarKey"].sort());
  expect((await app.inject({ method: "GET", url: "/api/v1/matches/create-options" })).statusCode).toBe(401);
});
