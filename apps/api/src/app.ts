import { matchCreateOptions } from "./modules/matches/match-options.js";
import { RankingService } from "./modules/rankings/ranking-service.js";
import { HistoryService } from "./modules/history/history-service.js";
import { ProfileService } from "./modules/profile/profile-service.js";
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
  UpdateMatchRequestSchema,
  MatchInvitationRequestSchema,
  JudgeHandoverRequestSchema,
  ManualCorrectionRequestSchema,
  NoShowRequestSchema,
  TeamCreateRequestSchema,
  TeamUpdateRequestSchema,
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

const TournamentCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  format: z.enum(["single_elimination", "double_elimination"]).optional(),
  organizerParticipates: z.boolean().optional(),
  pointsToWin: z.number().int().min(1).optional(),
  mercyEnabled: z.boolean().optional(),
  mercyPoints: z.number().int().min(1).nullable().optional(),
}).strict();
const TournamentPatchSchema = TournamentCreateSchema.partial().refine((value) => Object.keys(value).length > 0, "At least one field is required");
const TournamentStopSchema = z.object({
  code: z.string().trim().min(1).max(100),
  text: z.string().trim().max(500).optional(),
}).strict().refine((value) => value.code !== "other" || Boolean(value.text), "Specify the stop reason");
const TournamentBracketPatchSchema = z.object({
  swaps: z.array(z.object({ slotIdA: z.string().min(1).max(100), slotIdB: z.string().min(1).max(100) }).strict()).max(100).optional(),
}).strict();

const ProfileUpdateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    birthDate: z
      .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
        const date = new Date(`${value}T00:00:00.000Z`);
        return Number(value.slice(0, 4)) > 0 && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
      }, "Invalid calendar date"), z.null()])
      .optional(),
    organizationText: z.union([z.string().trim().max(200), z.null()]).optional(),
    positionText: z.union([z.string().trim().max(200), z.null()]).optional(),
  })
  .strict();
const AdminUsersQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(["active", "blocked"]).optional(),
  })
  .strict();
const AdminUserParamsSchema = z.object({ userId: z.string().uuid() }).strict();
const AdminUserPatchSchema = ProfileUpdateSchema.extend({
  role: z.enum(["admin", "user"]).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required",
});

const HistoryQuerySchema = z
  .object({
    role: z.enum(["player", "judge"]).optional(),
    result: z.enum(["win", "loss"]).optional(),
    eventType: z.enum(["match", "tournament"]).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    q: z.string().trim().max(100).optional(),
    cursor: z.string().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from && value.to && Date.parse(value.from) > Date.parse(value.to)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "from must not be after to",
        path: ["from"],
      });
    }
  });

const RankingScopeQuerySchema = z.enum([
  "all_time",
  "week",
  "month",
  "calendar_week",
  "calendar_month",
]);
const RankingQuerySchema = z
  .object({
    period: RankingScopeQuerySchema.optional(),
    scope: RankingScopeQuerySchema.optional(),
    teamId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.period && value.scope && value.period !== value.scope) {
      context.addIssue({
        code: "custom",
        path: ["scope"],
        message: "scope and period must match when both are provided",
      });
    }
  });
