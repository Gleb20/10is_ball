import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { sql } from "drizzle-orm";
import {
  AwardPointRequestSchema,
  CancelMatchRequestSchema,
  CreateMatchRequestSchema,
  JudgeSetupRequestSchema,
  MatchVersionRequestSchema,
  StartMatchRequestSchema,
  StopMatchRequestSchema,
  type ReleaseMetadata,
} from "@tab10/shared";
import type { Clock } from "@tab10/test-utils";
import { z, type ZodType } from "zod";
import type { Db } from "./db/client.js";
import { authSessions, users } from "./db/schema.js";
import { isAuditEphemeral } from "./audit-ephemeral.js";
import { AuthService, type AuthUser } from "./modules/auth/auth-service.js";
import { HomeService } from "./modules/home/home-service.js";
import { MatchService } from "./modules/matches/match-service.js";
import {
  HelpService,
  NotificationService,
} from "./modules/notifications/notification-service.js";
import { TeamService } from "./modules/teams/team-service.js";
import { TournamentService } from "./modules/tournaments/tournament-service.js";
import { openApiSpec } from "./openapi.js";
import { resolveRuntimeReleaseMetadata } from "./release-metadata.js";

export { openApiSpec } from "./openapi.js";

const COOKIE = "tab10_session";
const CSRF_COOKIE = "tab10_csrf";
const TEMPORARY_PASSWORD_ALLOWED_ROUTES = new Set([
  "GET /api/v1/auth/me",
  "POST /api/v1/auth/logout",
  "POST /api/v1/auth/password/first-change",
]);
const OnboardingMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set-step"), step: z.number().int().min(0).max(6) }),
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("restart") }),
]);
const NotificationReadVisibleSchema = z.object({
  notificationIds: z.array(z.string().uuid()).min(1).max(100),
});

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
  home: HomeService;
  clock: Clock;
};

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
    authSessionId?: string;
    observabilityStartedAt?: number;
  }
}

