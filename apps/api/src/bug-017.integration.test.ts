import { FakeClock } from "@tab10/test-utils";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { createMigratedPgliteDb } from "./db/client.js";
import { authSessions, users } from "./db/schema.js";
import { hashPassword, hashToken } from "./modules/auth/auth-service.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

describe("BUG-017 / AT-JUDGE-002: judge device conflict API contract", () => {
  it.each(["same match", "another match"])(
    "returns 409 for a second auth session on %s without changing judge authority",
    async (target) => {
      const context = await createMigratedPgliteDb();
      close = context.close;
      const clock = new FakeClock(new Date("2026-09-13T10:00:00.000Z"));
      let requestNumber = 0;
      const { app } = await buildApp({
        db: context.db,
        clock,
        randomIndex: () => 0,
        requestIdFactory: () => `bug-017-request-${++requestNumber}`,
      });
      close = async () => {
        await app.close();
        await context.close();
      };
      const email = "judge@bug017.test";
      const password = "SyntheticPass1!";
      const [user] = await context.db.insert(users).values({
        email,
        firstName: "Judge",
        lastName: "Synthetic",
        passwordHash: await hashPassword(password),
        mustChangePassword: false,
      }).returning();
      async function login() {
        const response = await app.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { email, password },
        });
        expect(response.statusCode).toBe(200);
        const token = response.cookies.find((cookie) => cookie.name === "tab10_session")!.value;
        const session = await context.db.query.authSessions.findFirst({
          where: eq(authSessions.tokenHash, hashToken(token)),
        });
        expect(session).toMatchObject({ userId: user!.id, revokedAt: null });
        return { cookies: { tab10_session: token }, id: session!.id };
      }
      const first = await login();
      const second = await login();
      expect(second.id).not.toBe(first.id);

      async function createMatch(title: string) {
        const response = await app.inject({
          method: "POST",
          url: "/api/v1/matches",
          cookies: first.cookies,
          payload: {
            title,
            format: "1v1",
            firstServerMethod: "random",
            participants: [
              { side: "A", userId: user!.id },
              { side: "B", guestFirstName: "Guest", guestLastName: "Two" },
            ],
          },
        });
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json().match.status).toBe("waiting");
        return response.json().match.id as string;
      }
      const matchId = await createMatch("First judge fixture");
      const targetId = target === "same match" ? matchId : await createMatch("Second judge fixture");
      const acquired = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/judge/acquire`,
        cookies: first.cookies,
      });
      expect(acquired.statusCode).toBe(200);
      const before = await context.db.query.judgeSessions.findMany();
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({
        id: acquired.json().judgeSession.id,
        matchId,
        userId: user!.id,
        authSessionId: first.id,
        releasedAt: null,
        reservedForUserId: null,
      });
      const matchesBefore = await context.db.query.matches.findMany();
      clock.advanceMs(1_000);
      const conflict = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${targetId}/judge/acquire`,
        cookies: second.cookies,
      });
      expect.soft(conflict.statusCode).toBe(409);
      expect.soft(conflict.json()).toEqual({
        code: "JUDGE_OTHER_DEVICE",
        message: "Вы уже судите с другого устройства. Освободите там слот судьи, чтобы продолжить здесь",
        requestId: conflict.headers["x-request-id"],
      });
      expect(conflict.json().requestId).toMatch(/^bug-017-request-\d+$/);
      expect(await context.db.query.judgeSessions.findMany()).toEqual(before);
      expect(await context.db.query.matches.findMany()).toEqual(matchesBefore);

      const deniedHeartbeat = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/judge/heartbeat`,
        cookies: second.cookies,
      });
      expect(deniedHeartbeat.statusCode).toBe(409);
      expect(deniedHeartbeat.json().code).toBe("JUDGE_NOT_ACTIVE");
      expect(await context.db.query.judgeSessions.findMany()).toEqual(before);
      const heartbeat = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/judge/heartbeat`,
        cookies: first.cookies,
      });
      expect(heartbeat.statusCode).toBe(200);
      const after = await context.db.query.judgeSessions.findMany();
      expect(after).toHaveLength(1);
      expect(after[0]).toEqual({
        ...before[0],
        lastHeartbeatAt: clock.now(),
        expiresAt: new Date(before[0]!.expiresAt.getTime() + 1_000),
      });
      const released = await app.inject({
        method: "POST",
        url: `/api/v1/matches/${matchId}/judge/release`,
        cookies: first.cookies,
      });
      expect(released.statusCode).toBe(200);
      const rows = await context.db.query.judgeSessions.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ ...after[0], releasedAt: clock.now() });
    },
  );
});
