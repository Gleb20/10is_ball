import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import type { Clock } from "@tab10/test-utils";
import type { Db } from "./db/client.js";
import { authSessions, users } from "./db/schema.js";
import { AuthService, type AuthUser } from "./modules/auth/auth-service.js";
import { MatchService } from "./modules/matches/match-service.js";
import {
  HelpService,
  NotificationService,
} from "./modules/notifications/notification-service.js";
import { TeamService } from "./modules/teams/team-service.js";
import { TournamentService } from "./modules/tournaments/tournament-service.js";

const COOKIE = "tab10_session";
const CSRF_COOKIE = "tab10_csrf";

/** Cookie flags: use COOKIE_SAME_SITE=none when browser talks to API on another site. Prefer Vercel /api rewrite (same-site) instead. */
function sessionCookieOptions(httpOnly: boolean) {
  const crossSite = process.env.COOKIE_SAME_SITE === "none";
  return {
    path: "/",
    httpOnly,
    sameSite: (crossSite ? "none" : "lax") as "none" | "lax",
    secure: process.env.NODE_ENV === "production" || crossSite,
  };
}

function corsOrigin(): boolean | string | string[] {
  const raw = process.env.WEB_ORIGIN?.trim();
  if (!raw) return true;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length === 1 ? list[0]! : list;
}

export type AppServices = {
  auth: AuthService;
  matches: MatchService;
  tournaments: TournamentService;
  teams: TeamService;
  notifications: NotificationService;
  help: HelpService;
  clock: Clock;
};

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
    authSessionId?: string;
  }
}

