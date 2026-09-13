import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import {
  matchParticipants,
  matches,
  tournamentParticipants,
  tournaments,
} from "./db/schema.js";

type SessionUser = { id: string; cookie: string };

describe("AT-VIS-003 history filters and pagination", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let db: Db;
  let close: () => Promise<void>;
  let clock: FakeClock;
  let adminCookie: string;
  let actor: SessionUser;
  let rival: SessionUser;
  let outsider: SessionUser;

  beforeEach(async () => {
    const context = await createMigratedPgliteDb();
    db = context.db;
    close = context.close;
    clock = new FakeClock(new Date("2026-09-07T12:00:00.000Z"));
    const built = await buildApp({ db, clock });
    app = built.app;
    services = built.services;

    await services.auth.seedAdmin("admin@tab10.local", "AdminPass1!");
    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@tab10.local", password: "AdminPass1!" },
    });
    adminCookie = adminLogin.cookies.find(
      (cookie) => cookie.name === "tab10_session",
    )!.value;
    actor = await createActiveUser("Анна", "Игрок");
    rival = await createActiveUser("Борис", "Соперник");
    outsider = await createActiveUser("Олег", "Зритель");
  });

  afterEach(async () => {
    if (app) await app.close();
    if (close) await close();
  });

  async function createActiveUser(
    firstName: string,
    lastName: string,
  ): Promise<SessionUser> {
    const label = firstName.toLowerCase();
    const email = `${label}@history.test`;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      cookies: { tab10_session: adminCookie },
      payload: { email, firstName, lastName },
    });
    expect(created.statusCode).toBe(200);
    const firstLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email,
        password: created.json().temporaryPassword as string,
      },
    });
    const temporaryCookie = firstLogin.cookies.find(
      (cookie) => cookie.name === "tab10_session",
    )!.value;
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/first-change",
      cookies: { tab10_session: temporaryCookie },
      payload: { newPassword: "UserPass1!" },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: "UserPass1!" },
    });
    return {
      id: created.json().user.id as string,
      cookie: login.cookies.find(
        (cookie) => cookie.name === "tab10_session",
      )!.value,
    };
  }

  async function createMatch(input: {
    title: string;
    status: "waiting" | "finished" | "stopped" | "cancelled" | "voided";
    occurredAt: Date;
    winnerSide?: "A" | "B";
    kind?: "standalone" | "tutorial";
  }) {
    const row = await services.matches.createMatch({
      createdByUserId: actor.id,
      title: input.title,
      format: "1v1",
      kind: input.kind,
      participants: [
        { side: "A", userId: actor.id },
        ...(input.kind === "tutorial"
          ? [
              {
                side: "B" as const,
                guestFirstName: "Призрачный",
                guestLastName: "Олег",
                isTutorialActor: true,
              },
            ]
          : [{ side: "B" as const, userId: rival.id }]),
      ],
    });
    await db
      .update(matches)
      .set({
        status: input.status,
        scoreA: input.winnerSide === "A" ? 11 : 7,
        scoreB: input.winnerSide === "B" ? 11 : 7,
        winnerSide: input.winnerSide,
        finishedAt: input.status === "waiting" ? null : input.occurredAt,
        updatedAt: input.occurredAt,
      })
      .where(eq(matches.id, row!.id));
    return row!.id;
  }

  async function getHistory(user: SessionUser, query = "") {
    return app.inject({
      method: "GET",
      url: `/api/v1/history${query}`,
      cookies: { tab10_session: user.cookie },
    });
  }

  it("combines filters without leaking active/tutorial rows and keeps voided terminal but result-neutral", async () => {
    const wonId = await createMatch({
      title: "Личная встреча",
      status: "finished",
      winnerSide: "A",
      occurredAt: new Date("2026-09-06T10:00:00.000Z"),
    });
    const voidedId = await createMatch({
      title: "Ошибочный результат",
      status: "voided",
      winnerSide: "A",
      occurredAt: new Date("2026-09-06T11:00:00.000Z"),
    });
    const privateActiveId = await createMatch({
      title: "Активный матч Анны",
      status: "waiting",
      occurredAt: new Date("2026-09-07T09:00:00.000Z"),
    });
    const tutorialId = await createMatch({
      title: "Tutorial secret",
      status: "finished",
      winnerSide: "A",
      occurredAt: new Date("2026-09-07T10:00:00.000Z"),
      kind: "tutorial",
    });
    const tournament = await services.tournaments.create({
      createdByUserId: actor.id,
      title: "Кубок Весна",
      format: "single_elimination",
    });
    await db
      .update(tournaments)
      .set({
        status: "finished",
        finishedAt: new Date("2026-09-05T10:00:00.000Z"),
        updatedAt: new Date("2026-09-05T10:00:00.000Z"),
      })
      .where(eq(tournaments.id, tournament!.id));

    const combined = await getHistory(
      actor,
      "?role=player&result=win&eventType=match&q=%D0%B1%D0%BE%D1%80%D0%B8%D1%81&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-07T00%3A00%3A00.000Z",
    );
    expect(combined.statusCode).toBe(200);
    expect(combined.json()).toMatchObject({
      items: [
        {
          type: "match",
          id: wonId,
          status: "finished",
          result: "win",
          roles: ["player", "organizer"],
        },
      ],
      nextCursor: null,
    });

    const outsiderHistory = await getHistory(outsider);
    expect(outsiderHistory.statusCode).toBe(200);
    const outsiderIds = (outsiderHistory.json().items as Array<{ id: string }>).map(
      (item) => item.id,
    );
    expect(outsiderIds).toContain(wonId);
    expect(outsiderIds).toContain(voidedId);
    expect(outsiderIds).toContain(tournament!.id);
    expect(outsiderIds).not.toContain(privateActiveId);
    expect(outsiderIds).not.toContain(tutorialId);
    expect(
      outsiderHistory.json().items.find(
        (item: { id: string }) => item.id === voidedId,
      ),
    ).toMatchObject({ status: "voided", result: null });
  });

  it("HISTORY-002: filters finished tournament champions and non-champions without inventing other results", async () => {
    async function createTournamentResult(input: {
      title: string;
      status: "finished" | "stopped" | "cancelled";
      actorParticipates: boolean;
      actorWins?: boolean;
      occurredAt: Date;
    }) {
      const tournament = await services.tournaments.create({
        createdByUserId: outsider.id,
        title: input.title,
        format: "single_elimination",
      });
      const rivalParticipantId = crypto.randomUUID();
      const participantRows = [
        {
          id: rivalParticipantId,
          tournamentId: tournament!.id,
          userId: rival.id,
          status: "active",
        },
      ];
      let actorParticipantId: string | null = null;
      if (input.actorParticipates) {
        actorParticipantId = crypto.randomUUID();
        participantRows.push({
          id: actorParticipantId,
          tournamentId: tournament!.id,
          userId: actor.id,
          status: "active",
        });
      }
      await db.insert(tournamentParticipants).values(participantRows);
      const championParticipantId =
        input.status === "finished"
          ? input.actorWins
            ? actorParticipantId
            : rivalParticipantId
          : null;
      await db
        .update(tournaments)
        .set({
          status: input.status,
          bracketJson: { championParticipantId },
          finishedAt: input.occurredAt,
          updatedAt: input.occurredAt,
        })
        .where(eq(tournaments.id, tournament!.id));
      return tournament!.id;
    }

    const winId = await createTournamentResult({
      title: "Финал с победой",
      status: "finished",
      actorParticipates: true,
      actorWins: true,
      occurredAt: new Date("2026-09-04T10:00:00.000Z"),
    });
    const lossId = await createTournamentResult({
      title: "Финал с поражением",
      status: "finished",
      actorParticipates: true,
      actorWins: false,
      occurredAt: new Date("2026-09-03T10:00:00.000Z"),
    });
    const stoppedId = await createTournamentResult({
      title: "Остановленный кубок",
      status: "stopped",
      actorParticipates: true,
      occurredAt: new Date("2026-09-02T10:00:00.000Z"),
    });
    const cancelledId = await createTournamentResult({
      title: "Отменённый кубок",
      status: "cancelled",
      actorParticipates: true,
      occurredAt: new Date("2026-09-01T10:00:00.000Z"),
    });
    const nonParticipantId = await createTournamentResult({
      title: "Чужой финал",
      status: "finished",
      actorParticipates: false,
      actorWins: false,
      occurredAt: new Date("2026-08-31T10:00:00.000Z"),
    });

    const all = await getHistory(actor, "?eventType=tournament");
    expect(all.statusCode).toBe(200);
    const resultById = new Map(
      (all.json().items as Array<{ id: string; result: string | null }>).map(
        (item) => [item.id, item.result],
      ),
    );
    expect(resultById.get(winId)).toBe("win");
    expect(resultById.get(lossId)).toBe("loss");
    expect(resultById.get(stoppedId)).toBeNull();
    expect(resultById.get(cancelledId)).toBeNull();
    expect(resultById.get(nonParticipantId)).toBeNull();

    const wins = await getHistory(
      actor,
      "?eventType=tournament&result=win",
    );
    expect(wins.statusCode).toBe(200);
    expect(wins.json().items).toEqual([
      expect.objectContaining({ id: winId, result: "win" }),
    ]);

    const losses = await getHistory(
      actor,
      "?eventType=tournament&result=loss",
    );
    expect(losses.statusCode).toBe(200);
    expect(losses.json().items).toEqual([
      expect.objectContaining({ id: lossId, result: "loss" }),
    ]);
  });

  it("uses a stable opaque cursor across equal timestamps", async () => {
    const occurredAt = new Date("2026-09-06T10:00:00.000Z");
    const ids = await Promise.all(
      ["A", "B", "C", "D", "E"].map((title) =>
        createMatch({ title, status: "cancelled", occurredAt }),
      ),
    );

    const first = await getHistory(actor, "?limit=2");
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(2);
    expect(first.json().nextCursor).toEqual(expect.any(String));
    const second = await getHistory(
      actor,
      `?limit=2&cursor=${encodeURIComponent(first.json().nextCursor as string)}`,
    );
    const third = await getHistory(
      actor,
      `?limit=2&cursor=${encodeURIComponent(second.json().nextCursor as string)}`,
    );
    const traversed = [first, second, third].flatMap((response) =>
      (response.json().items as Array<{ id: string }>).map((item) => item.id),
    );
    expect(traversed).toHaveLength(5);
    expect(new Set(traversed)).toEqual(new Set(ids));
    expect(third.json().nextCursor).toBeNull();
  });

  it("HISTORY-002: searches only the participating actor's opposing side in doubles", async () => {
    const teammate = await createActiveUser("Тимофей", "Напарник");
    const [match] = await db
      .insert(matches)
      .values({
        title: "Парная встреча",
        kind: "standalone",
        status: "finished",
        format: "2v2",
        createdByUserId: actor.id,
        scoreA: 11,
        scoreB: 8,
        winnerSide: "A",
        finishedAt: new Date("2026-09-06T10:00:00.000Z"),
        updatedAt: new Date("2026-09-06T10:00:00.000Z"),
      })
      .returning();
    await db.insert(matchParticipants).values([
      { matchId: match!.id, side: "A", userId: actor.id },
      { matchId: match!.id, side: "A", userId: teammate.id },
      { matchId: match!.id, side: "B", userId: rival.id },
      {
        matchId: match!.id,
        side: "B",
        guestFirstName: "Григорий",
        guestLastName: "Гость",
      },
    ]);

    const teammateSearch = await getHistory(
      actor,
      "?eventType=match&q=%D0%BD%D0%B0%D0%BF%D0%B0%D1%80%D0%BD%D0%B8%D0%BA",
    );
    expect(teammateSearch.statusCode).toBe(200);
    expect(teammateSearch.json().items).toEqual([]);

    const registeredOpponent = await getHistory(
      actor,
      "?eventType=match&q=%D1%81%D0%BE%D0%BF%D0%B5%D1%80%D0%BD%D0%B8%D0%BA",
    );
    expect(registeredOpponent.json().items).toEqual([
      expect.objectContaining({ id: match!.id }),
    ]);

    const guestOpponent = await getHistory(
      actor,
      "?eventType=match&q=%D0%B3%D0%BE%D1%81%D1%82%D1%8C",
    );
    expect(guestOpponent.json().items).toEqual([
      expect.objectContaining({ id: match!.id }),
    ]);

    const viewerSearch = await getHistory(
      outsider,
      "?eventType=match&q=%D0%BD%D0%B0%D0%BF%D0%B0%D1%80%D0%BD%D0%B8%D0%BA",
    );
    expect(viewerSearch.json().items).toEqual([
      expect.objectContaining({ id: match!.id, roles: ["viewer"] }),
    ]);
  });

  it("filters current and historical judging without granting outsider access", async () => {
    const judged = await services.matches.createMatch({
      createdByUserId: rival.id,
      title: "Судейский матч",
      format: "1v1",
      participants: [
        { side: "A", userId: rival.id },
        { side: "B", userId: outsider.id },
      ],
    });
    const acquired = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${judged!.id}/judge/acquire`,
      cookies: { tab10_session: actor.cookie },
    });
    expect(acquired.statusCode).toBe(200);

    const current = await getHistory(actor, "?role=judge&eventType=match");
    expect(current.statusCode).toBe(200);
    expect(current.json().items).toEqual([
      expect.objectContaining({
        id: judged!.id,
        status: "waiting",
        roles: ["judge"],
      }),
    ]);

    clock.advanceMs(120_001);
    const expired = await getHistory(actor, "?role=judge&eventType=match");
    expect(expired.statusCode).toBe(200);
    expect(expired.json().items).toEqual([]);

    await db
      .update(matches)
      .set({
        status: "stopped",
        finishedAt: clock.now(),
        updatedAt: clock.now(),
      })
      .where(eq(matches.id, judged!.id));
    const historical = await getHistory(actor, "?role=judge&eventType=match");
    expect(historical.statusCode).toBe(200);
    expect(historical.json().items).toEqual([
      expect.objectContaining({ id: judged!.id, status: "stopped" }),
    ]);
  });

  it("rejects invalid filters/cursors and requires an active authenticated session", async () => {
    const invalid = await getHistory(actor, "?eventType=league&cursor=not-a-cursor");
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe("VALIDATION");

    const malformedUuidCursor = Buffer.from(
      JSON.stringify({
        v: 1,
        occurredAt: "2026-09-06T10:00:00.000Z",
        type: "match",
        id: "------------------------------------",
      }),
      "utf8",
    ).toString("base64url");
    const invalidUuid = await getHistory(
      actor,
      `?cursor=${encodeURIComponent(malformedUuidCursor)}`,
    );
    expect(invalidUuid.statusCode).toBe(400);
    expect(invalidUuid.json().code).toBe("VALIDATION");

    const anonymous = await app.inject({
      method: "GET",
      url: "/api/v1/history",
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().code).toBe("UNAUTHORIZED");
  });
});
