import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createPostgresDb, type Db } from "./db/client.js";
import { runPostgresMigrations } from "./db/migrations.js";
import { matches, tournamentParticipants, tournaments } from "./db/schema.js";
import { resolveTestDatabaseUrl } from "./db/test-database-url.js";

const databaseUrl = resolveTestDatabaseUrl(process.env, { required: true });

describe("AT-VIS-003 history PostgreSQL result shape", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let db: Db;
  let close: () => Promise<void>;
  let cookie: string;
  let actorId: string;
  let rivalId: string;

  beforeEach(async () => {
    const postgres = (await import("postgres")).default;
    const reset = postgres(databaseUrl!, { max: 1 });
    try {
      await reset.unsafe(`
        DROP SCHEMA IF EXISTS drizzle CASCADE;
        DROP SCHEMA public CASCADE;
        CREATE SCHEMA public
      `);
    } finally {
      await reset.end({ timeout: 5 });
    }
    await runPostgresMigrations(databaseUrl!, "apply");

    const context = await createPostgresDb(databaseUrl!);
    db = context.db;
    close = context.close;
    const built = await buildApp({
      db: context.db,
      clock: new FakeClock(new Date("2026-09-07T12:00:00.000Z")),
    });
    app = built.app;
    services = built.services;
    const seeded = await services.auth.seedAdmin(
      "history-postgres@tab10.test",
      "AdminPass1!",
    );
    actorId = seeded.user.id;
    const rival = await services.auth.createUser({
      email: "history-rival@tab10.test",
      firstName: "Борис",
      lastName: "Соперник",
      role: "user",
      issuedByAdminId: actorId,
    });
    rivalId = rival.user.id;
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "history-postgres@tab10.test",
        password: "AdminPass1!",
      },
    });
    expect(login.statusCode).toBe(200);
    cookie = login.cookies.find(
      (entry) => entry.name === "tab10_session",
    )!.value;
  });

  afterEach(async () => {
    if (app) await app.close();
    if (close) await close();
  });

  it("returns the same empty feed contract as PGlite", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/history",
      cookies: { tab10_session: cookie },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ items: [], nextCursor: null });
  });

  it("preserves filtered cursor and tournament-result semantics", async () => {
    const occurredAt = new Date("2026-09-06T10:00:00.000Z");
    const matchIds: string[] = [];
    for (const title of ["Очный матч А", "Очный матч Б"]) {
      const match = await services.matches.createMatch({
        createdByUserId: actorId,
        title,
        format: "1v1",
        participants: [
          { side: "A", userId: actorId },
          { side: "B", userId: rivalId },
        ],
      });
      matchIds.push(match!.id);
      await db
        .update(matches)
        .set({
          status: "finished",
          scoreA: 11,
          scoreB: 7,
          winnerSide: "A",
          finishedAt: occurredAt,
          updatedAt: occurredAt,
        })
        .where(eq(matches.id, match!.id));
    }

    const tournament = await services.tournaments.create({
      createdByUserId: actorId,
      title: "Кубок PostgreSQL",
      format: "single_elimination",
    });
    const championParticipant =
      await db.query.tournamentParticipants.findFirst({
        where: and(
          eq(tournamentParticipants.tournamentId, tournament!.id),
          eq(tournamentParticipants.userId, actorId),
        ),
      });
    expect(championParticipant).toBeDefined();
    await db.insert(tournamentParticipants).values({
      id: crypto.randomUUID(),
      tournamentId: tournament!.id,
      userId: rivalId,
      status: "active",
    });
    await db
      .update(tournaments)
      .set({
        status: "finished",
        bracketJson: { championParticipantId: championParticipant!.id },
        finishedAt: new Date("2026-09-05T10:00:00.000Z"),
        updatedAt: new Date("2026-09-05T10:00:00.000Z"),
      })
      .where(eq(tournaments.id, tournament!.id));

    const first = await app.inject({
      method: "GET",
      url: "/api/v1/history?eventType=match&result=win&q=%D0%B1%D0%BE%D1%80%D0%B8%D1%81&from=2026-09-06T00%3A00%3A00.000Z&to=2026-09-06T23%3A59%3A59.999Z&limit=1",
      cookies: { tab10_session: cookie },
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().items).toHaveLength(1);
    expect(first.json().items[0]).toMatchObject({
      type: "match",
      result: "win",
    });
    expect(matchIds).toContain(first.json().items[0].id);
    expect(first.json().nextCursor).toEqual(expect.any(String));

    const second = await app.inject({
      method: "GET",
      url: `/api/v1/history?eventType=match&result=win&q=%D0%B1%D0%BE%D1%80%D0%B8%D1%81&from=2026-09-06T00%3A00%3A00.000Z&to=2026-09-06T23%3A59%3A59.999Z&limit=1&cursor=${encodeURIComponent(first.json().nextCursor as string)}`,
      cookies: { tab10_session: cookie },
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().items).toHaveLength(1);
    expect(second.json().items[0]).toMatchObject({
      type: "match",
      result: "win",
    });
    expect(second.json().items[0].id).not.toBe(first.json().items[0].id);
    expect(second.json().nextCursor).toBeNull();

    const tournamentWin = await app.inject({
      method: "GET",
      url: "/api/v1/history?eventType=tournament&result=win",
      cookies: { tab10_session: cookie },
    });
    expect(tournamentWin.statusCode, tournamentWin.body).toBe(200);
    expect(tournamentWin.json()).toMatchObject({
      items: [
        {
          id: tournament!.id,
          type: "tournament",
          status: "finished",
          result: "win",
        },
      ],
      nextCursor: null,
    });
  });
});
