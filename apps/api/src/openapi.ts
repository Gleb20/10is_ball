import { productVersion } from "./release-metadata.js";

type JsonSchema = Record<string, unknown>;

type OperationOptions = {
  operationId: string;
  summary: string;
  tag: string;
  public?: boolean;
  mutation?: boolean;
  parameters?: Array<Record<string, unknown>>;
  request?: string;
  requestRequired?: boolean;
  response?: JsonSchema;
  errors?: number[];
  idempotency?: boolean;
};

const ref = (name: string): JsonSchema => ({ $ref: `#/components/schemas/${name}` });
const objectRef = (property: string, name: string): JsonSchema => ({
  type: "object",
  required: [property],
  properties: { [property]: ref(name) },
});
const arrayRef = (property: string, name: string): JsonSchema => ({
  type: "object",
  required: [property],
  properties: { [property]: { type: "array", items: ref(name) } },
});
const pathParameters = (...names: string[]) =>
  names.map((name) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string", minLength: 1 },
  }));
const queryParameter = (
  name: string,
  schema: JsonSchema = { type: "string" },
) => ({ name, in: "query", required: false, schema });

function operation(options: OperationOptions) {
  const errors =
    options.errors ??
    (options.public ? [500] : options.mutation ? [400, 401, 403, 404, 409, 500] : [401, 403, 404, 500]);
  const parameters = [...(options.parameters ?? [])];
  if (options.idempotency) {
    parameters.push({
      name: "Idempotency-Key",
      in: "header",
      required: true,
      description: "Unique mutation key. UUID where the runtime enforces UUID format.",
      schema: { type: "string", minLength: 1 },
    });
  }
  return {
    operationId: options.operationId,
    summary: options.summary,
    tags: [options.tag],
    security: options.public
      ? []
      : options.mutation
        ? [{ sessionCookie: [], csrfHeader: [] }]
        : [{ sessionCookie: [] }],
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(options.request
      ? {
          requestBody: {
            required: options.requestRequired ?? true,
            content: { "application/json": { schema: ref(options.request) } },
          },
        }
      : {}),
    responses: {
      200: {
        description: "Success",
        content: {
          "application/json": { schema: options.response ?? ref("GenericObject") },
        },
      },
      ...Object.fromEntries(
        errors.map((status) => [
          status,
          {
            description: status === 500 ? "Internal server error" : "Request rejected",
            content: { "application/json": { schema: ref("ApiError") } },
          },
        ]),
      ),
    },
  };
}

