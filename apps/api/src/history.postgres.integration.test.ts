import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createPostgresDb, type Db } from "./db/client.js";
import { runPostgresMigrations } from "./db/migrations.js";
import { matches, tournamentParticipants, tournaments, users } from "./db/schema.js";
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

  it("rejects impossible cursor dates before PostgreSQL while retaining leap dates and microseconds", async () => {
    const cursorFor = (occurredAt: string) => Buffer.from(
      JSON.stringify({
        v: 1,
        occurredAt,
        type: "match",
        id: "00000000-0000-4000-8000-000000000001",
      }),
      "utf8",
    ).toString("base64url");
    for (const impossibleDate of [
      "2026-02-30T00:00:00.123456Z",
      "2025-02-29T00:00:00.123456Z",
      "2026-09-06T10:00:00.123456+20:00",
      "2026-09-06T10:00:00.123456-16:00",
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/history?cursor=${encodeURIComponent(cursorFor(impossibleDate))}`,
        cookies: { tab10_session: cookie },
      });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().code).toBe("VALIDATION");
    }
    for (const validDate of [
      "2024-02-29T00:00:00.123456Z",
      "2026-09-06T10:00:00.000Z",
      "2026-09-06T10:00:00.123456+15:59",
      "2026-09-06T10:00:00.123456-15:59",
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/history?cursor=${encodeURIComponent(cursorFor(validDate))}`,
        cookies: { tab10_session: cookie },
      });
      expect(response.statusCode, response.body).toBe(200);
    }
  });

  it("preserves filtered cursor and tournament-result semantics", async () => {
    const occurredAt = new Date("2026-09-06T10:00:00.000Z");
    const matchIds: string[] = [];
    for (const [index, title] of ["Очный матч А", "Очный матч Б"].entries()) {
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
      await db.execute(
        sql`update matches set finished_at = ${`2026-09-06T10:00:00.12345${index}Z`}::timestamptz where id = ${match!.id}::uuid`,
      );
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
      sideA: "Tab10 Admin",
      sideB: "Соперник Борис",
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
          sideA: null,
          sideB: null,
          id: tournament!.id,
          type: "tournament",
          status: "finished",
          result: "win",
        },
      ],
      nextCursor: null,
    });
  });

  it("searches all 2x2 participants before limit without leaking a foreign active match", async () => {
    const teammate = await services.auth.createUser({
      email: "history-teammate@tab10.test",
      firstName: "Тимофей",
      lastName: "Напарник",
      role: "user",
      issuedByAdminId: actorId,
    });
    const blocked = await services.auth.createUser({
      email: "history-blocked@tab10.test",
      firstName: "Юникод",
      lastName: "Редкий%_\\Участник",
      role: "user",
      issuedByAdminId: actorId,
    });
    const privateOwner = await services.auth.createUser({
      email: "history-private@tab10.test",
      firstName: "Приватный",
      lastName: "Организатор",
      role: "user",
      issuedByAdminId: actorId,
    });

    const target = await services.matches.createMatch({
      createdByUserId: actorId,
      title: "Старая операторская пара",
      format: "2v2",
      participants: [
        { side: "A", userId: teammate.user.id },
        { side: "A", userId: blocked.user.id },
        { side: "B", userId: rivalId },
        {
          side: "B",
          guestFirstName: "Григорий",
          guestLastName: "Гость",
        },
      ],
    });
    await db
      .update(matches)
      .set({
        status: "finished",
        scoreA: 8,
        scoreB: 11,
        winnerSide: "B",
        finishedAt: new Date("2026-09-01T10:00:00.000Z"),
        updatedAt: new Date("2026-09-01T10:00:00.000Z"),
      })
      .where(eq(matches.id, target!.id));

    const hiddenActive = await services.matches.createMatch({
      createdByUserId: privateOwner.user.id,
      title: "Чужая активная встреча",
      format: "1v1",
      participants: [
        { side: "A", userId: blocked.user.id },
        { side: "B", userId: rivalId },
      ],
    });
    await db
      .update(users)
      .set({ status: "blocked" })
      .where(eq(users.id, blocked.user.id));

    for (let index = 0; index < 23; index += 1) {
      const noise = await services.matches.createMatch({
        createdByUserId: actorId,
        title: `Новая встреча ${index}`,
        format: "1v1",
        participants: [
          { side: "A", userId: actorId },
          { side: "B", userId: teammate.user.id },
        ],
      });
      const occurredAt = new Date(
        `2026-09-${String(index + 2).padStart(2, "0")}T10:00:00.000Z`,
      );
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
        .where(eq(matches.id, noise!.id));
    }

    const query = new URLSearchParams({
      eventType: "match",
      q: "Редкий%_\\Участник",
    });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/history?${query.toString()}`,
      cookies: { tab10_session: cookie },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        {
          id: target!.id,
          roles: ["organizer"],
          sideA: "Напарник Тимофей / Редкий%_\\Участник Юникод",
          sideB: "Григорий Гость / Соперник Борис",
        },
      ],
      nextCursor: null,
    });
    expect(response.json().items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: hiddenActive!.id })]),
    );
  });
});
