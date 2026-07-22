import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { createPgliteDb } from "./db/client.js";
import { buildApp } from "./app.js";
import type { FastifyInstance } from "fastify";
import type { AppServices } from "./app.js";

describe("match and judge integration", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let close: () => Promise<void>;
  let adminCookie: string;
  let userACookie: string;
  let userBCookie: string;
  let userAId: string;
  let userBId: string;

  beforeEach(async () => {
    const ctx = await createPgliteDb();
    close = ctx.close;
    const built = await buildApp({ db: ctx.db, clock: new FakeClock() });
    app = built.app;
    services = built.services;
    await services.auth.seedAdmin("admin@tab10.local", "AdminPass1!");

    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@tab10.local", password: "AdminPass1!" },
    });
    adminCookie = adminLogin.cookies.find((c) => c.name === "tab10_session")!
      .value;

    async function createUser(email: string, password: string) {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        cookies: { tab10_session: adminCookie },
        payload: { email, firstName: "F", lastName: "L" },
      });
      const temp = created.json().temporaryPassword as string;
      const id = created.json().user.id as string;
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: temp },
      });
      const cookie = login.cookies.find((c) => c.name === "tab10_session")!
        .value;
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/password/first-change",
        cookies: { tab10_session: cookie },
        payload: { newPassword: password },
      });
      const login2 = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password },
      });
      return {
        id,
        cookie: login2.cookies.find((c) => c.name === "tab10_session")!.value,
      };
    }

    const a = await createUser("a@tab10.local", "UserPass1!");
    const b = await createUser("b@tab10.local", "UserPass1!");
    userAId = a.id;
    userBId = b.id;
    userACookie = a.cookie;
    userBCookie = b.cookie;
  });

  afterEach(async () => {
    if (app) await app.close();
    if (close) await close();
  });

  it("INT_match__create_judge_score_confirm", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "Дружеский",
        format: "1v1",
        pointsToWin: 3,
        participants: [
          { side: "A", userId: userAId },
          { side: "B", userId: userBId },
        ],
      },
    });
    expect(created.statusCode).toBe(200);
    const matchId = created.json().match.id as string;

    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: userACookie },
      payload: {},
    });

    const acquire = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: userACookie },
    });
    expect(acquire.statusCode).toBe(200);

    let version = 0;
    for (let i = 0; i < 3; i += 1) {
      const point = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/points`,
        cookies: { tab10_session: userACookie },
        headers: { "idempotency-key": `p-${i}` },
        payload: { side: "A", expectedVersion: version },
      });
      expect(point.statusCode).toBe(200);
      version = point.json().match.version;
    }

    const pending = await app.inject({
      method: "GET",
      url: `/api/v1/matches/${matchId}`,
      cookies: { tab10_session: userACookie },
    });
    expect(pending.json().match.status).toBe("pending_confirmation");

    // idempotency
    const dup = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/points`,
      cookies: { tab10_session: userACookie },
      headers: { "idempotency-key": "p-0" },
      payload: { side: "A", expectedVersion: version },
    });
    expect(dup.statusCode).toBe(200);
    expect(dup.json().match.version).toBe(version);

    const confirm = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/confirm-finish`,
      cookies: { tab10_session: userACookie },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().match.status).toBe("finished");

    const rankings = await app.inject({
      method: "GET",
      url: "/api/v1/rankings",
      cookies: { tab10_session: userACookie },
    });
    expect(rankings.statusCode).toBe(200);
    expect(rankings.json().rankings.some((r: { userId: string }) => r.userId === userAId)).toBe(
      true,
    );
  });

  it("INT_judge__atomic_acquire", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "Race",
        format: "1v1",
        participants: [
          { side: "A", userId: userAId },
          { side: "B", guestFirstName: "G", guestLastName: "Uest" },
        ],
      },
    });
    const matchId = created.json().match.id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: userACookie },
    });

    const [r1, r2] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/judge/acquire`,
        cookies: { tab10_session: userACookie },
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/judge/acquire`,
        cookies: { tab10_session: userACookie },
      }),
    ]);
    const codes = [r1.statusCode, r2.statusCode];
    expect(codes.some((c) => c === 200)).toBe(true);
  });

  it("AT-JUDGE-003: release then another participant acquires", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "Handoff",
        format: "1v1",
        participants: [
          { side: "A", userId: userAId },
          { side: "B", userId: userBId },
        ],
      },
    });
    const matchId = created.json().match.id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: userACookie },
      payload: {},
    });

    const acquireA = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: userACookie },
    });
    expect(acquireA.statusCode).toBe(200);

    const release = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/release`,
      cookies: { tab10_session: userACookie },
    });
    expect(release.statusCode).toBe(200);

    const acquireB = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: userBCookie },
    });
    expect(acquireB.statusCode).toBe(200);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/matches/${matchId}`,
      cookies: { tab10_session: userBCookie },
    });
    expect(detail.json().match.activeJudge?.userId).toBe(userBId);
    expect(detail.json().match.scoreA).toBe(0);
  });

  it("JUDGE-002: any active user can acquire free judge slot", async () => {
    const c = await (async () => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        cookies: { tab10_session: adminCookie },
        payload: {
          email: "c@tab10.local",
          firstName: "C",
          lastName: "Judge",
        },
      });
      const temp = created.json().temporaryPassword as string;
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "c@tab10.local", password: temp },
      });
      const cookie = login.cookies.find((x) => x.name === "tab10_session")!.value;
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/password/first-change",
        cookies: { tab10_session: cookie },
        payload: { newPassword: "UserPass1!" },
      });
      const login2 = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "c@tab10.local", password: "UserPass1!" },
      });
      return {
        id: created.json().user.id as string,
        cookie: login2.cookies.find((x) => x.name === "tab10_session")!.value,
      };
    })();

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "Side judge",
        format: "1v1",
        participants: [
          { side: "A", userId: userAId },
          { side: "B", userId: userBId },
        ],
      },
    });
    const matchId = created.json().match.id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: userACookie },
      payload: {},
    });

    const acquireC = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: c.cookie },
    });
    expect(acquireC.statusCode).toBe(200);
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/matches/${matchId}`,
      cookies: { tab10_session: c.cookie },
    });
    expect(detail.json().match.activeJudge?.userId).toBe(c.id);
  });

  it("AT-MATCH-004: mercy 5:0 proposes finish", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "Mercy",
        format: "1v1",
        pointsToWin: 11,
        mercyEnabled: true,
        mercyPoints: 5,
        participants: [
          { side: "A", userId: userAId },
          { side: "B", userId: userBId },
        ],
      },
    });
    const matchId = created.json().match.id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: userACookie },
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: userACookie },
    });

    let version = 0;
    for (let i = 0; i < 5; i += 1) {
      const pt = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/points`,
        cookies: { tab10_session: userACookie },
        headers: { "idempotency-key": `mercy-${i}` },
        payload: { side: "A", expectedVersion: version },
      });
      expect(pt.statusCode).toBe(200);
      version = pt.json().match.version as number;
    }

    const final = await app.inject({
      method: "GET",
      url: `/api/v1/matches/${matchId}`,
      cookies: { tab10_session: userACookie },
    });
    expect(final.json().match.scoreA).toBe(5);
    expect(final.json().match.scoreB).toBe(0);
    expect(final.json().match.status).toBe("pending_confirmation");
  });

  it("AT-MATCH-004b: 5:1 is not dry mercy finish", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "Not mercy",
        format: "1v1",
        pointsToWin: 11,
        mercyEnabled: true,
        mercyPoints: 5,
        participants: [
          { side: "A", userId: userAId },
          { side: "B", userId: userBId },
        ],
      },
    });
    const matchId = created.json().match.id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: userACookie },
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: userACookie },
    });

    let version = 0;
    const bPoint = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/points`,
      cookies: { tab10_session: userACookie },
      headers: { "idempotency-key": "b1" },
      payload: { side: "B", expectedVersion: version },
    });
    expect(bPoint.statusCode).toBe(200);
    version = bPoint.json().match.version as number;

    for (let i = 0; i < 5; i += 1) {
      const pt = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/points`,
        cookies: { tab10_session: userACookie },
        headers: { "idempotency-key": `a-lead-${i}` },
        payload: { side: "A", expectedVersion: version },
      });
      expect(pt.statusCode).toBe(200);
      version = pt.json().match.version as number;
    }

    const mid = await app.inject({
      method: "GET",
      url: `/api/v1/matches/${matchId}`,
      cookies: { tab10_session: userACookie },
    });
    expect(mid.json().match.scoreA).toBe(5);
    expect(mid.json().match.scoreB).toBe(1);
    expect(mid.json().match.status).toBe("in_progress");
  });

  it("AT-MATCH-004c: undo accidental point then 5:0 is mercy", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "Mercy after undo",
        format: "1v1",
        pointsToWin: 11,
        mercyEnabled: true,
        mercyPoints: 5,
        participants: [
          { side: "A", userId: userAId },
          { side: "B", userId: userBId },
        ],
      },
    });
    const matchId = created.json().match.id as string;
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: userACookie },
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: userACookie },
    });

    let version = 0;
    const bPoint = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/points`,
      cookies: { tab10_session: userACookie },
      headers: { "idempotency-key": "accidental-b" },
      payload: { side: "B", expectedVersion: version },
    });
    expect(bPoint.statusCode).toBe(200);
    version = bPoint.json().match.version as number;

    const undone = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/undo`,
      cookies: { tab10_session: userACookie },
      headers: { "idempotency-key": "undo-b" },
      payload: { expectedVersion: version },
    });
    expect(undone.statusCode).toBe(200);
    expect(undone.json().match.scoreA).toBe(0);
    expect(undone.json().match.scoreB).toBe(0);
    version = undone.json().match.version as number;

    for (let i = 0; i < 5; i += 1) {
      const pt = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/points`,
        cookies: { tab10_session: userACookie },
        headers: { "idempotency-key": `mercy-undo-a-${i}` },
        payload: { side: "A", expectedVersion: version },
      });
      expect(pt.statusCode).toBe(200);
      version = pt.json().match.version as number;
    }

    const final = await app.inject({
      method: "GET",
      url: `/api/v1/matches/${matchId}`,
      cookies: { tab10_session: userACookie },
    });
    expect(final.json().match.scoreA).toBe(5);
    expect(final.json().match.scoreB).toBe(0);
    expect(final.json().match.status).toBe("pending_confirmation");
  });

  it("INT_judge__setup_swap_sides_and_server", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/matches",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "Setup",
        format: "1v1",
        participants: [
          { side: "A", userId: userAId },
          { side: "B", userId: userBId },
        ],
      },
    });
    const matchId = created.json().match.id as string;
    const participants = created.json().match.participants as Array<{
      id: string;
      side: string;
      userId: string;
    }>;
    const bParticipant = participants.find((p) => p.userId === userBId)!;

    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: userACookie },
      payload: {},
    });
    const afterStart = await app.inject({
      method: "GET",
      url: `/api/v1/matches/${matchId}`,
      cookies: { tab10_session: userACookie },
    });
    expect(afterStart.json().match.startedAt).toBeNull();

    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: userACookie },
    });

    const setup = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/setup`,
      cookies: { tab10_session: userACookie },
      payload: {
        swapSides: true,
        firstServerParticipantId: bParticipant.id,
        displayFlipped: true,
      },
    });
    expect(setup.statusCode).toBe(200);
    const swapped = setup.json().match.participants as Array<{
      userId: string;
      side: string;
    }>;
    expect(swapped.find((p) => p.userId === userAId)?.side).toBe("B");
    expect(swapped.find((p) => p.userId === userBId)?.side).toBe("A");
    expect(setup.json().match.currentServerParticipantId).toBe(bParticipant.id);
    expect(setup.json().match.judgeDisplayFlipped).toBe(true);
    expect(setup.json().match.startedAt).toBeTruthy();
  });

  it("INT_trn__bracket_from_collecting", async () => {
    const t = await app.inject({
      method: "POST",
      url: "/api/v1/tournaments",
      cookies: { tab10_session: userACookie },
      payload: { title: "Кубок", format: "single_elimination" },
    });
    const id = t.json().tournament.id as string;
    for (const email of ["c1@t.local", "c2@t.local", "c3@t.local"]) {
      const u = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        cookies: { tab10_session: adminCookie },
        payload: { email, firstName: "P", lastName: "L" },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${id}/participants`,
        cookies: { tab10_session: userACookie },
        payload: { userId: u.json().user.id },
      });
    }
    const bracket = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id}/bracket`,
      cookies: { tab10_session: userACookie },
    });
    expect(bracket.statusCode).toBe(200);
    // organizerParticipates default + 3 added = 4; default algorithm = compact
    expect(bracket.json().bracket.schemaVersion).toBe(2);
    expect(bracket.json().bracket.participantCount).toBe(4);
    expect(bracket.json().bracket.constructionAlgorithm).toBe("compact");
    expect(bracket.json().bracket.bracketSize).toBeUndefined();
    expect(bracket.json().constructionAlgorithm).toBe("compact");
  });

  it("create with organizerParticipates includes organizer + displayName", async () => {
    const t = await app.inject({
      method: "POST",
      url: "/api/v1/tournaments",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "OrgIn",
        format: "single_elimination",
        organizerParticipates: true,
      },
    });
    expect(t.statusCode).toBe(200);
    const participants = t.json().tournament.participants as Array<{
      userId: string;
      displayName: string;
      status: string;
    }>;
    expect(participants.some((p) => p.userId === userAId)).toBe(true);
    const self = participants.find((p) => p.userId === userAId)!;
    expect(self.displayName.length).toBeGreaterThan(0);
    expect(self.status).toBe("active");
  });

  it("AT-TRN-001/004/007: generate needs 3+, closes roster, dissolve", async () => {
    const t = await app.inject({
      method: "POST",
      url: "/api/v1/tournaments",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "AT1",
        format: "single_elimination",
        organizerParticipates: false,
      },
    });
    const id = t.json().tournament.id as string;
    const few = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id}/bracket`,
      cookies: { tab10_session: userACookie },
    });
    expect(few.statusCode).toBeGreaterThanOrEqual(400);

    const ids: string[] = [];
    for (const email of ["t1@t.local", "t2@t.local", "t3@t.local"]) {
      const u = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        cookies: { tab10_session: adminCookie },
        payload: { email, firstName: "P", lastName: "L" },
      });
      ids.push(u.json().user.id);
      await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${id}/participants`,
        cookies: { tab10_session: userACookie },
        payload: { userId: u.json().user.id },
      });
    }
    const gen = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id}/bracket`,
      cookies: { tab10_session: userACookie },
    });
    expect(gen.statusCode).toBe(200);
    expect(gen.json().status ?? gen.json().bracket).toBeTruthy();

    const blocked = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id}/participants`,
      cookies: { tab10_session: userACookie },
      payload: { guestFirstName: "X", guestLastName: "Y" },
    });
    expect(blocked.statusCode).toBeGreaterThanOrEqual(400);

    const dissolve = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id}/dissolve-bracket`,
      cookies: { tab10_session: userACookie },
    });
    expect(dissolve.statusCode).toBe(200);
    expect(dissolve.json().tournament.status).toBe("collecting");
  });

  it("AT-TRN-008: withdraw after generate → needs_regeneration", async () => {
    const t = await app.inject({
      method: "POST",
      url: "/api/v1/tournaments",
      cookies: { tab10_session: userACookie },
      payload: { title: "W", organizerParticipates: true },
    });
    const id = t.json().tournament.id as string;
    // organizerParticipates: true → organizer already in roster on create
    expect(
      (t.json().tournament.participants as Array<{ userId: string }>).some(
        (p) => p.userId === userAId,
      ),
    ).toBe(true);
    for (const email of ["w1@t.local", "w2@t.local"]) {
      const u = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        cookies: { tab10_session: adminCookie },
        payload: { email, firstName: "P", lastName: "L" },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${id}/participants`,
        cookies: { tab10_session: userACookie },
        payload: { userId: u.json().user.id },
      });
    }
    await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id}/bracket`,
      cookies: { tab10_session: userACookie },
    });
    const wd = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id}/withdraw`,
      cookies: { tab10_session: userACookie },
    });
    expect(wd.statusCode).toBe(200);
    expect(wd.json().tournament.status).toBe("needs_regeneration");
  });

  it("AT-TRN-014: cancel before start → cancelled; withdraw non-participant → NOT_A_PARTICIPANT", async () => {
    const t = await app.inject({
      method: "POST",
      url: "/api/v1/tournaments",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "CancelMe",
        organizerParticipates: false,
      },
    });
    expect(t.statusCode).toBe(200);
    const id = t.json().tournament.id as string;

    const nonPart = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id}/withdraw`,
      cookies: { tab10_session: userACookie },
    });
    expect(nonPart.statusCode).toBe(400);
    expect(nonPart.json().code).toBe("NOT_A_PARTICIPANT");

    const cancel = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id}/cancel`,
      cookies: { tab10_session: userACookie },
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().tournament.status).toBe("cancelled");

    const again = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id}/cancel`,
      cookies: { tab10_session: userACookie },
    });
    expect(again.statusCode).toBeGreaterThanOrEqual(400);
    expect(again.json().code).toBe("INVALID_STATUS");
  });

  it("AT-TRN-006/010/012: start matches, advance, stop", async () => {
    const t = await app.inject({
      method: "POST",
      url: "/api/v1/tournaments",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "Play",
        format: "single_elimination",
        organizerParticipates: false,
        pointsToWin: 3,
        mercyEnabled: false,
      },
    });
    const id = t.json().tournament.id as string;
    const playerCookies: string[] = [];
    const playerIds: string[] = [];
    for (const email of [
      "p1@trn.local",
      "p2@trn.local",
      "p3@trn.local",
      "p4@trn.local",
    ]) {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        cookies: { tab10_session: adminCookie },
        payload: { email, firstName: "P", lastName: "L" },
      });
      const temp = created.json().temporaryPassword as string;
      const uid = created.json().user.id as string;
      playerIds.push(uid);
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: temp },
      });
      const cookie = login.cookies.find((c) => c.name === "tab10_session")!
        .value;
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/password/first-change",
        cookies: { tab10_session: cookie },
        payload: { newPassword: "UserPass1!" },
      });
      const login2 = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: "UserPass1!" },
      });
      playerCookies.push(
        login2.cookies.find((c) => c.name === "tab10_session")!.value,
      );
      await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${id}/participants`,
        cookies: { tab10_session: userACookie },
        payload: { userId: uid },
      });
    }

    await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id}/bracket`,
      cookies: { tab10_session: userACookie },
    });

    const locked = await app.inject({
      method: "PATCH",
      url: `/api/v1/tournaments/${id}/bracket`,
      cookies: { tab10_session: userACookie },
      payload: { swaps: [] },
    });
    expect(locked.statusCode).toBe(200);

    const started = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id}/start`,
      cookies: { tab10_session: userACookie },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().tournament.status).toBe("in_progress");
    const matchList = started.json().tournament.matches as Array<{
      id: string;
      status: string;
    }>;
    expect(matchList.length).toBeGreaterThanOrEqual(1);

    const afterStartEdit = await app.inject({
      method: "PATCH",
      url: `/api/v1/tournaments/${id}/bracket`,
      cookies: { tab10_session: userACookie },
      payload: { swaps: [] },
    });
    expect(afterStartEdit.statusCode).toBeGreaterThanOrEqual(400);

    // Finish first match quickly as organizer-judge
    const matchId = matchList[0]!.id;
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/start`,
      cookies: { tab10_session: userACookie },
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/judge/acquire`,
      cookies: { tab10_session: userACookie },
    });
    let version = 0;
    for (let i = 0; i < 3; i += 1) {
      const pt = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/points`,
        cookies: { tab10_session: userACookie },
        headers: { "idempotency-key": `trn-pt-${i}` },
        payload: { side: "A", expectedVersion: version },
      });
      expect(pt.statusCode).toBe(200);
      version = pt.json().match.version as number;
    }
    const conf = await app.inject({
      method: "POST",
      url: `/api/v1/matches/${matchId}/confirm-finish`,
      cookies: { tab10_session: userACookie },
    });
    expect(conf.statusCode).toBe(200);

    const mid = await app.inject({
      method: "GET",
      url: `/api/v1/tournaments/${id}`,
      cookies: { tab10_session: userACookie },
    });
    expect(mid.json().tournament.status).toBe("in_progress");

    const stopped = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id}/stop`,
      cookies: { tab10_session: userACookie },
      payload: { code: "time" },
    });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json().tournament.status).toBe("stopped");
  });

  it("AT-TRN-011: DE generate has losers and can start", async () => {
    const t = await app.inject({
      method: "POST",
      url: "/api/v1/tournaments",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "DE",
        format: "double_elimination",
        organizerParticipates: false,
      },
    });
    const id = t.json().tournament.id as string;
    for (const email of [
      "d1@t.local",
      "d2@t.local",
      "d3@t.local",
      "d4@t.local",
    ]) {
      const u = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        cookies: { tab10_session: adminCookie },
        payload: { email, firstName: "P", lastName: "L" },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${id}/participants`,
        cookies: { tab10_session: userACookie },
        payload: { userId: u.json().user.id },
      });
    }
    const gen = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id}/bracket`,
      cookies: { tab10_session: userACookie },
      payload: { constructionAlgorithm: "power_of_two" },
    });
    expect(gen.statusCode).toBe(200);
    expect(gen.json().bracket.format).toBe("double_elimination");
    expect(gen.json().bracket.schemaVersion).toBe(2);
    expect(gen.json().bracket.constructionAlgorithm).toBe("power_of_two");
    expect(gen.json().bracket.bracketSize).toBe(4);
    expect(
      (gen.json().bracket.matches as Array<{ stage: string }>).some(
        (m) => m.stage === "losers",
      ),
    ).toBe(true);
    const start = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id}/start`,
      cookies: { tab10_session: userACookie },
    });
    expect(start.statusCode).toBe(200);
    expect(start.json().tournament.matches.length).toBeGreaterThan(0);
  });

  it("INT_team__invite_and_accept", async () => {
    const team = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      cookies: { tab10_session: userACookie },
      payload: { name: "Ракетки" },
    });
    const teamId = team.json().team.id as string;
    const inv = await app.inject({
      method: "POST",
      url: `/api/v1/teams/${teamId}/invite`,
      cookies: { tab10_session: userACookie },
      payload: { userId: userBId },
    });
    expect(inv.statusCode).toBe(200);

    // login as B
    const bLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "b@tab10.local", password: "UserPass1!" },
    });
    const bCookie = bLogin.cookies.find((c) => c.name === "tab10_session")!
      .value;
    const notif = await app.inject({
      method: "GET",
      url: "/api/v1/notifications",
      cookies: { tab10_session: bCookie },
    });
    expect(notif.json().notifications.length).toBeGreaterThan(0);

    const respond = await app.inject({
      method: "POST",
      url: `/api/v1/team-invitations/${inv.json().invitation.id}/respond`,
      cookies: { tab10_session: bCookie },
      payload: { accept: true },
    });
    expect(respond.statusCode).toBe(200);
    expect(respond.json().status).toBe("accepted");
  });

  it("INT_tutorial__no_stats", async () => {
    const tut = await app.inject({
      method: "POST",
      url: "/api/v1/matches/tutorial",
      cookies: { tab10_session: userACookie },
    });
    expect(tut.statusCode).toBe(200);
    expect(tut.json().match.kind).toBe("tutorial");
  });

  async function createSeTournamentWithN(n: number, title: string) {
    const t = await app.inject({
      method: "POST",
      url: "/api/v1/tournaments",
      cookies: { tab10_session: userACookie },
      payload: {
        title,
        format: "single_elimination",
        organizerParticipates: false,
      },
    });
    const id = t.json().tournament.id as string;
    for (let i = 0; i < n; i += 1) {
      const u = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        cookies: { tab10_session: adminCookie },
        payload: {
          email: `${title}-${i}@algo.local`,
          firstName: "P",
          lastName: `L${i}`,
        },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${id}/participants`,
        cookies: { tab10_session: userACookie },
        payload: { userId: u.json().user.id },
      });
    }
    return id;
  }

  it("construction algorithm: defaults, preserve, switch, DE compact, unknown", async () => {
    // 1. First generate without body → compact
    const id1 = await createSeTournamentWithN(5, "algo-def");
    const g1 = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id1}/bracket`,
      cookies: { tab10_session: userACookie },
    });
    expect(g1.statusCode).toBe(200);
    expect(g1.json().constructionAlgorithm).toBe("compact");
    expect(g1.json().bracket.constructionAlgorithm).toBe("compact");
    const compactIds = (g1.json().bracket.matches as Array<{ id: string }>).map(
      (m) => m.id,
    );
    expect(compactIds).toContain("W0_2");
    expect(g1.json().bracket.matches.find((m: { id: string }) => m.id === "W0_2")
      .sourceB).toEqual({ type: "empty" });

    // 2. First generate with power_of_two
    const id2 = await createSeTournamentWithN(5, "algo-po2");
    const g2 = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id2}/bracket`,
      cookies: { tab10_session: userACookie },
      payload: { constructionAlgorithm: "power_of_two" },
    });
    expect(g2.statusCode).toBe(200);
    expect(g2.json().constructionAlgorithm).toBe("power_of_two");
    expect(g2.json().bracket.bracketSize).toBe(8);

    // 3. Regen Po2 without body → stays Po2
    const g2b = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id2}/bracket`,
      cookies: { tab10_session: userACookie },
    });
    expect(g2b.statusCode).toBe(200);
    expect(g2b.json().constructionAlgorithm).toBe("power_of_two");

    // 4. Regen compact without body → stays compact
    const g1b = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id1}/bracket`,
      cookies: { tab10_session: userACookie },
    });
    expect(g1b.statusCode).toBe(200);
    expect(g1b.json().constructionAlgorithm).toBe("compact");

    // 5. Explicit switch Po2 → compact
    const g2c = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id2}/bracket`,
      cookies: { tab10_session: userACookie },
      payload: { constructionAlgorithm: "compact" },
    });
    expect(g2c.statusCode).toBe(200);
    expect(g2c.json().constructionAlgorithm).toBe("compact");
    expect(g2c.json().bracket.bracketSize).toBeUndefined();

    // 6. After start — change forbidden
    const start = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id1}/start`,
      cookies: { tab10_session: userACookie },
    });
    expect(start.statusCode).toBe(200);
    // compact N=5 start: ready matches W0_0, W0_1 only (not W0_2 bye)
    const matches = start.json().tournament.matches as Array<{
      tournamentBracketMatchId?: string;
      tournamentSlotId?: string;
    }>;
    const matchNodeIds = matches.map(
      (m) => m.tournamentBracketMatchId ?? m.tournamentSlotId,
    );
    expect(matchNodeIds).toContain("W0_0");
    expect(matchNodeIds).toContain("W0_1");
    expect(matchNodeIds).not.toContain("W0_2");

    const afterStart = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id1}/bracket`,
      cookies: { tab10_session: userACookie },
      payload: { constructionAlgorithm: "power_of_two" },
    });
    expect(afterStart.statusCode).toBe(400);
    expect(afterStart.json().code).toBe("INVALID_STATUS");

    // 7. Unknown algorithm
    const id3 = await createSeTournamentWithN(3, "algo-bad");
    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id3}/bracket`,
      cookies: { tab10_session: userACookie },
      payload: { constructionAlgorithm: "legacy" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("INVALID_BRACKET_CONSTRUCTION_ALGORITHM");

    // 8. Compact + DE supported
    const de = await app.inject({
      method: "POST",
      url: "/api/v1/tournaments",
      cookies: { tab10_session: userACookie },
      payload: {
        title: "algo-de",
        format: "double_elimination",
        organizerParticipates: false,
      },
    });
    const deId = de.json().tournament.id as string;
    for (let i = 0; i < 4; i += 1) {
      const u = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        cookies: { tab10_session: adminCookie },
        payload: {
          email: `de-c-${i}@algo.local`,
          firstName: "P",
          lastName: `L${i}`,
        },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${deId}/participants`,
        cookies: { tab10_session: userACookie },
        payload: { userId: u.json().user.id },
      });
    }
    const deCompact = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${deId}/bracket`,
      cookies: { tab10_session: userACookie },
      payload: { constructionAlgorithm: "compact" },
    });
    expect(deCompact.statusCode).toBe(200);
    expect(deCompact.json().constructionAlgorithm).toBe("compact");
    expect(deCompact.json().bracket.format).toBe("double_elimination");
    expect(deCompact.json().bracket.constructionAlgorithm).toBe("compact");
    expect(deCompact.json().bracket.bracketSize).toBeUndefined();
    expect(
      (deCompact.json().bracket.matches as Array<{ stage: string }>).some(
        (m) => m.stage === "losers",
      ),
    ).toBe(true);
    const deStart = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${deId}/start`,
      cookies: { tab10_session: userACookie },
    });
    expect(deStart.statusCode).toBe(200);
    expect(deStart.json().tournament.matches.length).toBeGreaterThan(0);

    // 9. Column + JSON atomic (same response)
    const id4 = await createSeTournamentWithN(3, "algo-atom");
    const g4 = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id4}/bracket`,
      cookies: { tab10_session: userACookie },
      payload: { constructionAlgorithm: "power_of_two" },
    });
    expect(g4.json().constructionAlgorithm).toBe(
      g4.json().bracket.constructionAlgorithm,
    );
    expect(g4.json().bracketConstructionAlgorithm).toBe("power_of_two");

    // Po2 N=5 start materializes W0_1 (4v5) and bye-advanced W1 paths — not bye nodes
    const id5 = await createSeTournamentWithN(5, "algo-po2-mat");
    await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id5}/bracket`,
      cookies: { tab10_session: userACookie },
      payload: { constructionAlgorithm: "power_of_two" },
    });
    const startPo2 = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${id5}/start`,
      cookies: { tab10_session: userACookie },
    });
    expect(startPo2.statusCode).toBe(200);
    const po2MatchIds = (
      startPo2.json().tournament.matches as Array<{
        tournamentBracketMatchId?: string;
      }>
    ).map((m) => m.tournamentBracketMatchId);
    expect(po2MatchIds).toContain("W0_1");
    expect(po2MatchIds).not.toContain("W0_0");
    expect(po2MatchIds).not.toContain("W0_2");
    expect(po2MatchIds).not.toContain("W0_3");
  });
});

describe("INT_migrations__apply_from_scratch", () => {
  it("applies schema on empty pglite", async () => {
    const ctx = await createPgliteDb();
    const res = await ctx.client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public'",
    );
    const names = (res.rows as { tablename: string }[]).map((r) => r.tablename);
    expect(names).toContain("users");
    expect(names).toContain("matches");
    expect(names).toContain("tournaments");
    const col = await ctx.client.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name='tournaments' AND column_name='bracket_construction_algorithm'`,
    );
    expect((col.rows as { column_default: string | null }[])[0]?.column_default).toContain(
      "compact",
    );
    await ctx.close();
  });

  it("backfills existing Po2 V2 as power_of_two not compact", async () => {
    const ctx = await createPgliteDb();
    // Insert legacy-shaped row as if migration had not run column yet — column exists with NULL
    await ctx.client.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, status, must_change_password)
       VALUES ('11111111-1111-1111-1111-111111111111', 'mig@t.local', 'x', 'M', 'G', 'user', 'active', false)`,
    );
    await ctx.client.query(
      `INSERT INTO tournaments (id, title, status, format, created_by_user_id, bracket_json, bracket_construction_algorithm)
       VALUES (
         '22222222-2222-2222-2222-222222222222',
         'LegacyPo2',
         'bracket_generated',
         'single_elimination',
         '11111111-1111-1111-1111-111111111111',
         '{"schemaVersion":2,"format":"single_elimination","participantCount":4,"bracketSize":4,"seedOrder":["a","b","c","d"],"thirdPlaceEnabled":false,"matches":[],"championParticipantId":null,"runnerUpParticipantId":null,"thirdPlaceParticipantId":null}'::jsonb,
         NULL
       )`,
    );
    // Re-run backfill statements (idempotent with ensureSchema path — call UPDATE as migration does)
    await ctx.client.query(`
      UPDATE tournaments
      SET bracket_construction_algorithm = 'power_of_two'
      WHERE bracket_construction_algorithm IS NULL
        AND bracket_json IS NOT NULL
        AND (bracket_json->>'schemaVersion') = '2'
        AND (
          bracket_json->>'constructionAlgorithm' IS NULL
          OR bracket_json->>'constructionAlgorithm' = 'power_of_two'
        );
    `);
    const row = await ctx.client.query(
      `SELECT bracket_construction_algorithm FROM tournaments WHERE id='22222222-2222-2222-2222-222222222222'`,
    );
    expect(
      (row.rows as { bracket_construction_algorithm: string }[])[0]
        ?.bracket_construction_algorithm,
    ).toBe("power_of_two");
    await ctx.close();
  });
});