export async function buildApp(opts: {
  db: Db;
  clock?: Clock;
  releaseMetadata?: ReleaseMetadata;
  readinessProbe?: () => Promise<void>;
  requestIdFactory?: () => string;
  logDestination?: { write(line: string): void };
}): Promise<{ app: FastifyInstance; services: AppServices }> {
  const clock = opts.clock ?? { now: () => new Date() };
  const release = opts.releaseMetadata ?? resolveRuntimeReleaseMetadata();
  const readinessProbe =
    opts.readinessProbe ??
    (async () => {
      await opts.db.execute(sql`select 1`);
    });
  const matches = new MatchService(opts.db, clock);
  const tournaments = new TournamentService(opts.db, clock, matches);
  matches.setTournamentMatchFinishedHook((matchId, db) =>
    tournaments.onMatchFinished(matchId, db),
  );
  const services: AppServices = {
    auth: new AuthService(opts.db, clock),
    matches,
    tournaments,
    teams: new TeamService(opts.db, clock),
    notifications: new NotificationService(opts.db, clock),
    help: new HelpService(opts.db),
    home: new HomeService(opts.db, clock, matches, tournaments),
    clock,
  };

  const loggingEnabled =
    opts.logDestination !== undefined || process.env.NODE_ENV !== "test";
  const app = Fastify({
    logger: loggingEnabled
      ? {
          level: opts.logDestination
            ? "info"
            : safeLogLevel(process.env.LOG_LEVEL),
          ...(opts.logDestination ? { stream: opts.logDestination } : {}),
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              "req.headers['x-csrf-token']",
            ],
            censor: "[REDACTED]",
          },
        }
      : false,
    logController: new Fastify.LogController({ disableRequestLogging: true }),
    genReqId: opts.requestIdFactory ?? (() => crypto.randomUUID()),
  });
  await app.register(cors, {
    origin: corsOrigin(),
    credentials: true,
  });
  await app.register(cookie);

  app.addHook("onRequest", async (req, reply) => {
    req.observabilityStartedAt = performance.now();
    reply.header("x-request-id", req.id);
  });

  app.addHook("preSerialization", async (req, reply, payload) => {
    if (
      reply.statusCode >= 400 &&
      payload !== null &&
      typeof payload === "object" &&
      !Array.isArray(payload)
    ) {
      const errorPayload = payload as Record<string, unknown>;
      if (
        typeof errorPayload.code === "string" &&
        typeof errorPayload.message === "string"
      ) {
        return { ...errorPayload, requestId: req.id };
      }
    }
    return payload;
  });

  app.addHook("onResponse", async (req, reply) => {
    const startedAt = req.observabilityStartedAt ?? performance.now();
    const fields = {
      event: "request_completed",
      requestId: req.id,
      method: req.method,
      route: req.routeOptions.url ?? safeRequestPath(req.url),
      statusCode: reply.statusCode,
      latencyMs: Math.max(0, Number((performance.now() - startedAt).toFixed(3))),
    };
    if (reply.statusCode >= 500) {
      req.log.error(fields, "request completed with server error");
    } else {
      req.log.info(fields, "request completed");
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (reply.sent) return;
    if ((err as { code?: string }).code === "FST_ERR_CTP_INVALID_JSON_BODY") {
      return reply.code(400).send({
        code: "VALIDATION",
        message: "Некорректный JSON",
      });
    }
    req.log.error(
      {
        event: "request_error",
        requestId: req.id,
        error: safeErrorSignal(err),
      },
      "request failed",
    );
    return reply.code(500).send({
      code: "INTERNAL",
      message: "Внутренняя ошибка сервера",
    });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({
      code: "NOT_FOUND",
      message: "Ресурс не найден",
      requestId: req.id,
    }),
  );

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
      const routeKey = `${req.method} ${req.routeOptions.url}`;
      if (!TEMPORARY_PASSWORD_ALLOWED_ROUTES.has(routeKey)) {
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

  const csrfExemptPaths = [
    "/health",
    "/api/v1/openapi.json",
    "/api/v1/auth/login",
  ];

  if (process.env.NODE_ENV !== "test") {
    app.addHook("preHandler", async (req, reply) => {
      if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return;
      if (csrfExemptPaths.some((p) => req.url.startsWith(p))) return;
      const cookieToken = req.cookies[CSRF_COOKIE];
      const headerToken = req.headers["x-csrf-token"];
      if (
        !cookieToken ||
        typeof headerToken !== "string" ||
        cookieToken !== headerToken
      ) {
        return reply.code(403).send({
          code: "CSRF_INVALID",
          message: "Недействительный CSRF-токен",
        });
      }
    });
  }

  app.get("/health", async () => ({
    status: "ok",
    time: clock.now().toISOString(),
    release,
    ...(isAuditEphemeral(process.env) ? { auditEphemeral: true } : {}),
  }));

  app.get("/ready", async (req, reply) => {
    try {
      await readinessProbe();
      return {
        status: "ready",
        checks: { database: "ok" },
        time: clock.now().toISOString(),
        release,
      };
    } catch (error) {
      req.log.error(
        {
          event: "readiness_failed",
          requestId: req.id,
          check: "database",
          error: safeErrorSignal(error),
        },
        "readiness check failed",
      );
      return reply.code(503).send({
        code: "NOT_READY",
        message: "Сервис временно не готов",
        status: "not_ready",
        checks: { database: "failed" },
        time: clock.now().toISOString(),
        release,
        requestId: req.id,
      });
    }
  });

  app.get("/api/v1/openapi.json", async () => openApiSpec(release.version));

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
        onboardingStep: result.user.onboardingStep,
        onboardingCompletedAt: result.user.onboardingCompletedAt,
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
            code: "EMAIL_ALREADY_EXISTS",
            message: "Email уже занят",
          });
        }
        throw e;
      }
    },
  );

  app.patch(
    "/api/v1/admin/users/:userId",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { userId } = req.params as { userId: string };
      const body = req.body as { role?: "admin" | "user" };
      if (body?.role !== "admin" && body?.role !== "user") {
        return reply.code(400).send({
          code: "VALIDATION",
          message: "role должен быть admin или user",
        });
      }
      try {
        const user = await services.auth.updateUserRole(
          req.authUser!.id,
          userId,
          body.role,
        );
        return { user };
      } catch (e) {
        const err = e as { code?: string };
        if (err.code === "SELF_ROLE_CHANGE_FORBIDDEN") {
          return reply.code(403).send({
            code: "SELF_ROLE_CHANGE_FORBIDDEN",
            message: "Нельзя менять собственную роль",
          });
        }
        if (err.code === "LAST_ADMIN") {
          return reply.code(409).send({
            code: "LAST_ADMIN",
            message: "Нельзя понизить последнего администратора",
          });
        }
        if (err.code === "USER_NOT_FOUND") {
          return reply.code(404).send({
            code: "USER_NOT_FOUND",
            message: "Пользователь не найден",
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
        if (err.code === "SELF_BLOCK_FORBIDDEN") {
          return reply.code(403).send({
            code: "SELF_BLOCK_FORBIDDEN",
            message: "Нельзя заблокировать собственный аккаунт",
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

  app.post(
    "/api/v1/admin/matches/:matchId/force-close",
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        const { matchId } = req.params as { matchId: string };
        const body = parseBody(CancelMatchRequestSchema, req.body);
        const idempotencyKey = parseIdempotencyKey(
          req.headers["idempotency-key"],
        );
        const match = await services.matches.adminForceCloseMatch({
          matchId,
          actorAdminId: req.authUser!.id,
          expectedVersion: body.expectedVersion,
          idempotencyKey,
          reasonText: body.reasonText,
        });
        return { match };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.delete(
    "/api/v1/admin/matches/:matchId",
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        const { matchId } = req.params as { matchId: string };
        const result = await services.matches.adminDeleteMatch({
          matchId,
          actorAdminId: req.authUser!.id,
        });
        return result;
      } catch (e) {
        return sendError(reply, e);
      }
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

  app.patch(
    "/api/v1/me/onboarding",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const input = parseBody(OnboardingMutationSchema, req.body);
        const user = await services.auth.updateOnboarding(
          req.authUser!.id,
          input,
        );
        return { user };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // --- Matches ---
  app.get("/api/v1/matches", { preHandler: requireAuth }, async (req) => {
    const list = await services.matches.listMatches(req.authUser!.id);
    return { matches: list };
  });

  app.post("/api/v1/matches", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const body = parseBody(CreateMatchRequestSchema, req.body);
      const match = await services.matches.createMatch({
        createdByUserId: req.authUser!.id,
        ...body,
      });
      return { match };
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.get(
    "/api/v1/matches/:matchId",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { matchId } = req.params as { matchId: string };
        const match = await services.matches.getVisibleMatch(
          matchId,
          req.authUser!.id,
        );
        if (!match) {
          return reply.code(404).send({ code: "NOT_FOUND", message: "Матч не найден" });
        }
        return { match };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/matches/:matchId/start",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { matchId } = req.params as { matchId: string };
        const body = parseBody(StartMatchRequestSchema, req.body);
        const match = await services.matches.startMatch(
          matchId,
          req.authUser!.id,
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
    async (req, reply) => {
      try {
        const { matchId } = req.params as { matchId: string };
        await services.matches.releaseJudge(
          matchId,
          req.authUser!.id,
          req.authSessionId!,
        );
        return { ok: true };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/matches/:matchId/judge/setup",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { matchId } = req.params as { matchId: string };
        const body = parseBody(JudgeSetupRequestSchema, req.body);
        const match = await services.matches.judgeSetup({
          matchId,
          userId: req.authUser!.id,
          authSessionId: req.authSessionId!,
          firstServerParticipantId: body?.firstServerParticipantId,
          swapSides: body?.swapSides,
          displayFlipped: body?.displayFlipped,
        });
        return { match };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/matches/:matchId/points",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { matchId } = req.params as { matchId: string };
        const body = parseBody(AwardPointRequestSchema, req.body);
        const idempotencyKey = req.headers["idempotency-key"];
        if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
          return reply.code(400).send({
            code: "IDEMPOTENCY_KEY_REQUIRED",
            message: "Заголовок Idempotency-Key обязателен",
          });
        }
        const match = await services.matches.awardPoint({
          matchId,
          side: body.side,
          idempotencyKey: idempotencyKey.trim(),
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
        const body = parseBody(MatchVersionRequestSchema, req.body);
        const idempotencyKey = req.headers["idempotency-key"];
        if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
          return reply.code(400).send({
            code: "IDEMPOTENCY_KEY_REQUIRED",
            message: "Заголовок Idempotency-Key обязателен",
          });
        }
        const match = await services.matches.undoPoint({
          matchId,
          idempotencyKey: idempotencyKey.trim(),
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
        const body = parseBody(StopMatchRequestSchema, req.body);
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
    "/api/v1/matches/:matchId/cancel",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { matchId } = req.params as { matchId: string };
        const body = parseBody(CancelMatchRequestSchema, req.body);
        const idempotencyKey = parseIdempotencyKey(
          req.headers["idempotency-key"],
        );
        const match = await services.matches.cancelMatch({
          matchId,
          actorUserId: req.authUser!.id,
          expectedVersion: body.expectedVersion,
          idempotencyKey,
          reasonText: body.reasonText,
        });
        return { match };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/matches/:matchId/void",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { matchId } = req.params as { matchId: string };
        const body = parseBody(CancelMatchRequestSchema, req.body);
        const idempotencyKey = parseIdempotencyKey(
          req.headers["idempotency-key"],
        );
        const match = await services.matches.voidMatch({
          matchId,
          actorUserId: req.authUser!.id,
          expectedVersion: body.expectedVersion,
          idempotencyKey,
          reasonText: body.reasonText,
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
      const q = req.query as { period?: string; scope?: string };
      const raw = q.scope ?? q.period ?? "all_time";
      const scopeMap: Record<string, "all_time" | "week" | "month"> = {
        all_time: "all_time",
        week: "week",
        month: "month",
        calendar_week: "week",
        calendar_month: "month",
      };
      const scope = scopeMap[raw] ?? "all_time";
      const rankings = await services.matches.getRankings(scope);
      return { rankings };
    },
  );

  app.get("/api/v1/home", { preHandler: requireAuth }, async (req) => {
    const query = req.query as { period?: string };
    const rankingPeriod = query.period === "month" ? "month" : "all_time";
    const dashboard = await services.home.dashboard(
      req.authUser!.id,
      rankingPeriod,
    );
    const unread = await services.notifications.unread(req.authUser!.id);
    const unreadCount = await services.notifications.unreadCount(
      req.authUser!.id,
    );
    return {
      ...dashboard,
      unreadNotifications: unread.slice(0, 5),
      unreadCount,
    };
  });

  // --- Tournaments ---
  app.get("/api/v1/tournaments", { preHandler: requireAuth }, async (req) => {
    const list = await services.tournaments.list(req.authUser!.id);
    return { tournaments: list };
  });

  app.post(
    "/api/v1/tournaments",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const body = req.body as {
          title: string;
          format?: "single_elimination" | "double_elimination";
          organizerParticipates?: boolean;
          pointsToWin?: number;
          mercyEnabled?: boolean;
          mercyPoints?: number | null;
        };
        const tournament = await services.tournaments.create({
          title: body.title,
          format: body.format ?? "single_elimination",
          createdByUserId: req.authUser!.id,
          organizerParticipates: body.organizerParticipates,
          pointsToWin: body.pointsToWin,
          mercyEnabled: body.mercyEnabled,
          mercyPoints: body.mercyPoints,
        });
        return { tournament };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.get(
    "/api/v1/tournaments/:id",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const tournament = await services.tournaments.getVisible(
          id,
          req.authUser!.id,
        );
        if (!tournament) {
          return reply.code(404).send({ code: "NOT_FOUND", message: "Не найден" });
        }
        return { tournament };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.patch(
    "/api/v1/tournaments/:id",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const body = req.body as Record<string, unknown>;
        const tournament = await services.tournaments.patch(
          id,
          req.authUser!.id,
          body as {
            title?: string;
            format?: "single_elimination" | "double_elimination";
            organizerParticipates?: boolean;
            pointsToWin?: number;
            mercyEnabled?: boolean;
            mercyPoints?: number | null;
          },
        );
        return { tournament };
      } catch (e) {
        return sendError(reply, e);
      }
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
          actorUserId: req.authUser!.id,
          ...body,
        });
        return { participant };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.delete(
    "/api/v1/tournaments/:id/participants/:participantId",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { id, participantId } = req.params as {
          id: string;
          participantId: string;
        };
        await services.tournaments.removeParticipant({
          tournamentId: id,
          participantId,
          actorUserId: req.authUser!.id,
        });
        return { ok: true };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/tournaments/:id/invitations",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const body = req.body as { userId: string };
        const invitation = await services.tournaments.invite({
          tournamentId: id,
          invitedUserId: body.userId,
          invitedByUserId: req.authUser!.id,
        });
        return { invitation };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.delete(
    "/api/v1/tournaments/:id/invitations/:invitationId",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { id, invitationId } = req.params as {
          id: string;
          invitationId: string;
        };
        await services.tournaments.cancelInvitation({
          tournamentId: id,
          invitationId,
          actorUserId: req.authUser!.id,
        });
        return { ok: true };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/tournament-invitations/:id/respond",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const body = req.body as { accept: boolean };
        const result = await services.tournaments.respondInvitation({
          invitationId: id,
          userId: req.authUser!.id,
          accept: Boolean(body.accept),
        });
        return result;
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
        const body = (req.body ?? {}) as {
          constructionAlgorithm?: unknown;
        };
        const result = await services.tournaments.generateBracket(
          id,
          req.authUser!.id,
          { constructionAlgorithm: body.constructionAlgorithm },
        );
        return result;
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.patch(
    "/api/v1/tournaments/:id/bracket",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const body = req.body as {
          swaps?: Array<{ slotIdA: string; slotIdB: string }>;
        };
        const result = await services.tournaments.patchBracket(
          id,
          req.authUser!.id,
          body.swaps ?? [],
        );
        return result;
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/tournaments/:id/dissolve-bracket",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const tournament = await services.tournaments.dissolveBracket(
          id,
          req.authUser!.id,
        );
        return { tournament };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/tournaments/:id/withdraw",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const tournament = await services.tournaments.withdraw({
          tournamentId: id,
          userId: req.authUser!.id,
        });
        return { tournament };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/tournaments/:id/cancel",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const tournament = await services.tournaments.cancel(
          id,
          req.authUser!.id,
        );
        return { tournament };
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
        const tournament = await services.tournaments.start(
          id,
          req.authUser!.id,
        );
        return { tournament };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/api/v1/tournaments/:id/stop",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const body = (req.body as { code?: string; text?: string }) ?? {};
        const tournament = await services.tournaments.stop(
          id,
          req.authUser!.id,
          body,
        );
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
      const notification = await services.notifications.markRead(
        req.authUser!.id,
        id,
      );
      return { ok: true, notification };
    },
  );

  app.post(
    "/api/v1/notifications/read-visible",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const body = parseBody(NotificationReadVisibleSchema, req.body);
        const updated = await services.notifications.markVisibleRead(
          req.authUser!.id,
          body.notificationIds,
        );
        return { updated: updated.length, notifications: updated };
      } catch (error) {
        return sendError(reply, error);
      }
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
    SELF_BLOCK_FORBIDDEN: "Нельзя заблокировать собственный аккаунт",
    EMAIL_TAKEN: "Email уже занят",
    EMAIL_ALREADY_EXISTS: "Email уже занят",
    NOT_FOUND: "Не найдено",
    FORBIDDEN: "Недостаточно прав",
    JUDGE_TAKEN: "Судейская сессия занята",
    JUDGE_BUSY: "Вы уже судите другой матч",
    JUDGE_NOT_ACTIVE: "Слот судьи больше не активен",
    JUDGE_REQUIRED: "Требуется судейская сессия",
    CSRF_INVALID: "Недействительный CSRF-токен",
    IDEMPOTENCY_KEY_REQUIRED: "Нужен заголовок Idempotency-Key",
    VERSION_CONFLICT: "Конфликт версии",
    PLAYER_BUSY: "Игрок уже в активном матче",
    INVALID_STATUS: "Действие недоступно в текущем статусе",
    TOO_FEW: "Нужно минимум 3 участника",
    TOO_MANY: "Максимум 64 участника",
    BRACKET_NOT_EDITABLE: "Сетку нельзя менять",
    BRACKET_REGEN_REQUIRED: "Нужна перегенерация сетки",
    BRACKET_MISSING: "Сетка отсутствует",
    BRACKET_CORRUPT: "Сетка повреждена",
    UNSUPPORTED_BRACKET_VERSION: "Неподдерживаемая версия сетки",
    BRACKET_VERSION_CONFLICT: "Конфликт версии сетки",
    BRACKET_ALGORITHM_MISMATCH: "Несогласованность алгоритма сетки",
    INVALID_BRACKET_CONSTRUCTION_ALGORITHM: "Неизвестный способ построения сетки",
    COMPACT_DOUBLE_ELIMINATION_UNSUPPORTED:
      "Компактная сетка пока недоступна для турниров с сеткой проигравших",
    LEGACY_BRACKET_ALGORITHM_REQUIRED:
      "Для сетки старого формата выберите способ построения явно",
    TOURNAMENT_ALREADY_STARTED: "Турнир уже стартовал",
    PLAYER_ALREADY_IN_ACTIVE_MATCH: "Игрок уже в активном матче",
    TOURNAMENT_MATCH_FORBIDDEN:
      "Действие доступно только для обычных матчей",
    MATCH_NOT_ACTIVE: "Матч уже закрыт",
    MATCH_NOT_VOIDABLE: "Аннулировать можно только завершённый или остановленный матч",
    MATCH_IMMUTABLE: "Завершённый спортивный результат нельзя удалить",
    VALIDATION: "Некорректные данные запроса",
    EXPIRED: "Приглашение истекло",
    USE_MATCH: "Для двух игроков создайте обычный матч",
    ALREADY_IN_TOURNAMENT: "Игрок уже в составе турнира",
    NOT_A_PARTICIPANT: "Вы не в составе этого турнира",
    INTERNAL: "Внутренняя ошибка сервера",
  };
  return map[code] ?? code;
}

function safeLogLevel(value: string | undefined): string {
  return new Set([
    "fatal",
    "error",
    "warn",
    "info",
    "debug",
    "trace",
    "silent",
  ]).has(value ?? "")
    ? value!
    : "info";
}

function safeRequestPath(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url.split("?", 1)[0] || "/";
  }
}

function safeErrorSignal(error: unknown): { type: string; code: string } {
  const unsafeType = error instanceof Error ? error.name : "UnknownError";
  const type = new Set([
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "AggregateError",
    "UnknownError",
  ]).has(unsafeType)
    ? unsafeType
    : "Error";
  const unsafeCode = (error as { code?: unknown } | null)?.code;
  const code =
    typeof unsafeCode === "string" &&
    new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"]).has(
      unsafeCode,
    )
      ? unsafeCode
      : "INTERNAL";
  return { type, code };
}

function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw Object.assign(new Error("VALIDATION"), {
    code: "VALIDATION",
    details: {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
  });
}

function parseIdempotencyKey(value: string | string[] | undefined): string {
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new Error("IDEMPOTENCY_KEY_REQUIRED"), {
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
  }
  const parsed = z.string().uuid().safeParse(value.trim());
  if (!parsed.success) {
    throw Object.assign(new Error("VALIDATION"), {
      code: "VALIDATION",
      details: {
        issues: [{ path: "Idempotency-Key", message: "must be a UUID" }],
      },
    });
  }
  return parsed.data;
}

function sendError(reply: FastifyReply, e: unknown) {
  const err = e as {
    code?: string;
    state?: unknown;
    message?: string;
    currentJudge?: { userId: string; displayName: string };
    details?: Record<string, unknown>;
  };
  const rawCode = err.code;
  // PostgreSQL/PGlite SQLSTATEs are infrastructure errors, not public domain
  // codes. Do not leak them or misclassify them as a client-side 400.
  const code =
    rawCode && !/^[0-9A-Z]{5}$/.test(rawCode) ? rawCode : "INTERNAL";
  const badRequestCodes = new Set([
    "JUDGE_BUSY",
    "JUDGE_REQUIRED",
    "IDEMPOTENCY_KEY_REQUIRED",
    "PLAYER_BUSY",
    "INVALID_STATUS",
    "TOO_FEW",
    "TOO_MANY",
    "BRACKET_NOT_EDITABLE",
    "BRACKET_REGEN_REQUIRED",
    "BRACKET_MISSING",
    "BRACKET_CORRUPT",
    "UNSUPPORTED_BRACKET_VERSION",
    "BRACKET_ALGORITHM_MISMATCH",
    "INVALID_BRACKET_CONSTRUCTION_ALGORITHM",
    "COMPACT_DOUBLE_ELIMINATION_UNSUPPORTED",
    "LEGACY_BRACKET_ALGORITHM_REQUIRED",
    "TOURNAMENT_ALREADY_STARTED",
    "PLAYER_ALREADY_IN_ACTIVE_MATCH",
    "TOURNAMENT_MATCH_FORBIDDEN",
    "MATCH_NOT_ACTIVE",
    "MATCH_NOT_VOIDABLE",
    "MATCH_IMMUTABLE",
    "VALIDATION",
    "EXPIRED",
    "USE_MATCH",
    "ALREADY_IN_TOURNAMENT",
    "NOT_A_PARTICIPANT",
  ]);
  const status =
    code === "NOT_FOUND"
      ? 404
      : code === "FORBIDDEN"
        ? 403
        : code === "INTERNAL"
          ? 500
          : code === "VERSION_CONFLICT" ||
              code === "JUDGE_TAKEN" ||
              code === "JUDGE_NOT_ACTIVE" ||
              code === "BRACKET_VERSION_CONFLICT"
            ? 409
            : badRequestCodes.has(code)
              ? 400
              : 500;
  const details: Record<string, unknown> = { ...(err.details ?? {}) };
  if (err.state) details.state = err.state;
  if (err.currentJudge) details.currentJudge = err.currentJudge;
  const message =
    code === "JUDGE_TAKEN" && err.currentJudge
      ? `Этот матч уже судит «${err.currentJudge.displayName}», два судьи у матча — дело к драке. Давай не будем.`
      : messageFor(code);
  return reply.code(status).send({
    code,
    message,
    details: Object.keys(details).length > 0 ? details : undefined,
  });
}

function cryptoRandom(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