const PlayerParamsSchema = z.object({ userId: z.string().uuid() });

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
  rankings: RankingService;
  history: HistoryService;
  profile: ProfileService;
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
  randomIndex?: (length: number) => number;
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
  const matches = new MatchService(opts.db, clock, opts.randomIndex);
  const tournaments = new TournamentService(opts.db, clock, matches);
  matches.setTournamentMatchFinishedHook((matchId, db) =>
    tournaments.onMatchFinished(matchId, db),
  );
  const auth = new AuthService(opts.db, clock);
  const teams = new TeamService(opts.db, clock);
  auth.setUserBlockedHook((userId, db) => teams.transferCaptainOnBlock(userId, db));
  const services: AppServices = {
    auth,
    matches,
    tournaments,
    teams,
    notifications: new NotificationService(opts.db, clock),
    help: new HelpService(opts.db),
    home: new HomeService(opts.db, clock, matches, tournaments),
    rankings: new RankingService(opts.db, matches),
    history: new HistoryService(opts.db, clock),
    profile: new ProfileService(opts.db, matches),
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
      try {
        const { sessionId } = parseBody(z.object({ sessionId: z.string().uuid() }), req.params);
        const ok = await services.auth.revokeSession(req.authUser!.id, sessionId, req.authSessionId);
        if (!ok) return reply.code(404).send({ code: "NOT_FOUND", message: "Сессия не найдена" });
        return { ok: true };
      } catch (error) { return sendError(reply, error); }
    },
  );

  // --- Admin ---
  app.get(
    "/api/v1/admin/users",
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        const query = parseBody(AdminUsersQuerySchema, req.query);
        return { users: await services.auth.listAdminUsers(query) };
      } catch (error) {
        return sendError(reply, error);
      }
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
      try {
        const { userId } = parseBody(AdminUserParamsSchema, req.params);
        const body = parseBody(AdminUserPatchSchema, req.body);
        const user = await services.auth.updateAdminUser(
          req.authUser!.id,
          userId,
          body,
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
        if (err.code === "FORBIDDEN") {
          return reply.code(403).send({
            code: "FORBIDDEN",
            message: "Недостаточно прав",
          });
        }
        return sendError(reply, e);
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
  app.get(
    "/api/v1/profile/me",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        return {
          profile: await services.profile.getProfile(
            req.authUser!.id,
            req.authUser!.id,
          ),
        };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.get(
    "/api/v1/players/:userId",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { userId } = parseBody(PlayerParamsSchema, req.params);
        return {
          profile: await services.profile.getProfile(
            req.authUser!.id,
            userId,
          ),
        };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.patch("/api/v1/profile/me", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const body = parseBody(ProfileUpdateSchema, req.body);
      return { user: await services.auth.updateProfile(req.authUser!.id, body) };
    } catch (error) { return sendError(reply, error); }
  });


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
  app.get("/api/v1/history", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const parsed = parseBody(HistoryQuerySchema, req.query);
      return await services.history.list(req.authUser!.id, {
        ...parsed,
        limit: parsed.limit ?? 20,
        q: parsed.q || undefined,
        from: parsed.from ? new Date(parsed.from) : undefined,
        to: parsed.to ? new Date(parsed.to) : undefined,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });


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

  app.patch("/api/v1/matches/:matchId", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { matchId } = parseBody(z.object({ matchId: z.string().uuid() }), req.params);
      const body = parseBody(UpdateMatchRequestSchema, req.body);
      return { match: await services.matches.updateWaitingMatch(matchId, req.authUser!.id, body) };
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/api/v1/matches/:matchId/invitations", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { matchId } = parseBody(z.object({ matchId: z.string().uuid() }), req.params);
      const body = parseBody(MatchInvitationRequestSchema, req.body);
      return { invitation: await services.matches.createInvitation(matchId, req.authUser!.id, body) };
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/api/v1/match-invitations/:id/accept", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = parseBody(z.object({ id: z.string().uuid() }), req.params);
      parseBody(z.object({}).strict().default({}), req.body);
      return { invitation: await services.matches.respondInvitation(id, req.authUser!.id, true) };
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/api/v1/match-invitations/:id/decline", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = parseBody(z.object({ id: z.string().uuid() }), req.params);
      parseBody(z.object({}).strict().default({}), req.body);
      return { invitation: await services.matches.respondInvitation(id, req.authUser!.id, false) };
    } catch (error) { return sendError(reply, error); }
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
    "/api/v1/matches/:matchId/judge/handover",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { matchId } = parseBody(z.object({ matchId: z.string().uuid() }), req.params);
        const body = parseBody(JudgeHandoverRequestSchema, req.body);
        const reservation = await services.matches.handoverJudge({
          matchId,
          fromUserId: req.authUser!.id,
          fromAuthSessionId: req.authSessionId!,
          toUserId: body.toUserId,
        });
        return { reservation };
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
    "/api/v1/matches/:matchId/manual-correction",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { matchId } = parseBody(z.object({ matchId: z.string().uuid() }), req.params);
        const body = parseBody(ManualCorrectionRequestSchema, req.body);
        const idempotencyKey = parseIdempotencyKey(
          req.headers["idempotency-key"],
        );
        const match = await services.matches.manualCorrection({
          matchId,
          ...body,
          idempotencyKey,
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
    "/api/v1/matches/:matchId/no-show",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { matchId } = parseBody(z.object({ matchId: z.string().uuid() }), req.params);
        const body = parseBody(NoShowRequestSchema, req.body);
        const idempotencyKey = parseIdempotencyKey(
          req.headers["idempotency-key"],
        );
        const match = await services.matches.noShowMatch({
          matchId,
          ...body,
          actorUserId: req.authUser!.id,
          authSessionId: req.authSessionId!,
          idempotencyKey,
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

  app.get(
    "/api/v1/matches/create-options",
    { preHandler: requireAuth },
    async (req) => {
      const users = await services.auth.listDirectory({ excludeUserId: req.authUser!.id });
      return matchCreateOptions(opts.db, req.authUser!.id, users);
    },
  );

  // --- Rankings / Home ---
  app.get(
    "/api/v1/rankings",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const query = parseBody(RankingQuerySchema, req.query);
        const raw = query.scope ?? query.period ?? "all_time";
        const scope =
          raw === "calendar_week"
            ? "week"
            : raw === "calendar_month"
              ? "month"
              : raw;
        return await services.rankings.list({
          actorUserId: req.authUser!.id,
          scope,
          teamId: query.teamId,
        });
      } catch (error) {
        return sendError(reply, error);
      }
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
        const body = parseBody(TournamentCreateSchema, req.body);
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
        const { id } = parseBody(z.object({ id: z.string().uuid() }), req.params);
        const body = parseBody(TournamentPatchSchema, req.body);
        const tournament = await services.tournaments.patch(id, req.authUser!.id, body);
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
        const { id } = parseBody(z.object({ id: z.string().uuid() }), req.params);
        const body = parseBody(TournamentBracketPatchSchema, req.body ?? {});
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
        const { id } = parseBody(z.object({ id: z.string().uuid() }), req.params);
        const body = parseBody(TournamentStopSchema, req.body);
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
  const teamIdParams = z.object({ id: z.string().uuid() });
  const teamUserBody = z.object({ userId: z.string().uuid() }).strict();
  app.get("/api/v1/teams", { preHandler: requireAuth }, async (req) => {
    return { teams: await services.teams.listForUser(req.authUser!.id) };
  });
  app.post("/api/v1/teams", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const body = parseBody(TeamCreateRequestSchema, req.body);
      const team = await services.teams.create({ ...body, captainUserId: req.authUser!.id });
      return { team: await services.teams.getForUser(team!.id, req.authUser!.id) };
    } catch (error) { return sendError(reply, error); }
  });
  app.get("/api/v1/teams/:id", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = parseBody(teamIdParams, req.params);
      return { team: await services.teams.getForUser(id, req.authUser!.id) };
    } catch (error) { return sendError(reply, error); }
  });
  app.patch("/api/v1/teams/:id", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = parseBody(teamIdParams, req.params);
      const body = parseBody(TeamUpdateRequestSchema, req.body);
      return { team: await services.teams.update(id, req.authUser!.id, body) };
    } catch (error) { return sendError(reply, error); }
  });
  const inviteTeam = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = parseBody(teamIdParams, req.params);
      const body = parseBody(teamUserBody, req.body);
      return { invitation: await services.teams.invite({ teamId: id, invitedUserId: body.userId, invitedByUserId: req.authUser!.id }) };
    } catch (error) { return sendError(reply, error); }
  };
  app.post("/api/v1/teams/:id/invite", { preHandler: requireAuth }, inviteTeam);
  app.post("/api/v1/teams/:id/invitations", { preHandler: requireAuth }, inviteTeam);
  app.post("/api/v1/team-invitations/:id/respond", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = parseBody(teamIdParams, req.params);
      const body = parseBody(z.object({ accept: z.boolean() }).strict(), req.body);
      return await services.teams.respondInvitation({ invitationId: id, userId: req.authUser!.id, accept: body.accept });
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/api/v1/team-invitations/:id/accept", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = parseBody(teamIdParams, req.params);
      parseBody(z.object({}).strict(), req.body ?? {});
      return await services.teams.respondInvitation({ invitationId: id, userId: req.authUser!.id, accept: true });
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/api/v1/team-invitations/:id/decline", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = parseBody(teamIdParams, req.params);
      parseBody(z.object({}).strict(), req.body ?? {});
      return await services.teams.respondInvitation({ invitationId: id, userId: req.authUser!.id, accept: false });
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/api/v1/teams/:id/leave", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = parseBody(teamIdParams, req.params);
      parseBody(z.object({}).strict(), req.body ?? {});
      return { team: await services.teams.leave(id, req.authUser!.id) };
    } catch (error) { return sendError(reply, error); }
  });
  app.delete("/api/v1/teams/:id/members/:userId", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id, userId } = parseBody(z.object({ id: z.string().uuid(), userId: z.string().uuid() }), req.params);
      return { team: await services.teams.removeMember(id, req.authUser!.id, userId) };
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/api/v1/teams/:id/captain-transfer", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = parseBody(teamIdParams, req.params);
      const body = parseBody(teamUserBody, req.body);
      return { team: await services.teams.transferCaptain(id, req.authUser!.id, body.userId) };
    } catch (error) { return sendError(reply, error); }
  });

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
    async (req, reply) => {
      try {
        const body = parseBody(z.object({ kind: z.enum(["bug", "idea", "question", "other"]), message: z.string().trim().min(1).max(4000) }).strict(), req.body);
        const feedback = await services.help.submitFeedback({ userId: req.authUser!.id, ...body });
        return { feedback };
      } catch (error) { return sendError(reply, error); }
    },
  );

  return { app, services };
}

