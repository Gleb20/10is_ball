import { FakeClock } from "@tab10/test-utils";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import { matchParticipants, matches } from "./db/schema.js";

describe("BUG-014 Europe/Moscow ranking periods", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let db: Db;
  let clock: FakeClock;
  let close: () => Promise<void>;
  let winnerId: string;
  let loserId: string;

  beforeEach(async () => {
    const ctx = await createMigratedPgliteDb();
    db = ctx.db;
    close = ctx.close;
    clock = new FakeClock();
    const built = await buildApp({ db, clock });
    app = built.app;
    services = built.services;

    const seeded = await services.auth.seedAdmin(
      "admin@rank-period.local",
      "AdminPass1!",
    );
    const winner = await services.auth.createUser({
      email: "winner@rank-period.local",
      firstName: "Winner",
      lastName: "Moscow",
      role: "user",
      issuedByAdminId: seeded.user.id,
    });
    const loser = await services.auth.createUser({
      email: "loser@rank-period.local",
      firstName: "Loser",
      lastName: "Moscow",
      role: "user",
      issuedByAdminId: seeded.user.id,
    });
    winnerId = winner.user.id;
    loserId = loser.user.id;
  });

  afterEach(async () => {
    await app.close();
    await close();
  });

  async function insertFinishedMatch(finishedAt: string) {
    const [match] = await db
      .insert(matches)
      .values({
        title: `Boundary ${finishedAt}`,
        kind: "standalone",
        status: "finished",
        format: "1v1",
        createdByUserId: winnerId,
        winnerSide: "A",
        finishedAt: new Date(finishedAt),
      })
      .returning();
    await db.insert(matchParticipants).values([
      { matchId: match!.id, side: "A", userId: winnerId },
      { matchId: match!.id, side: "B", userId: loserId },
    ]);
  }

  it.each([
    {
      period: "week",
      now: "2026-07-12T22:30:00.000Z",
      before: "2026-07-12T20:59:59.999Z",
      at: "2026-07-12T21:00:00.000Z",
    },
    {
      period: "month",
      now: "2026-06-30T22:30:00.000Z",
      before: "2026-06-30T20:59:59.999Z",
      at: "2026-06-30T21:00:00.000Z",
    },
  ])(
    "AT-RANK-002 $period includes the Moscow boundary and excludes the prior instant",
    async ({ period, now, before, at }) => {
      clock.set(new Date(now));
      await insertFinishedMatch(before);
      await insertFinishedMatch(at);
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: "admin@rank-period.local",
          password: "AdminPass1!",
        },
      });
      const adminCookie = login.cookies.find(
        (cookie) => cookie.name === "tab10_session",
      )!.value;

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/rankings?period=${period}`,
        cookies: { tab10_session: adminCookie },
      });

      expect(response.statusCode).toBe(200);
      const ranking = response.json().rankings as Array<{
        userId: string;
        wins: number;
        losses: number;
        matchesPlayed: number;
      }>;
      expect(ranking.find((entry) => entry.userId === winnerId)).toMatchObject({
        wins: 1,
        losses: 0,
        matchesPlayed: 1,
      });
      expect(ranking.find((entry) => entry.userId === loserId)).toMatchObject({
        wins: 0,
        losses: 1,
        matchesPlayed: 1,
      });
    },
  );
});