const schemas: Record<string, JsonSchema> = {
  ApiError: {
    type: "object",
    required: ["code", "message"],
    properties: {
      code: { type: "string" },
      message: { type: "string" },
      details: { type: "object", additionalProperties: true },
      requestId: { type: "string" },
    },
  },
  GenericObject: { type: "object", additionalProperties: true },
  Ok: {
    type: "object",
    required: ["ok"],
    properties: { ok: { type: "boolean", enum: [true] } },
  },
  Health: {
    type: "object",
    required: ["status", "time"],
    properties: {
      status: { type: "string", enum: ["ok"] },
      time: { type: "string", format: "date-time" },
      auditEphemeral: { type: "boolean" },
    },
  },
  Readiness: {
    type: "object",
    required: ["status", "checks", "time"],
    properties: {
      status: { type: "string", enum: ["ready"] },
      checks: {
        type: "object",
        required: ["database"],
        properties: { database: { type: "string", enum: ["ok"] } },
      },
      time: { type: "string", format: "date-time" },
    },
  },
  HomeEvent: {
    type: "object",
    required: ["type", "id", "title", "status", "durationSeconds", "userRole", "occurredAt"],
    properties: {
      type: { type: "string", enum: ["match", "tournament"] },
      id: { type: "string", format: "uuid" },
      title: { type: "string" },
      status: { type: "string" },
      scoreA: { type: "integer" },
      scoreB: { type: "integer" },
      sideA: { type: "string" },
      sideB: { type: "string" },
      winnerName: { type: "string", nullable: true },
      durationSeconds: { type: "integer", minimum: 0, nullable: true },
      format: { type: "string" },
      judgeName: { type: "string", nullable: true },
      topThree: { type: "array", maxItems: 3, items: { type: "string" } },
      userRole: { type: "string", enum: ["participant", "judge", "organizer", "viewer"] },
      occurredAt: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
  },
  HomeDashboard: {
    type: "object",
    required: ["rankingPeriod", "myStats", "activeEvents", "recentEvents", "topRankings", "unreadNotifications", "unreadCount"],
    properties: {
      rankingPeriod: { type: "string", enum: ["all_time", "month"] },
      myStats: {
        type: "object",
        required: ["rank", "matchesPlayed", "wins", "losses", "winRate", "averagePoints", "displayName", "avatarKey", "rival"],
        properties: {
          rank: { type: "integer", minimum: 1, nullable: true },
          matchesPlayed: { type: "integer", minimum: 0 },
          wins: { type: "integer", minimum: 0 },
          losses: { type: "integer", minimum: 0 },
          winRate: { type: "number", minimum: 0, maximum: 1 },
          averagePoints: { type: "number", minimum: 0 },
          displayName: { type: "string" },
          avatarKey: { type: "string", nullable: true },
          rival: {
            type: "object",
            nullable: true,
            required: ["userId", "displayName", "matchCount"],
            properties: {
              userId: { type: "string", format: "uuid" },
              displayName: { type: "string" },
              matchCount: { type: "integer", minimum: 3 },
            },
          },
        },
        additionalProperties: false,
      },
      activeEvents: {
        type: "object",
        required: ["match", "tournament"],
        properties: {
          match: { ...ref("HomeEvent"), nullable: true },
          tournament: { ...ref("HomeEvent"), nullable: true },
        },
        additionalProperties: false,
      },
      recentEvents: { type: "array", maxItems: 5, items: ref("HomeEvent") },
      topRankings: { type: "array", maxItems: 3, items: ref("Ranking") },
      unreadNotifications: { type: "array", maxItems: 5, items: ref("Notification") },
      unreadCount: { type: "integer", minimum: 0 },
    },
    additionalProperties: true,
  },
  HistoryItem: {
    type: "object",
    required: ["type", "id", "title", "status", "occurredAt", "roles", "result", "matchKind", "scoreA", "scoreB", "format"],
    properties: {
      type: { type: "string", enum: ["match", "tournament"] },
      id: { type: "string", format: "uuid" },
      title: { type: "string" },
      status: { type: "string" },
      occurredAt: { type: "string", format: "date-time" },
      roles: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { type: "string", enum: ["player", "judge", "organizer", "viewer"] },
      },
      result: { type: "string", enum: ["win", "loss"], nullable: true },
      matchKind: { type: "string", nullable: true },
      scoreA: { type: "integer", nullable: true },
      scoreB: { type: "integer", nullable: true },
      format: { type: "string", nullable: true },
    },
    additionalProperties: false,
  },
  HistoryFeed: {
    type: "object",
    required: ["items", "nextCursor"],
    properties: {
      items: { type: "array", items: ref("HistoryItem") },
      nextCursor: { type: "string", nullable: true },
    },
    additionalProperties: false,
  },
  User: {
    type: "object",
    required: ["id", "email", "role", "status", "firstName", "lastName", "mustChangePassword"],
    properties: {
      id: { type: "string" },
      email: { type: "string", format: "email" },
      role: { type: "string", enum: ["admin", "user"] },
      status: { type: "string", enum: ["active", "blocked"] },
      firstName: { type: "string" },
      lastName: { type: "string" },
      mustChangePassword: { type: "boolean" },
      birthDate: { type: "string", nullable: true },
      organizationText: { type: "string", nullable: true },
      positionText: { type: "string", nullable: true },
      avatarKey: { type: "string", nullable: true },
      onboardingStep: { type: "integer", minimum: 0, maximum: 6 },
      onboardingCompletedAt: { type: "string", format: "date-time", nullable: true },
      createdAt: { type: "string", format: "date-time" },
    },
    additionalProperties: true,
  },
  DirectoryUser: {
    type: "object",
    required: ["id", "firstName", "lastName"],
    properties: {
      id: { type: "string" },
      firstName: { type: "string" },
      lastName: { type: "string" },
      avatarKey: { type: "string", nullable: true },
    },
    additionalProperties: true,
  },
  AuthSession: {
    type: "object",
    required: ["id", "createdAt", "lastSeenAt", "current"],
    properties: {
      id: { type: "string" },
      userAgent: { type: "string", nullable: true },
      createdAt: { type: "string", format: "date-time" },
      lastSeenAt: { type: "string", format: "date-time" },
      current: { type: "boolean" },
    },
    additionalProperties: false,
  },
  PlayerProfile: {
    type: "object",
    required: ["isOwn", "canChallenge", "identity", "avatar", "stats", "facts", "teams"],
    properties: {
      isOwn: { type: "boolean" },
      canChallenge: { type: "boolean" },
      identity: {
        type: "object",
        required: ["id", "firstName", "lastName", "displayName", "avatarKey", "organizationText", "positionText"],
        properties: {
          id: { type: "string", format: "uuid" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          displayName: { type: "string" },
          avatarKey: { type: "string", nullable: true },
          organizationText: { type: "string", nullable: true },
          positionText: { type: "string", nullable: true },
          email: { type: "string", format: "email" },
          birthDate: { type: "string", format: "date", nullable: true },
        },
        additionalProperties: false,
      },
      avatar: {
        type: "object",
        required: ["key", "editable"],
        properties: {
          key: { type: "string", nullable: true },
          editable: { type: "boolean", enum: [false] },
        },
        additionalProperties: false,
      },
      stats: {
        type: "object",
        required: ["matchesPlayed", "wins", "losses", "winRate", "averagePoints", "tournamentsPlayed", "tournamentWins", "tournamentsCreated", "judgedMatches", "rank"],
        properties: {
          matchesPlayed: { type: "integer", minimum: 0 },
          wins: { type: "integer", minimum: 0 },
          losses: { type: "integer", minimum: 0 },
          winRate: { type: "number", minimum: 0, maximum: 1 },
          averagePoints: { type: "number", minimum: 0 },
          tournamentsPlayed: { type: "integer", minimum: 0 },
          tournamentWins: { type: "integer", minimum: 0 },
          tournamentsCreated: { type: "integer", minimum: 0 },
          judgedMatches: { type: "integer", minimum: 0 },
          rank: { type: "integer", minimum: 1, nullable: true },
        },
        additionalProperties: false,
      },
      facts: { type: "object", additionalProperties: true },
      teams: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "name", "role"],
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            role: { type: "string", enum: ["captain", "member"] },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
  Match: {
    type: "object",
    required: ["id", "title", "kind", "status", "version"],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      kind: { type: "string", enum: ["standalone", "tournament", "tutorial"] },
      status: {
        type: "string",
        enum: ["waiting", "in_progress", "pending_confirmation", "finished", "stopped", "cancelled", "voided"],
      },
      version: { type: "integer", minimum: 0 },
      winnerSide: { type: "string", enum: ["A", "B"], nullable: true },
      participants: { type: "array", items: ref("Participant") },
      activeJudge: { type: "object", nullable: true, additionalProperties: true },
    },
    additionalProperties: true,
  },
  Participant: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" },
      userId: { type: "string", nullable: true },
      displayName: { type: "string" },
      side: { type: "string", enum: ["A", "B"] },
      status: { type: "string" },
    },
    additionalProperties: true,
  },
  JudgeSession: {
    type: "object",
    required: ["id", "matchId", "userId"],
    properties: {
      id: { type: "string" },
      matchId: { type: "string" },
      userId: { type: "string" },
      expiresAt: { type: "string", format: "date-time" },
      releasedAt: { type: "string", format: "date-time", nullable: true },
    },
    additionalProperties: true,
  },
  Tournament: {
    type: "object",
    required: ["id", "title", "format", "status"],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      format: { type: "string", enum: ["single_elimination", "double_elimination"] },
      status: {
        type: "string",
        enum: ["collecting", "bracket_generated", "needs_regeneration", "in_progress", "finished", "stopped", "cancelled"],
      },
      createdByUserId: { type: "string" },
      participants: { type: "array", items: ref("Participant") },
      bracket: { type: "object", nullable: true, additionalProperties: true },
    },
    additionalProperties: true,
  },
  Team: {
    type: "object",
    required: ["id", "name", "captainUserId"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      captainUserId: { type: "string" },
      slogan: { type: "string", nullable: true },
      welcomeText: { type: "string", nullable: true },
    },
    additionalProperties: true,
  },
  Invitation: {
    type: "object",
    required: ["id", "status"],
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: ["pending", "accepted", "declined", "expired", "cancelled"] },
    },
    additionalProperties: true,
  },
  Notification: {
    type: "object",
    required: ["id", "type", "readAt", "actionable"],
    properties: {
      id: { type: "string" },
      type: { type: "string" },
      readAt: { type: "string", format: "date-time", nullable: true },
      actionable: { type: "boolean" },
      lifecycle: { type: "string", nullable: true },
      reasonCode: { type: "string", nullable: true },
      lifecycleAt: { type: "string", format: "date-time", nullable: true },
      expiresAt: { type: "string", format: "date-time", nullable: true },
    },
    additionalProperties: true,
  },
  Ranking: {
    type: "object",
    required: ["userId", "displayName", "wins", "losses", "matchesPlayed", "winRate", "avatarKey"],
    properties: {
      userId: { type: "string" },
      displayName: { type: "string" },
      wins: { type: "integer", minimum: 0 },
      losses: { type: "integer", minimum: 0 },
      matchesPlayed: { type: "integer", minimum: 0 },
      winRate: { type: "number", minimum: 0, maximum: 1 },
      avatarKey: { type: "string", nullable: true },
    },
    additionalProperties: true,
  },
  RankingTeamOption: {
    type: "object",
    required: ["id", "name"],
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
    },
    additionalProperties: false,
  },
  RankingTeamContext: {
    type: "object",
    required: ["id", "name", "activeMemberCount", "winsAllTime"],
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      activeMemberCount: { type: "integer", minimum: 0 },
      winsAllTime: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
  },
  RankingResponse: {
    type: "object",
    required: ["scope", "team", "availableTeams", "rankings"],
    properties: {
      scope: { type: "string", enum: ["all_time", "week", "month"] },
      team: { ...ref("RankingTeamContext"), nullable: true },
      availableTeams: { type: "array", items: ref("RankingTeamOption") },
      rankings: { type: "array", items: ref("Ranking") },
    },
    additionalProperties: false,
  },
  LoginRequest: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email" },
      password: { type: "string", minLength: 1 },
    },
    additionalProperties: false,
  },
  LoginResponse: {
    type: "object",
    required: ["user", "csrfToken"],
    properties: { user: ref("User"), csrfToken: { type: "string" } },
  },
  PasswordFirstChangeRequest: {
    type: "object",
    required: ["newPassword"],
    properties: { newPassword: { type: "string", minLength: 1 } },
    additionalProperties: false,
  },
  PasswordChangeRequest: {
    type: "object",
    required: ["currentPassword", "newPassword"],
    properties: {
      currentPassword: { type: "string", minLength: 1 },
      newPassword: { type: "string", minLength: 1 },
    },
    additionalProperties: false,
  },
  CreateAdminUserRequest: {
    type: "object",
    required: ["email", "firstName", "lastName"],
    properties: {
      email: { type: "string", format: "email" },
      firstName: { type: "string", minLength: 1, maxLength: 100 },
      lastName: { type: "string", minLength: 1, maxLength: 100 },
      role: { type: "string", enum: ["admin", "user"], default: "user" },
    },
    additionalProperties: false,
  },
  RoleUpdateRequest: {
    type: "object",
    required: ["role"],
    properties: { role: { type: "string", enum: ["admin", "user"] } },
    additionalProperties: false,
  },
  ProfileUpdateRequest: {
    type: "object",
    properties: {
      firstName: { type: "string" },
      lastName: { type: "string" },
      birthDate: { type: "string", nullable: true },
      organizationText: { type: "string", nullable: true },
      positionText: { type: "string", nullable: true },
      onboardingCompleted: { type: "boolean" },
    },
    additionalProperties: false,
  },
  ProfileLocalUpdateRequest: {
    type: "object",
    properties: {
      firstName: { type: "string", minLength: 1, maxLength: 100 },
      lastName: { type: "string", minLength: 1, maxLength: 100 },
      birthDate: { type: "string", format: "date", nullable: true },
      organizationText: { type: "string", maxLength: 200, nullable: true },
      positionText: { type: "string", maxLength: 200, nullable: true },
    },
    additionalProperties: false,
  },
  OnboardingMutationRequest: {
    oneOf: [
      {
        type: "object",
        required: ["action", "step"],
        properties: {
          action: { type: "string", enum: ["set-step"] },
          step: { type: "integer", minimum: 0, maximum: 6 },
        },
        additionalProperties: false,
      },
      {
        type: "object",
        required: ["action"],
        properties: { action: { type: "string", enum: ["complete", "restart"] } },
        additionalProperties: false,
      },
    ],
  },
  MatchParticipantRequest: {
    type: "object",
    required: ["side"],
    properties: {
      side: { type: "string", enum: ["A", "B"] },
      userId: { type: "string" },
      guestFirstName: { type: "string", minLength: 1, maxLength: 100 },
      guestLastName: { type: "string", minLength: 1, maxLength: 100 },
    },
    additionalProperties: false,
  },
  CreateMatchRequest: {
    type: "object",
    required: ["title", "format", "participants"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 200 },
      format: { type: "string", enum: ["1v1", "2v2"] },
      pointsToWin: { type: "integer", minimum: 1 },
      mercyEnabled: { type: "boolean" },
      mercyPoints: { type: "integer", minimum: 1, nullable: true },
      source: { type: "string", enum: ["manual", "challenge", "revenge", "tutorial"] },
      participants: { type: "array", maxItems: 4, items: ref("MatchParticipantRequest") },
    },
    additionalProperties: false,
  },
  StartMatchRequest: {
    type: "object",
    properties: { firstServerParticipantId: { type: "string" } },
    additionalProperties: false,
  },
  JudgeSetupRequest: {
    type: "object",
    properties: {
      firstServerParticipantId: { type: "string" },
      swapSides: { type: "boolean" },
      displayFlipped: { type: "boolean" },
    },
    additionalProperties: false,
  },
  MatchVersionRequest: {
    type: "object",
    required: ["expectedVersion"],
    properties: { expectedVersion: { type: "integer", minimum: 0 } },
    additionalProperties: false,
  },
  AwardPointRequest: {
    type: "object",
    required: ["side", "expectedVersion"],
    properties: {
      side: { type: "string", enum: ["A", "B"] },
      expectedVersion: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
  },
  StopMatchRequest: {
    type: "object",
    required: ["winnerSide", "reasonCode"],
    properties: {
      winnerSide: { type: "string", enum: ["A", "B"] },
      reasonCode: { type: "string", enum: ["injury", "time", "other"] },
      reasonText: { type: "string", maxLength: 500 },
    },
    additionalProperties: false,
  },
  CancelMatchRequest: {
    type: "object",
    required: ["expectedVersion"],
    properties: {
      expectedVersion: { type: "integer", minimum: 0 },
      reasonText: { type: "string", maxLength: 500 },
    },
    additionalProperties: false,
  },
  CreateTournamentRequest: {
    type: "object",
    required: ["title"],
    properties: {
      title: { type: "string" },
      format: { type: "string", enum: ["single_elimination", "double_elimination"] },
      organizerParticipates: { type: "boolean" },
      pointsToWin: { type: "integer", minimum: 1 },
      mercyEnabled: { type: "boolean" },
      mercyPoints: { type: "integer", minimum: 1, nullable: true },
    },
    additionalProperties: false,
  },
  TournamentPatchRequest: {
    type: "object",
    properties: {
      title: { type: "string" },
      format: { type: "string", enum: ["single_elimination", "double_elimination"] },
      organizerParticipates: { type: "boolean" },
      pointsToWin: { type: "integer", minimum: 1 },
      mercyEnabled: { type: "boolean" },
      mercyPoints: { type: "integer", minimum: 1, nullable: true },
    },
    additionalProperties: false,
  },
  TournamentParticipantRequest: {
    type: "object",
    properties: {
      userId: { type: "string" },
      guestFirstName: { type: "string" },
      guestLastName: { type: "string" },
    },
    additionalProperties: false,
  },
  UserIdRequest: {
    type: "object",
    required: ["userId"],
    properties: { userId: { type: "string" } },
    additionalProperties: false,
  },
  InvitationResponseRequest: {
    type: "object",
    required: ["accept"],
    properties: { accept: { type: "boolean" } },
    additionalProperties: false,
  },
  NotificationReadVisibleRequest: {
    type: "object",
    required: ["notificationIds"],
    properties: {
      notificationIds: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: { type: "string", format: "uuid" },
      },
    },
    additionalProperties: false,
  },
  BracketGenerateRequest: {
    type: "object",
    properties: { constructionAlgorithm: { type: "string", enum: ["compact", "power_of_two"] } },
    additionalProperties: false,
  },
  BracketPatchRequest: {
    type: "object",
    properties: {
      swaps: {
        type: "array",
        items: {
          type: "object",
          required: ["slotIdA", "slotIdB"],
          properties: { slotIdA: { type: "string" }, slotIdB: { type: "string" } },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
  TournamentStopRequest: {
    type: "object",
    properties: { code: { type: "string" }, text: { type: "string" } },
    additionalProperties: false,
  },
  CreateTeamRequest: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string" },
      slogan: { type: "string" },
      welcomeText: { type: "string" },
    },
    additionalProperties: false,
  },
  FeedbackRequest: {
    type: "object",
    required: ["kind", "message"],
    properties: { kind: { type: "string" }, message: { type: "string" } },
    additionalProperties: false,
  },
};

export function openApiSpec(releaseVersion = productVersion()) {
  return {
    openapi: "3.0.3",
    info: {
      title: "Tab-10 API",
      version: releaseVersion,
      description: "As-built API contract for the current repository release. Target-only names remain in requirements until implemented.",
    },
    components: {
      securitySchemes: {
        sessionCookie: { type: "apiKey", in: "cookie", name: "tab10_session" },
        csrfHeader: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
      },
      schemas,
    },
    paths: {
      "/health": {
        get: operation({ operationId: "getHealth", summary: "Liveness and clock", tag: "Operations", public: true, response: ref("Health") }),
      },
      "/ready": {
        get: operation({ operationId: "getReadiness", summary: "Database readiness", tag: "Operations", public: true, response: ref("Readiness"), errors: [500, 503] }),
      },
      "/api/v1/openapi.json": {
        get: operation({ operationId: "getOpenApi", summary: "Current OpenAPI document", tag: "Operations", public: true, response: { type: "object", required: ["openapi", "info", "paths"], additionalProperties: true } }),
      },
      "/api/v1/auth/login": {
        post: operation({ operationId: "login", summary: "Create a session", tag: "Auth", public: true, mutation: true, request: "LoginRequest", response: ref("LoginResponse"), errors: [400, 401, 403, 429, 500] }),
      },
      "/api/v1/auth/logout": {
        post: operation({ operationId: "logout", summary: "Revoke the current session", tag: "Auth", mutation: true, response: ref("Ok") }),
      },
      "/api/v1/auth/me": {
        get: operation({ operationId: "getCurrentUser", summary: "Get current authenticated user", tag: "Auth", response: objectRef("user", "User") }),
      },
      "/api/v1/auth/password/first-change": {
        post: operation({ operationId: "changeTemporaryPassword", summary: "Replace temporary password", tag: "Auth", mutation: true, request: "PasswordFirstChangeRequest", response: ref("Ok") }),
      },
      "/api/v1/auth/password/change": {
        post: operation({ operationId: "changePassword", summary: "Change current password", tag: "Auth", mutation: true, request: "PasswordChangeRequest", response: ref("Ok") }),
      },
      "/api/v1/auth/sessions": {
        get: operation({ operationId: "listAuthSessions", summary: "List own sessions", tag: "Auth", response: arrayRef("sessions", "AuthSession") }),
      },
      "/api/v1/auth/sessions/{sessionId}": {
        delete: operation({ operationId: "revokeAuthSession", summary: "Revoke one own session", tag: "Auth", mutation: true, parameters: pathParameters("sessionId"), response: ref("Ok") }),
      },
      "/api/v1/admin/users": {
        get: operation({ operationId: "adminListUsers", summary: "List users as admin", tag: "Admin", parameters: [queryParameter("q")], response: arrayRef("users", "User") }),
        post: operation({ operationId: "adminCreateUser", summary: "Create user and temporary password", tag: "Admin", mutation: true, request: "CreateAdminUserRequest", response: { type: "object", required: ["user", "temporaryPassword"], properties: { user: ref("User"), temporaryPassword: { type: "string" } } } }),
      },
      "/api/v1/admin/users/{userId}": {
        patch: operation({ operationId: "adminUpdateUserRole", summary: "Update user role", tag: "Admin", mutation: true, parameters: pathParameters("userId"), request: "RoleUpdateRequest", response: objectRef("user", "User") }),
      },
      "/api/v1/admin/users/{userId}/block": {
        post: operation({ operationId: "adminBlockUser", summary: "Block user and revoke sessions", tag: "Admin", mutation: true, parameters: pathParameters("userId"), response: ref("Ok") }),
      },
      "/api/v1/admin/users/{userId}/unblock": {
        post: operation({ operationId: "adminUnblockUser", summary: "Unblock user", tag: "Admin", mutation: true, parameters: pathParameters("userId"), response: ref("Ok") }),
      },
      "/api/v1/admin/users/{userId}/reset-password": {
        post: operation({ operationId: "adminResetUserPassword", summary: "Reset user password", tag: "Admin", mutation: true, parameters: pathParameters("userId"), response: { type: "object", required: ["temporaryPassword"], properties: { temporaryPassword: { type: "string" } } } }),
      },
      "/api/v1/admin/matches/{matchId}/force-close": {
        post: operation({ operationId: "adminForceCloseMatch", summary: "Force-close active standalone match", tag: "Admin", mutation: true, parameters: pathParameters("matchId"), request: "CancelMatchRequest", response: objectRef("match", "Match"), idempotency: true }),
      },
      "/api/v1/admin/matches/{matchId}": {
        delete: operation({ operationId: "adminDeleteMatch", summary: "Purge eligible standalone match", tag: "Admin", mutation: true, parameters: pathParameters("matchId"), response: ref("GenericObject") }),
      },
      "/api/v1/me/profile": {
        patch: operation({ operationId: "updateOwnProfileLegacyAlias", summary: "Update own profile (compatibility alias)", tag: "Profile", mutation: true, parameters: [], request: "ProfileUpdateRequest", response: objectRef("user", "User") }),
      },
      "/api/v1/profile/me": {
        get: operation({ operationId: "getOwnProfile", summary: "Get complete own profile", tag: "Profile", response: objectRef("profile", "PlayerProfile") }),
        patch: operation({ operationId: "updateOwnProfile", summary: "Update own local profile fields", tag: "Profile", mutation: true, request: "ProfileLocalUpdateRequest", response: objectRef("user", "User") }),
      },
      "/api/v1/players/{userId}": {
        get: operation({ operationId: "getPlayerProfile", summary: "Get privacy-safe player profile", tag: "Profile", parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], response: objectRef("profile", "PlayerProfile") }),
      },
      "/api/v1/me/onboarding": {
        patch: operation({ operationId: "updateOwnOnboarding", summary: "Update onboarding progress (runtime name)", tag: "Profile", mutation: true, request: "OnboardingMutationRequest", response: objectRef("user", "User") }),
      },
      "/api/v1/history": {
        get: operation({
          operationId: "listHistory",
          summary: "List visible match and tournament history",
          tag: "History",
          parameters: [
            queryParameter("role", { type: "string", enum: ["player", "judge"] }),
            queryParameter("result", { type: "string", enum: ["win", "loss"] }),
            queryParameter("eventType", { type: "string", enum: ["match", "tournament"] }),
            queryParameter("from", { type: "string", format: "date-time" }),
            queryParameter("to", { type: "string", format: "date-time" }),
            queryParameter("q", { type: "string", maxLength: 100 }),
            queryParameter("cursor", { type: "string", maxLength: 500 }),
            queryParameter("limit", { type: "integer", minimum: 1, maximum: 50, default: 20 }),
          ],
          response: ref("HistoryFeed"),
          errors: [400, 401, 403, 500],
        }),
      },
      "/api/v1/matches": {
        get: operation({ operationId: "listMatches", summary: "List visible matches", tag: "Matches", response: arrayRef("matches", "Match") }),
        post: operation({ operationId: "createMatch", summary: "Create standalone match", tag: "Matches", mutation: true, request: "CreateMatchRequest", response: objectRef("match", "Match") }),
      },
      "/api/v1/matches/tutorial": {
        post: operation({ operationId: "createTutorialMatch", summary: "Create or resume tutorial match", tag: "Matches", mutation: true, response: objectRef("match", "Match") }),
      },
      "/api/v1/matches/{matchId}": {
        get: operation({ operationId: "getMatch", summary: "Get visible match", tag: "Matches", parameters: pathParameters("matchId"), response: objectRef("match", "Match") }),
      },
      "/api/v1/matches/{matchId}/start": {
        post: operation({ operationId: "startMatch", summary: "Start match", tag: "Matches", mutation: true, parameters: pathParameters("matchId"), request: "StartMatchRequest", requestRequired: false, response: objectRef("match", "Match") }),
      },
      "/api/v1/matches/{matchId}/judge/acquire": {
        post: operation({ operationId: "acquireJudge", summary: "Acquire judge slot", tag: "Judge", mutation: true, parameters: pathParameters("matchId"), response: objectRef("judgeSession", "JudgeSession") }),
      },
      "/api/v1/matches/{matchId}/judge/heartbeat": {
        post: operation({ operationId: "heartbeatJudge", summary: "Refresh judge slot", tag: "Judge", mutation: true, parameters: pathParameters("matchId"), response: objectRef("judgeSession", "JudgeSession") }),
      },
      "/api/v1/matches/{matchId}/judge/release": {
        post: operation({ operationId: "releaseJudge", summary: "Release judge slot", tag: "Judge", mutation: true, parameters: pathParameters("matchId"), response: ref("Ok") }),
      },
      "/api/v1/matches/{matchId}/judge/setup": {
        post: operation({ operationId: "setupJudge", summary: "Configure judge view and first server", tag: "Judge", mutation: true, parameters: pathParameters("matchId"), request: "JudgeSetupRequest", requestRequired: false, response: objectRef("match", "Match") }),
      },
      "/api/v1/matches/{matchId}/points": {
        post: operation({ operationId: "awardPoint", summary: "Award point", tag: "Judge", mutation: true, parameters: pathParameters("matchId"), request: "AwardPointRequest", response: objectRef("match", "Match"), idempotency: true }),
      },
      "/api/v1/matches/{matchId}/undo": {
        post: operation({ operationId: "undoPoint", summary: "Undo last point", tag: "Judge", mutation: true, parameters: pathParameters("matchId"), request: "MatchVersionRequest", response: objectRef("match", "Match"), idempotency: true }),
      },
      "/api/v1/matches/{matchId}/confirm-finish": {
        post: operation({ operationId: "confirmMatchFinish", summary: "Confirm pending result", tag: "Judge", mutation: true, parameters: pathParameters("matchId"), response: objectRef("match", "Match") }),
      },
      "/api/v1/matches/{matchId}/revert-finish": {
        post: operation({ operationId: "revertMatchFinish", summary: "Return pending result to scoring", tag: "Judge", mutation: true, parameters: pathParameters("matchId"), response: objectRef("match", "Match") }),
      },
      "/api/v1/matches/{matchId}/stop": {
        post: operation({ operationId: "stopMatch", summary: "Stop match with winner and reason", tag: "Matches", mutation: true, parameters: pathParameters("matchId"), request: "StopMatchRequest", response: objectRef("match", "Match") }),
      },
      "/api/v1/matches/{matchId}/cancel": {
        post: operation({ operationId: "cancelMatch", summary: "Cancel active standalone match", tag: "Matches", mutation: true, parameters: pathParameters("matchId"), request: "CancelMatchRequest", response: objectRef("match", "Match"), idempotency: true }),
      },
      "/api/v1/matches/{matchId}/void": {
        post: operation({ operationId: "voidMatch", summary: "Void terminal standalone result", tag: "Matches", mutation: true, parameters: pathParameters("matchId"), request: "CancelMatchRequest", response: objectRef("match", "Match"), idempotency: true }),
      },
      "/api/v1/users/directory": {
        get: operation({ operationId: "listUserDirectory", summary: "List active users for pickers", tag: "Users", parameters: [queryParameter("q")], response: arrayRef("users", "DirectoryUser") }),
      },
      "/api/v1/rankings": {
        get: operation({ operationId: "getRankings", summary: "Get global or current-team rankings", tag: "Rankings", parameters: [queryParameter("period", { type: "string", enum: ["all_time", "week", "month", "calendar_week", "calendar_month"] }), queryParameter("scope", { type: "string", enum: ["all_time", "week", "month", "calendar_week", "calendar_month"] }), queryParameter("teamId", { type: "string", format: "uuid" })], response: ref("RankingResponse") }),
      },
      "/api/v1/home": {
        get: operation({ operationId: "getHome", summary: "Get home dashboard", tag: "Home", parameters: [queryParameter("period", { type: "string", enum: ["all_time", "month"] })], response: ref("HomeDashboard") }),
      },
      "/api/v1/tournaments": {
        get: operation({ operationId: "listTournaments", summary: "List visible tournaments", tag: "Tournaments", response: arrayRef("tournaments", "Tournament") }),
        post: operation({ operationId: "createTournament", summary: "Create tournament", tag: "Tournaments", mutation: true, request: "CreateTournamentRequest", response: objectRef("tournament", "Tournament") }),
      },
      "/api/v1/tournaments/{id}": {
        get: operation({ operationId: "getTournament", summary: "Get visible tournament", tag: "Tournaments", parameters: pathParameters("id"), response: objectRef("tournament", "Tournament") }),
        patch: operation({ operationId: "updateTournament", summary: "Update collecting tournament", tag: "Tournaments", mutation: true, parameters: pathParameters("id"), request: "TournamentPatchRequest", response: objectRef("tournament", "Tournament") }),
      },
      "/api/v1/tournaments/{id}/participants": {
        post: operation({ operationId: "addTournamentParticipant", summary: "Add tournament participant", tag: "Tournaments", mutation: true, parameters: pathParameters("id"), request: "TournamentParticipantRequest", response: objectRef("participant", "Participant") }),
      },
      "/api/v1/tournaments/{id}/participants/{participantId}": {
        delete: operation({ operationId: "removeTournamentParticipant", summary: "Remove tournament participant", tag: "Tournaments", mutation: true, parameters: pathParameters("id", "participantId"), response: ref("Ok") }),
      },
      "/api/v1/tournaments/{id}/invitations": {
        post: operation({ operationId: "inviteTournamentParticipant", summary: "Invite user to tournament", tag: "Tournaments", mutation: true, parameters: pathParameters("id"), request: "UserIdRequest", response: objectRef("invitation", "Invitation") }),
      },
      "/api/v1/tournaments/{id}/invitations/{invitationId}": {
        delete: operation({ operationId: "cancelTournamentInvitation", summary: "Cancel tournament invitation", tag: "Tournaments", mutation: true, parameters: pathParameters("id", "invitationId"), response: ref("Ok") }),
      },
      "/api/v1/tournament-invitations/{id}/respond": {
        post: operation({ operationId: "respondTournamentInvitation", summary: "Accept or decline tournament invitation", tag: "Tournaments", mutation: true, parameters: pathParameters("id"), request: "InvitationResponseRequest", response: ref("GenericObject") }),
      },
      "/api/v1/tournaments/{id}/bracket": {
        post: operation({ operationId: "generateTournamentBracket", summary: "Generate or regenerate bracket", tag: "Tournaments", mutation: true, parameters: pathParameters("id"), request: "BracketGenerateRequest", requestRequired: false, response: ref("GenericObject") }),
        patch: operation({ operationId: "patchTournamentBracket", summary: "Swap editable bracket slots", tag: "Tournaments", mutation: true, parameters: pathParameters("id"), request: "BracketPatchRequest", response: ref("GenericObject") }),
      },
      "/api/v1/tournaments/{id}/dissolve-bracket": {
        post: operation({ operationId: "dissolveTournamentBracket", summary: "Dissolve bracket draft", tag: "Tournaments", mutation: true, parameters: pathParameters("id"), response: objectRef("tournament", "Tournament") }),
      },
      "/api/v1/tournaments/{id}/withdraw": {
        post: operation({ operationId: "withdrawFromTournament", summary: "Withdraw current participant", tag: "Tournaments", mutation: true, parameters: pathParameters("id"), response: objectRef("tournament", "Tournament") }),
      },
      "/api/v1/tournaments/{id}/cancel": {
        post: operation({ operationId: "cancelTournament", summary: "Cancel tournament", tag: "Tournaments", mutation: true, parameters: pathParameters("id"), response: objectRef("tournament", "Tournament") }),
      },
      "/api/v1/tournaments/{id}/start": {
        post: operation({ operationId: "startTournament", summary: "Start tournament", tag: "Tournaments", mutation: true, parameters: pathParameters("id"), response: objectRef("tournament", "Tournament") }),
      },
      "/api/v1/tournaments/{id}/stop": {
        post: operation({ operationId: "stopTournament", summary: "Stop tournament", tag: "Tournaments", mutation: true, parameters: pathParameters("id"), request: "TournamentStopRequest", requestRequired: false, response: objectRef("tournament", "Tournament") }),
      },
      "/api/v1/teams": {
        get: operation({ operationId: "listTeams", summary: "List own teams", tag: "Teams", response: arrayRef("teams", "Team") }),
        post: operation({ operationId: "createTeam", summary: "Create team", tag: "Teams", mutation: true, request: "CreateTeamRequest", response: objectRef("team", "Team") }),
      },
      "/api/v1/teams/{id}/invite": {
        post: operation({ operationId: "inviteTeamMember", summary: "Invite user to team", tag: "Teams", mutation: true, parameters: pathParameters("id"), request: "UserIdRequest", response: objectRef("invitation", "Invitation") }),
      },
      "/api/v1/team-invitations/{id}/respond": {
        post: operation({ operationId: "respondTeamInvitation", summary: "Accept or decline team invitation", tag: "Teams", mutation: true, parameters: pathParameters("id"), request: "InvitationResponseRequest", response: ref("GenericObject") }),
      },
      "/api/v1/notifications": {
        get: operation({ operationId: "listNotifications", summary: "List own notifications", tag: "Notifications", response: arrayRef("notifications", "Notification") }),
      },
      "/api/v1/notifications/{id}/read": {
        post: operation({ operationId: "markNotificationRead", summary: "Mark notification read", tag: "Notifications", mutation: true, parameters: pathParameters("id"), response: ref("Ok") }),
      },
      "/api/v1/notifications/read-visible": {
        post: operation({
          operationId: "markVisibleNotificationsRead",
          summary: "Mark the visible notification selection read",
          tag: "Notifications",
          mutation: true,
          request: "NotificationReadVisibleRequest",
          response: {
            type: "object",
            required: ["updated", "notifications"],
            properties: {
              updated: { type: "integer", minimum: 0 },
              notifications: {
                type: "array",
                items: {
                  type: "object",
                  required: ["id", "readAt"],
                  properties: {
                    id: { type: "string" },
                    readAt: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
        }),
      },
      "/api/v1/faq": {
        get: operation({ operationId: "listFaq", summary: "List FAQ articles", tag: "Help", response: { type: "object", required: ["articles"], properties: { articles: { type: "array", items: ref("GenericObject") } } } }),
      },
      "/api/v1/feedback": {
        post: operation({ operationId: "submitFeedback", summary: "Submit feedback", tag: "Help", mutation: true, request: "FeedbackRequest", response: { type: "object", required: ["feedback"], properties: { feedback: ref("GenericObject") } } }),
      },
    },
  };
}