function messageFor(code: string): string {
  const map: Record<string, string> = {
    PLAYER_CONSENT_REQUIRED: "Дождитесь согласия всех приглашённых игроков",
    INVITATION_EXPIRED: "Срок приглашения истёк. Попросите организатора отправить новое",
    INVALID_CREDENTIALS: "Неверный email или пароль",
    ACCOUNT_BLOCKED: "Аккаунт заблокирован",
    RATE_LIMITED: "Слишком много попыток",
    PASSWORD_POLICY: "Пароль не соответствует политике",
    PASSWORD_CHANGE_REQUIRED: "Необходимо сменить пароль",
    LAST_ADMIN: "Нельзя заблокировать последнего администратора",
    SELF_BLOCK_FORBIDDEN: "Нельзя заблокировать собственный аккаунт",
    CURRENT_SESSION_FORBIDDEN: "Текущую сессию можно завершить только через выход",
    EMAIL_TAKEN: "Email уже занят",
    EMAIL_ALREADY_EXISTS: "Email уже занят",
    NOT_FOUND: "Не найдено",
    FORBIDDEN: "Недостаточно прав",
    JUDGE_TAKEN: "Судейская сессия занята",
    JUDGE_RESERVED: "Слот судьи зарезервирован для другого пользователя",
    TEAM_ARCHIVED: "Команда в архиве: доступен только просмотр",
    MEMBER_NOT_FOUND: "Активный участник команды не найден",
    CAPTAIN_TRANSFER_REQUIRED: "Сначала передайте капитанство другому участнику",
    JUDGE_BUSY: "Вы уже судите другой матч",
    JUDGE_OTHER_DEVICE: "Вы уже судите с другого устройства. Освободите там слот судьи, чтобы продолжить здесь",
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
    "INVITATION_EXPIRED",
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
          : code === "PLAYER_CONSENT_REQUIRED" ||
              code === "VERSION_CONFLICT" ||
              code === "JUDGE_TAKEN" ||
              code === "JUDGE_OTHER_DEVICE" ||
              code === "JUDGE_RESERVED" ||
              code === "JUDGE_NOT_ACTIVE" ||
              code === "BRACKET_VERSION_CONFLICT" ||
              code === "CURRENT_SESSION_FORBIDDEN"
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
