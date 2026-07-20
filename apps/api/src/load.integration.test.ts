import { describe, expect, it, afterEach, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { FakeClock, percentile } from "@tab10/test-utils";
import { createPgliteDb } from "./db/client.js";
import { buildApp, type AppServices } from "./app.js";

/** NFR 06 §2 — target load: 10 parallel matches. */
const PARALLEL_MATCH_COUNT = 10;
const POINTS_PER_MATCH = 5;
const SLO_POINT_WRITE_P95_MS = 700;
const SLO_HOME_READ_P95_MS = 1200;
const SLO_SIMPLE_READ_P95_MS = 500;

type MatchCtx = {
  id: string;
  cookie: string;
  version: number;
};

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const start = performance.now();
  const result = await fn();
  return { ms: performance.now() - start, result };
}

describe("Phase 9 load — 10 parallel matches", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let close: () => Promise<void>;
  let adminCookie: string;

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
  });

  afterEach(async () => {
    if (app) await app.close();
    if (close) await close();
  });

  async function createUser(email: string, password: string) {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      cookies: { tab10_session: adminCookie },
      payload: { email, firstName: "Load", lastName: "User" },
    });
    expect(created.statusCode).toBe(200);
    const temp = created.json().temporaryPassword as string;
    const id = created.json().user.id as string;

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: temp },
    });
    const cookie = login.cookies.find((c) => c.name === "tab10_session")!.value;

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

  it("INT_load__ten_parallel_matches_meet_slo", async () => {
    const playerCount = PARALLEL_MATCH_COUNT * 2;
    const players: { id: string; cookie: string }[] = [];
    for (let i = 0; i < playerCount; i += 1) {
      players.push(
        await createUser(`load${i}@tab10.local`, `LoadPass${String(i).padStart(2, "0")}!`),
      );
    }

    const matches: MatchCtx[] = [];
    for (let i = 0; i < PARALLEL_MATCH_COUNT; i += 1) {
      const pA = players[i * 2]!;
      const pB = players[i * 2 + 1]!;
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/matches",
        cookies: { tab10_session: pA.cookie },
        payload: {
          title: `Load match ${i + 1}`,
          format: "1v1",
          pointsToWin: POINTS_PER_MATCH,
          participants: [
            { side: "A", userId: pA.id },
            { side: "B", userId: pB.id },
          ],
        },
      });
      expect(created.statusCode).toBe(200);
      const matchId = created.json().match.id as string;

      const started = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/start`,
        cookies: { tab10_session: pA.cookie },
        payload: {},
      });
      expect(started.statusCode).toBe(200);

      const acquired = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/judge/acquire`,
        cookies: { tab10_session: pA.cookie },
      });
      expect(acquired.statusCode).toBe(200);

      matches.push({ id: matchId, cookie: pA.cookie, version: 0 });
    }

    const healthLatencies: number[] = [];
    const pointLatencies: number[] = [];
    const homeLatencies: number[] = [];

    for (let round = 0; round < POINTS_PER_MATCH; round += 1) {
      const health = await timed(() =>
        app.inject({ method: "GET", url: "/health" }),
      );
      expect(health.result.statusCode).toBe(200);
      healthLatencies.push(health.ms);

      const home = await timed(() =>
        app.inject({
          method: "GET",
          url: "/api/v1/home",
          cookies: { tab10_session: matches[0]!.cookie },
        }),
      );
      expect(home.result.statusCode).toBe(200);
      homeLatencies.push(home.ms);

      const pointResults = await Promise.all(
        matches.map(async (match, idx) => {
          const { ms, result } = await timed(() =>
            app.inject({
              method: "POST",
              url: `/api/v1/matches/${match.id}/points`,
              cookies: { tab10_session: match.cookie },
              headers: { "idempotency-key": `load-${idx}-r${round}` },
              payload: { side: "A", expectedVersion: match.version },
            }),
          );
          return { idx, ms, result };
        }),
      );

      for (const { idx, ms, result } of pointResults) {
        expect(result.statusCode).toBe(200);
        pointLatencies.push(ms);
        matches[idx]!.version = result.json().match.version as number;
      }
    }

    const confirms = await Promise.all(
      matches.map((match) =>
        app.inject({
          method: "POST",
          url: `/api/v1/matches/${match.id}/confirm-finish`,
          cookies: { tab10_session: match.cookie },
        }),
      ),
    );
    for (const confirm of confirms) {
      expect(confirm.statusCode).toBe(200);
      expect(confirm.json().match.status).toBe("finished");
    }

    const p95Points = percentile(pointLatencies, 95);
    const p95Home = percentile(homeLatencies, 95);
    const p95Health = percentile(healthLatencies, 95);

    expect(pointLatencies.length).toBe(PARALLEL_MATCH_COUNT * POINTS_PER_MATCH);
    expect(p95Points).toBeLessThan(SLO_POINT_WRITE_P95_MS);
    expect(p95Home).toBeLessThan(SLO_HOME_READ_P95_MS);
    expect(p95Health).toBeLessThan(SLO_SIMPLE_READ_P95_MS);
  });
});