export async function buildApp(opts: {
  db: Db;
  clock?: Clock;
}): Promise<{ app: FastifyInstance; services: AppServices }> {
  const clock = opts.clock ?? { now: () => new Date() };
  const services: AppServices = {
    auth: new AuthService(opts.db, clock),
    matches: new MatchService(opts.db, clock),
    tournaments: new TournamentService(opts.db, clock),
    teams: new TeamService(opts.db, clock),
    notifications: new NotificationService(opts.db),
    help: new HelpService(opts.db),
    clock,
  };

  const app = Fastify({ logger: false });
  await app.register(cors, {
    origin: corsOrigin(),
    credentials: true,
  });
  await app.register(cookie);

  app.addHook("onRequest", async (req) => {
    const token = req.cookies[COOKIE];
    const resolved = await services.auth.resolveSession(token);
    if (resolved) {
      req.authUser = resolved.user;
      req.authSessionId = resolved.sessionId;
    }
  });

  const requireAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.authUser) {
      return reply.code(401).send({
        code: "UNAUTHORIZED",
        message: "Требуется вход",
      });
    }
    if (req.authUser.mustChangePassword) {
      const path = req.url;
      if (
        !path.includes("/auth/password/first-change") &&
        !path.includes("/auth/logout") &&
        !path.includes("/auth/me")
      ) {
        return reply.code(403).send({
          code: "PASSWORD_CHANGE_REQUIRED",
          message: "Необходимо сменить пароль",
        });
      }
    }
  };

  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    if (req.authUser?.role !== "admin") {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: "Только для администратора",
      });
    }
  };

  app.get("/health", async () => ({
    status: "ok",
    time: clock.now().toISOString(),
  }));

  app.get("/api/v1/openapi.json", async () => openApiSpec());

  // --- Auth ---
  app.post("/api/v1/auth/login", async (req, reply) => {
    const body = req.body as { email?: string; password?: string };
    if (!body?.email || !body?.password) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: "email и password обязательны",
      });
    }
    const result = await services.auth.login({
      email: body.email,
      password: body.password,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    if (result.ok === false) {
      const status =
        result.code === "RATE_LIMITED"
          ? 429
          : result.code === "ACCOUNT_BLOCKED"
            ? 403
            : 401;
      return reply.code(status).send({
        code: result.code,
        message: messageFor(result.code),
      });
    }
    reply.setCookie(COOKIE, result.sessionToken, sessionCookieOptions(true));
    const csrf = cryptoRandom();
    reply.setCookie(CSRF_COOKIE, csrf, sessionCookieOptions(false));
    return {
      user: {
        id: result.user.id,
        role: result.user.role,
        mustChangePassword: result.user.mustChangePassword,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        email: result.user.email,
      },
      csrfToken: csrf,
    };
  });

  app.post(
    "/api/v1/auth/logout",
    { preHandler: requireAuth },
    async (req, reply) => {
      if (req.authSessionId) await services.auth.logout(req.authSessionId);
      reply.clearCookie(COOKIE, sessionCookieOptions(true));
      return { ok: true };
    },
  );

  app.get("/api/v1/auth/me", { preHandler: requireAuth }, async (req) => ({
    user: req.authUser,
  }));

  app.post(
    "/api/v1/auth/password/first-change",
    { preHandler: requireAuth },
    async (req, reply) => {
      const body = req.body as { newPassword?: string };
      const result = await services.auth.changePasswordFirst({
        userId: req.authUser!.id,
        sessionId: req.authSessionId!,
        newPassword: body.newPassword ?? "",
      });
      if (result.ok === false) {
        return reply.code(400).send({
          code: result.code,
          message: messageFor(result.code),
          details: { errors: result.errors },
        });
      }
      return { ok: true };
    },
  );

  app.post(
    "/api/v1/auth/password/change",
    { preHandler: requireAuth },
    async (req, reply) => {
      const body = req.body as {
        currentPassword?: string;
        newPassword?: string;
      };
      const result = await services.auth.changePassword({
        userId: req.authUser!.id,
        sessionId: req.authSessionId!,
        currentPassword: body.currentPassword ?? "",
        newPassword: body.newPassword ?? "",
      });
      if (result.ok === false) {
        return reply.code(400).send({
          code: result.code,
          message: messageFor(result.code),
          details: { errors: result.errors },
        });
      }
      return { ok: true };
    },
  );

  app.get(
    "/api/v1/auth/sessions",
    { preHandler: requireAuth },
    async (req) => {
      const sessions = await services.auth.listSessions(req.authUser!.id);
      return {
        sessions: sessions.map((s: typeof authSessions.$inferSelect) => ({
          id: s.id,
          userAgent: s.userAgent,
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
          current: s.id === req.authSessionId,
        })),
      };
    },
  );

  app.delete(
    "/api/v1/auth/sessions/:sessionId",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { sessionId } = req.params as { sessionId: string };
      const ok = await services.auth.revokeSession(
        req.authUser!.id,
        sessionId,
      );
      if (!ok) return reply.code(404).send({ code: "NOT_FOUND", message: "Сессия не найдена" });
      return { ok: true };
    },
  );

  // --- Admin ---
  app.get(
    "/api/v1/admin/users",
    { preHandler: requireAdmin },
    async (req) => {
      const q = (req.query as { q?: string }).q;
      const list = await services.auth.listUsers(q);
      return {
        users: list.map((u: typeof users.$inferSelect) => ({
          id: u.id,
          email: u.email,
          role: u.role,
          status: u.status,
          firstName: u.firstName,
          lastName: u.lastName,
          mustChangePassword: u.mustChangePassword,
          createdAt: u.createdAt,
        })),
      };
    },
  );

  app.post(
    "/api/v1/admin/users",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const body = req.body as {
        email: string;
        firstName: string;
        lastName: string;
        role?: "admin" | "user";
      };
      try {
        const created = await services.auth.createUser({
          email: body.email,
          firstName: body.firstName,
          lastName: body.lastName,
          role: body.role ?? "user",
          issuedByAdminId: req.authUser!.id,
        });
        return {
          user: created.user,
          temporaryPassword: created.temporaryPassword,
        };
      } catch (e) {
        const err = e as { code?: string };
        if (err.code === "EMAIL_TAKEN") {
          return reply.code(409).send({
            code: "EMAIL_TAKEN",
            message: "Email уже занят",
          });
        }
        throw e;
      }
    },
  );

  app.post(
    "/api/v1/admin/users/:userId/block",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { userId } = req.params as { userId: string };
      try {
        await services.auth.blockUser(req.authUser!.id, userId);
        await services.teams.transferCaptainOnBlock(userId);
        return { ok: true };
      } catch (e) {
        const err = e as { code?: string };
        if (err.code === "LAST_ADMIN") {
          return reply.code(409).send({
            code: "LAST_ADMIN",
            message: "Нельзя заблокировать последнего администратора",
          });
        }
        throw e;
      }
    },
  );

  app.post(
    "/api/v1/admin/users/:userId/unblock",
    { preHandler: requireAdmin },
    async (req) => {
      const { userId } = req.params as { userId: string };
      await services.auth.unblockUser(req.authUser!.id, userId);
      return { ok: true };
    },
  );

  app.post(
    "/api/v1/admin/users/:userId/reset-password",
    { preHandler: requireAdmin },
    async (req) => {
      const { userId } = req.params as { userId: string };
      const result = await services.auth.resetPassword(
        req.authUser!.id,
        userId,
      );
      return { temporaryPassword: result.temporaryPassword };
    },
  );

  // --- Profile ---
  app.patch(
    "/api/v1/me/profile",
    { preHandler: requireAuth },
    async (req) => {
      const body = req.body as Record<string, unknown>;
      const row = await services.auth.updateProfile(req.authUser!.id, {
        firstName: body.firstName as string | undefined,
        lastName: body.lastName as string | undefined,
        birthDate: body.birthDate as string | null | undefined,
        organizationText: body.organizationText as string | null | undefined,
        positionText: body.positionText as string | null | undefined,
        onboardingCompletedAt: body.onboardingCompleted
          ? services.clock.now()
          : undefined,
      });
      return { user: row };
    },
  );

  // --- Matches ---
  app.get("/api/v1/matches", { preHandler: requireAuth }, async () => {
    const list = await services.matches.listMatches();
    return { matches: list };
  });

  app.post("/api/v1/matches", { preHandler: requireAuth }, async (req) => {
    const body = req.body as {
      title: string;
      format: "1v1" | "2v2";
      pointsToWin?: number;
      mercyEnabled?: boolean;
      mercyPoints?: number;
      participants: Array<{
        side: "A" | "B";
        userId?: string;
        guestFirstName?: string;
        guestLastName?: string;
      }>;
    };
    const match = await services.matches.createMatch({
      createdByUserId: req.authUser!.id,
      ...body,
    });
    return { match };
  });

  app.get(
    "/api/v1/matches/:matchId",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { matchId } = req.params as { matchId: string };
      const match = await services.matches.getMatch(matchId);
      if (!match) {
        return reply.code(404).send({ code: "NOT_FOUND", message: "Матч не найден" });
      }
      return { match };
    },
  );

  app.post(
    "/api/v1/matches/:matchId/start",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { matchId } = req.params as { matchId: string };
        const body = req.body as { firstServerParticipantId?: string };
        const match = await services.matches.startMatch(
          matchId,
          body?.firstServerParticipantId,
        );
        return { match };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/matches/:matchId/judge/acquire",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { matchId } = req.params as { matchId: string };
        const session = await services.matches.acquireJudge({
          matchId,
          userId: req.authUser!.id,
          authSessionId: req.authSessionId!,
        });
        return { judgeSession: session };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/matches/:matchId/judge/heartbeat",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { matchId } = req.params as { matchId: string };
        const session = await services.matches.heartbeatJudge({
          matchId,
          userId: req.authUser!.id,
          authSessionId: req.authSessionId!,
        });
        return { judgeSession: session };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/matches/:matchId/judge/release",
    { preHandler: requireAuth },
    async (req) => {
      const { matchId } = req.params as { matchId: string };
      await services.matches.releaseJudge(matchId);
      return { ok: true };
    },
  );

  app.post(
    "/api/v1/matches/:matchId/points",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { matchId } = req.params as { matchId: string };
        const body = req.body as {
          side: "A" | "B";
          expectedVersion: number;
        };
        const idempotencyKey =
          (req.headers["idempotency-key"] as string) ||
          `${req.authSessionId}-${Date.now()}`;
        const match = await services.matches.awardPoint({
          matchId,
          side: body.side,
          idempotencyKey,
          expectedVersion: body.expectedVersion,
          judgeUserId: req.authUser!.id,
          authSessionId: req.authSessionId!,
        });
        return { match };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/matches/:matchId/undo",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { matchId } = req.params as { matchId: string };
        const body = req.body as { expectedVersion: number };
        const idempotencyKey =
          (req.headers["idempotency-key"] as string) ||
          `undo-${req.authSessionId}-${Date.now()}`;
        const match = await services.matches.undoPoint({
          matchId,
          idempotencyKey,
          expectedVersion: body.expectedVersion,
          judgeUserId: req.authUser!.id,
          authSessionId: req.authSessionId!,
        });
        return { match };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/matches/:matchId/confirm-finish",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { matchId } = req.params as { matchId: string };
        const match = await services.matches.confirmFinish({
          matchId,
          judgeUserId: req.authUser!.id,
          authSessionId: req.authSessionId!,
        });
        return { match };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/matches/:matchId/revert-finish",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { matchId } = req.params as { matchId: string };
        const match = await services.matches.revertFinish({
          matchId,
          judgeUserId: req.authUser!.id,
          authSessionId: req.authSessionId!,
        });
        return { match };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/matches/:matchId/stop",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { matchId } = req.params as { matchId: string };
        const body = req.body as {
          winnerSide: "A" | "B";
          reasonCode: string;
          reasonText?: string;
        };
        const match = await services.matches.stopMatch({
          matchId,
          winnerSide: body.winnerSide,
          reasonCode: body.reasonCode,
          reasonText: body.reasonText,
          actorUserId: req.authUser!.id,
        });
        return { match };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/matches/tutorial",
    { preHandler: requireAuth },
    async (req) => {
      const match = await services.matches.createTutorialMatch(
        req.authUser!.id,
      );
      return { match };
    },
  );

  // --- User directory (opponent picker) ---
  app.get(
    "/api/v1/users/directory",
    { preHandler: requireAuth },
    async (req) => {
      const q = (req.query as { q?: string }).q;
      const users = await services.auth.listDirectory({
        q,
        excludeUserId: req.authUser!.id,
      });
      return { users };
    },
  );

  // --- Rankings / Home ---
  app.get(
    "/api/v1/rankings",
    { preHandler: requireAuth },
    async (req) => {
      const period = ((req.query as { period?: string }).period ??
        "all_time") as "all_time" | "week" | "month";
      const rankings = await services.matches.getRankings(period);
      return { rankings };
    },
  );

  app.get("/api/v1/home", { preHandler: requireAuth }, async (req) => {
    const matches = await services.matches.listMatches(5);
    const rankings = await services.matches.getRankings("all_time");
    const unread = await services.notifications.unread(req.authUser!.id);
    const myRankIndex = rankings.findIndex(
      (r) => r && r.userId === req.authUser!.id,
    );
    const myEntry = myRankIndex >= 0 ? rankings[myRankIndex] : null;
    return {
      lastMatches: matches,
      topRankings: rankings.slice(0, 5),
      unreadNotifications: unread.slice(0, 5),
      myStats: myEntry
        ? {
            rank: myRankIndex + 1,
            wins: myEntry.wins,
            losses: myEntry.losses,
            displayName: myEntry.displayName,
          }
        : null,
      hero: rankings[0]
        ? {
            type: "leader",
            userId: rankings[0].userId,
            displayName: rankings[0].displayName,
            wins: rankings[0].wins,
          }
        : { type: "empty" },
    };
  });

  // --- Tournaments ---
  app.get("/api/v1/tournaments", { preHandler: requireAuth }, async () => {
    const list = await services.tournaments.list();
    return { tournaments: list };
  });

  app.post(
    "/api/v1/tournaments",
    { preHandler: requireAuth },
    async (req) => {
      const body = req.body as {
        title: string;
        format?: "single_elimination" | "double_elimination";
      };
      const tournament = await services.tournaments.create({
        title: body.title,
        format: body.format ?? "single_elimination",
        createdByUserId: req.authUser!.id,
      });
      return { tournament };
    },
  );

  app.get(
    "/api/v1/tournaments/:id",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const tournament = await services.tournaments.get(id);
      if (!tournament) {
        return reply.code(404).send({ code: "NOT_FOUND", message: "Не найден" });
      }
      return { tournament };
    },
  );

  app.post(
    "/api/v1/tournaments/:id/participants",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const body = req.body as {
          userId?: string;
          guestFirstName?: string;
          guestLastName?: string;
        };
        const participant = await services.tournaments.addParticipant({
          tournamentId: id,
          ...body,
        });
        return { participant };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/tournaments/:id/bracket",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const result = await services.tournaments.generateBracket(id);
        return result;
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/tournaments/:id/start",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const tournament = await services.tournaments.start(id);
        return { tournament };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  // --- Teams ---
  app.get("/api/v1/teams", { preHandler: requireAuth }, async (req) => {
    const list = await services.teams.listForUser(req.authUser!.id);
    return { teams: list };
  });

  app.post("/api/v1/teams", { preHandler: requireAuth }, async (req) => {
    const body = req.body as {
      name: string;
      slogan?: string;
      welcomeText?: string;
    };
    const team = await services.teams.create({
      name: body.name,
      captainUserId: req.authUser!.id,
      slogan: body.slogan,
      welcomeText: body.welcomeText,
    });
    return { team };
  });

  app.post(
    "/api/v1/teams/:id/invite",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const body = req.body as { userId: string };
        const invitation = await services.teams.invite({
          teamId: id,
          invitedUserId: body.userId,
          invitedByUserId: req.authUser!.id,
        });
        return { invitation };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/team-invitations/:id/respond",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const body = req.body as { accept: boolean };
        const result = await services.teams.respondInvitation({
          invitationId: id,
          userId: req.authUser!.id,
          accept: body.accept,
        });
        return result;
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  // --- Notifications / Help ---
  app.get(
    "/api/v1/notifications",
    { preHandler: requireAuth },
    async (req) => {
      const list = await services.notifications.list(req.authUser!.id);
      return { notifications: list };
    },
  );

  app.post(
    "/api/v1/notifications/:id/read",
    { preHandler: requireAuth },
    async (req) => {
      const { id } = req.params as { id: string };
      await services.notifications.markRead(req.authUser!.id, id);
      return { ok: true };
    },
  );

  app.get("/api/v1/faq", { preHandler: requireAuth }, async () => {
    await services.help.seedFaq();
    const articles = await services.help.listFaq();
    return { articles };
  });

  app.post(
    "/api/v1/feedback",
    { preHandler: requireAuth },
    async (req) => {
      const body = req.body as { kind: string; message: string };
      const feedback = await services.help.submitFeedback({
        userId: req.authUser!.id,
        kind: body.kind,
        message: body.message,
      });
      return { feedback };
    },
  );

  return { app, services };
}

function messageFor(code: string): string {
  const map: Record<string, string> = {
    INVALID_CREDENTIALS: "Неверный email или пароль",
    ACCOUNT_BLOCKED: "Аккаунт заблокирован",
    RATE_LIMITED: "Слишком много попыток",
    PASSWORD_POLICY: "Пароль не соответствует политике",
    PASSWORD_CHANGE_REQUIRED: "Необходимо сменить пароль",
    LAST_ADMIN: "Нельзя заблокировать последнего администратора",
    EMAIL_TAKEN: "Email уже занят",
    NOT_FOUND: "Не найдено",
    FORBIDDEN: "Недостаточно прав",
    JUDGE_TAKEN: "Судейская сессия занята",
    JUDGE_REQUIRED: "Требуется судейская сессия",
    VERSION_CONFLICT: "Конфликт версии",
    PLAYER_BUSY: "Игрок уже в активном матче",
    TOO_FEW: "Нужно минимум 3 участника",
    TOO_MANY: "Максимум 64 участника",
  };
  return map[code] ?? code;
}

function sendError(reply: FastifyReply, e: unknown) {
  const err = e as { code?: string; state?: unknown; message?: string };
  const code = err.code ?? "INTERNAL";
  const status =
    code === "NOT_FOUND"
      ? 404
      : code === "FORBIDDEN"
        ? 403
        : code === "VERSION_CONFLICT" || code === "JUDGE_TAKEN"
          ? 409
          : 400;
  return reply.code(status).send({
    code,
    message: messageFor(code),
    details: err.state ? { state: err.state } : undefined,
  });
}

function cryptoRandom(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function openApiSpec() {
  return {
    openapi: "3.0.3",
    info: { title: "Tab-10 API", version: "0.1.0" },
    paths: {
      "/health": { get: { summary: "Health" } },
      "/api/v1/auth/login": { post: { summary: "Login" } },
      "/api/v1/admin/users": {
        get: { summary: "List users" },
        post: { summary: "Create user" },
      },
      "/api/v1/matches": {
        get: { summary: "List matches" },
        post: { summary: "Create match" },
      },
      "/api/v1/tournaments": {
        get: { summary: "List tournaments" },
        post: { summary: "Create tournament" },
      },
      "/api/v1/rankings": { get: { summary: "Rankings" } },
      "/api/v1/users/directory": {
        get: { summary: "User directory for pickers" },
      },
      "/api/v1/home": { get: { summary: "Home dashboard" } },
    },
  };
}
