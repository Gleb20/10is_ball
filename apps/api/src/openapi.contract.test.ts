import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { buildApp } from "./app.js";
import { createMigratedPgliteDb } from "./db/client.js";
import { openApiSpec } from "./openapi.js";

type OpenApiOperation = {
  operationId?: string;
  parameters?: Array<{
    in?: string;
    name?: string;
    required?: boolean;
    schema?: unknown;
  }>;
  requestBody?: { content?: Record<string, { schema?: unknown }> };
  responses?: Record<
    string,
    { content?: Record<string, { schema?: Record<string, unknown> }> }
  >;
  security?: Array<Record<string, string[]>>;
};

type OpenApiDocument = {
  info: { version: string };
  paths: Record<string, Partial<Record<string, OpenApiOperation>>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
};

type ObjectSchema = {
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<
    string,
    { type?: string; enum?: unknown[]; format?: string }
  >;
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
const PUBLIC_OPERATIONS = new Set([
  "GET /health",
  "GET /ready",
  "GET /api/v1/openapi.json",
  "POST /api/v1/auth/login",
]);
const BODY_OPERATIONS = new Set([
  "POST /api/v1/auth/login",
  "POST /api/v1/auth/password/first-change",
  "POST /api/v1/auth/password/change",
  "POST /api/v1/admin/users",
  "PATCH /api/v1/admin/users/{userId}",
  "POST /api/v1/admin/matches/{matchId}/force-close",
  "POST /api/v1/admin/matches/{matchId}/recovery/force-close",
  "PATCH /api/v1/me/profile",
  "PATCH /api/v1/profile/me",
  "PATCH /api/v1/me/onboarding",
  "POST /api/v1/guests",
  "PATCH /api/v1/guests/{guestId}",
  "POST /api/v1/matches",
  "POST /api/v1/matches/launches",
  "PATCH /api/v1/matches/{matchId}",
  "POST /api/v1/matches/{matchId}/invitations",
  "POST /api/v1/matches/{matchId}/start",
  "POST /api/v1/matches/{matchId}/judge/handover",
  "POST /api/v1/matches/{matchId}/manual-correction",
  "POST /api/v1/matches/{matchId}/no-show",
  "POST /api/v1/matches/{matchId}/judge/setup",
  "POST /api/v1/matches/{matchId}/points",
  "POST /api/v1/matches/{matchId}/undo",
  "POST /api/v1/matches/{matchId}/stop",
  "POST /api/v1/matches/{matchId}/cancel",
  "POST /api/v1/matches/{matchId}/void",
  "POST /api/v1/tournaments",
  "PATCH /api/v1/tournaments/{id}",
  "POST /api/v1/tournaments/{id}/participants",
  "POST /api/v1/tournaments/{id}/invitations",
  "POST /api/v1/tournament-invitations/{id}/respond",
  "POST /api/v1/tournaments/{id}/bracket",
  "POST /api/v1/tournaments/{id}/bracket-generations",
  "PATCH /api/v1/tournaments/{id}/bracket",
  "POST /api/v1/tournaments/{id}/stop",
  "POST /api/v1/teams",
  "POST /api/v1/teams/{id}/invite",
  "PATCH /api/v1/teams/{id}",
  "POST /api/v1/teams/{id}/invitations",
  "POST /api/v1/teams/{id}/captain-transfer",
  "POST /api/v1/team-invitations/{id}/respond",
  "POST /api/v1/notifications/read-visible",
  "POST /api/v1/feedback",
]);
const IDEMPOTENT_OPERATIONS = new Set([
  "POST /api/v1/admin/matches/{matchId}/force-close",
  "POST /api/v1/admin/matches/{matchId}/recovery/force-close",
  "POST /api/v1/matches/launches",
  "POST /api/v1/guests",
  "PATCH /api/v1/guests/{guestId}",
  "POST /api/v1/matches/{matchId}/points",
  "POST /api/v1/matches/{matchId}/undo",
  "POST /api/v1/matches/{matchId}/cancel",
  "POST /api/v1/matches/{matchId}/void",
]);

function normalizeRoute(route: string): string {
  return route.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function registeredOperations(): string[] {
  const source = readFileSync(path.resolve(import.meta.dirname, "app.ts"), "utf8");
  return [
    ...new Set(
      [...source.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gms)].map(
        (match) => `${match[1]!.toUpperCase()} ${normalizeRoute(match[2]!)}`,
      ),
    ),
  ].sort();
}

function documentedOperations(spec: OpenApiDocument) {
  return Object.entries(spec.paths)
    .flatMap(([route, pathItem]) =>
      HTTP_METHODS.flatMap((method) => {
        const operation = pathItem[method];
        return operation
          ? [{ key: `${method.toUpperCase()} ${route}`, method, route, operation }]
          : [];
      }),
    )
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
}

function expectRuntimeObjectToMatchSchema(
  payload: Record<string, unknown>,
  schema: ObjectSchema,
) {
  for (const key of schema.required ?? []) {
    expect(payload, `required runtime property ${key}`).toHaveProperty(key);
  }
  if (schema.additionalProperties === false) {
    expect(Object.keys(payload).sort()).toEqual(
      Object.keys(schema.properties ?? {}).filter((key) => payload[key] !== undefined).sort(),
    );
  }
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    const value = payload[key];
    if (value === undefined) continue;
    if (property.type) expect(typeof value, `${key} runtime type`).toBe(property.type);
    if (property.enum) expect(property.enum, `${key} documented enum`).toContain(value);
    if (property.format === "uuid") {
      expect(value, `${key} UUID format`).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
  }
}

describe("AT-OPS-API-001 runtime OpenAPI contract", () => {
  const spec = openApiSpec() as OpenApiDocument;
  const operations = documentedOperations(spec);

  it("covers every directly registered public operation exactly once", () => {
    expect(operations.map(({ key }) => key)).toEqual(registeredOperations());
    const operationIds = operations.map(({ operation }) => operation.operationId);
    expect(operationIds.every((operationId) => typeof operationId === "string" && operationId.length > 0)).toBe(true);
    expect(new Set(operationIds).size).toBe(operations.length);
  });

  it("uses the current repository release version", () => {
    const packageJson = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, "../../../package.json"), "utf8"),
    ) as { version: string };
    expect(spec.info.version).toBe(packageJson.version);
  });

  it("documents auth, CSRF, route parameters, request bodies and response schemas", () => {
    expect(spec.components?.securitySchemes).toMatchObject({
      sessionCookie: { type: "apiKey", in: "cookie" },
      csrfHeader: { type: "apiKey", in: "header" },
    });
    expect(spec.components?.schemas).toHaveProperty("ApiError");

    for (const { key, method, route, operation } of operations) {
      const security = operation.security ?? [];
      if (PUBLIC_OPERATIONS.has(key)) {
        expect(security, `${key} must be explicitly public`).toEqual([]);
      } else {
        expect(security[0], `${key} must require the session cookie`).toMatchObject({
          sessionCookie: [],
        });
        if (["post", "put", "patch", "delete"].includes(method)) {
          expect(security[0], `${key} must document CSRF`).toMatchObject({
            csrfHeader: [],
          });
        }
      }

      const routeParameterNames = [...route.matchAll(/\{([^}]+)\}/g)].map(
        (match) => match[1],
      );
      const documentedParameterNames = (operation.parameters ?? [])
        .filter((parameter) => parameter.in === "path" && parameter.required)
        .map((parameter) => parameter.name);
      expect(documentedParameterNames, `${key} path parameters`).toEqual(
        routeParameterNames,
      );

      if (BODY_OPERATIONS.has(key)) {
        expect(
          operation.requestBody?.content?.["application/json"]?.schema,
          `${key} request body schema`,
        ).toBeTruthy();
      }

      if (IDEMPOTENT_OPERATIONS.has(key)) {
        expect(operation.parameters, `${key} idempotency header`).toContainEqual(
          expect.objectContaining({
            name: "Idempotency-Key",
            in: "header",
            required: true,
          }),
        );
      }

      const responses = operation.responses ?? {};
      const success = Object.entries(responses).find(([status]) => /^2\d\d$/.test(status));
      expect(success?.[1].content?.["application/json"]?.schema, `${key} success schema`).toBeTruthy();
      expect(responses).toHaveProperty("500");
      if (!PUBLIC_OPERATIONS.has(key)) {
        expect(responses).toHaveProperty("401");
        expect(responses).toHaveProperty("403");
      }
      if (["post", "put", "patch", "delete"].includes(method)) {
        expect(responses).toHaveProperty("400");
      }
      for (const [status, response] of Object.entries(responses)) {
        if (/^[45]\d\d$/.test(status)) {
          const expectedSchema = key.includes(
            "/api/v1/admin/matches/{matchId}/recovery",
          )
            ? "#/components/schemas/AdminMatchRecoveryError"
            : key ===
              "POST /api/v1/admin/users/{userId}/reset-password" &&
            status === "409"
              ? "#/components/schemas/AdminPasswordResetPostConflict"
              : "#/components/schemas/ApiError";
          expect(
            response.content?.["application/json"]?.schema?.$ref,
            `${key} ${status} error`,
          ).toBe(expectedSchema);
        }
      }
    }
  });

  it("documents both runtime reset-password 409 response shapes", async () => {
    const context = await createMigratedPgliteDb();
    const built = await buildApp({
      db: context.db,
      clock: new FakeClock(new Date("2026-10-03T12:00:00.000Z")),
    });
    const requestA = "00000000-0000-4000-8000-0000000000a1";
    const requestB = "00000000-0000-4000-8000-0000000000b2";

    try {
      await built.services.auth.seedAdmin("admin@openapi-reset.test", "AdminPass1!");
      const login = await built.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "admin@openapi-reset.test", password: "AdminPass1!" },
      });
      const adminCookie = login.cookies.find(
        (cookie) => cookie.name === "tab10_session",
      )!.value;
      const created = await built.app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        cookies: { tab10_session: adminCookie },
        payload: {
          email: "target@openapi-reset.test",
          firstName: "OpenAPI",
          lastName: "Target",
        },
      });
      const targetUserId = created.json().user.id as string;
      const reset = (requestId: string, expectedLastAppliedRequestId: string | null) =>
        built.app.inject({
          method: "POST",
          url: `/api/v1/admin/users/${targetUserId}/reset-password`,
          cookies: { tab10_session: adminCookie },
          headers: { "idempotency-key": requestId },
          payload: { expectedLastAppliedRequestId },
        });

      expect((await reset(requestA, null)).statusCode).toBe(200);
      const stateConflict = await reset(requestB, null);
      const reusedRequestId = await reset(requestA, requestB);
      expect(stateConflict.statusCode).toBe(409);
      expect(reusedRequestId.statusCode).toBe(409);

      const responseSchema = spec.paths[
        "/api/v1/admin/users/{userId}/reset-password"
      ]?.post?.responses?.["409"]?.content?.["application/json"]?.schema;
      expect(responseSchema).toEqual({
        $ref: "#/components/schemas/AdminPasswordResetPostConflict",
      });
      expect(spec.components?.schemas?.AdminPasswordResetPostConflict).toEqual({
        oneOf: [
          { $ref: "#/components/schemas/AdminPasswordResetConflict" },
          { $ref: "#/components/schemas/AdminPasswordResetIdempotencyConflict" },
        ],
      });

      const runtimeConflicts = [
        [stateConflict.json(), "AdminPasswordResetConflict"],
        [reusedRequestId.json(), "AdminPasswordResetIdempotencyConflict"],
      ] as const;
      for (const [payload, schemaName] of runtimeConflicts) {
        expectRuntimeObjectToMatchSchema(
          payload as Record<string, unknown>,
          spec.components?.schemas?.[schemaName] as ObjectSchema,
        );
      }
    } finally {
      await built.app.close();
      await context.close();
    }
  });

  it("keeps Wave B history, ranking, and nested profile DTOs distinct", () => {
    const successSchema = (route: string) =>
      spec.paths[route]?.get?.responses?.["200"]?.content?.["application/json"]
        ?.schema;

    expect(successSchema("/api/v1/history")).toEqual({
      $ref: "#/components/schemas/HistoryFeed",
    });
    expect(spec.components?.schemas?.HistoryItem).toMatchObject({
      required: expect.arrayContaining(["sideA", "sideB"]),
      properties: {
        sideA: { type: "string", nullable: true },
        sideB: { type: "string", nullable: true },
      },
    });
    expect(successSchema("/api/v1/rankings")).toEqual({
      $ref: "#/components/schemas/RankingResponse",
    });
    expect(successSchema("/api/v1/players/{userId}")).toMatchObject({
      type: "object",
      required: ["profile"],
      properties: {
        profile: { $ref: "#/components/schemas/PlayerProfile" },
      },
    });
    expect(spec.components?.schemas).not.toHaveProperty("PublicPlayer");
    expect(spec.components?.schemas?.RankingResponse).toMatchObject({
      properties: {
        scope: { enum: ["all_time", "week", "month"] },
        rankings: {
          type: "array",
          items: { $ref: "#/components/schemas/Ranking" },
        },
      },
    });

    expect(
      spec.paths["/api/v1/profile/me"]?.patch?.requestBody?.content?.[
        "application/json"
      ]?.schema,
    ).toEqual({ $ref: "#/components/schemas/ProfileLocalUpdateRequest" });
    expect(
      spec.paths["/api/v1/me/profile"]?.patch?.requestBody?.content?.[
        "application/json"
      ]?.schema,
    ).toEqual({ $ref: "#/components/schemas/ProfileUpdateRequest" });
  });
});

describe("GAP-005 match/judge extension contracts", () => {
  it("BUG-029/039 documents the complete match outcome read contract", () => {
    const document = openApiSpec() as OpenApiDocument;
    expect(document.paths["/api/v1/matches/{matchId}"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema).toEqual({
      type: "object",
      required: ["match"],
      properties: { match: { $ref: "#/components/schemas/MatchDetail" } },
    });
    expect(document.components?.schemas?.MatchDetail).toMatchObject({
      allOf: [
        { $ref: "#/components/schemas/Match" },
        {
          required: ["matchFacts"],
          properties: { matchFacts: { $ref: "#/components/schemas/MatchFacts" } },
        },
      ],
    });
    expect(document.components?.schemas?.MatchFacts).toMatchObject({
      required: ["initialServer", "playingClock", "judgeHistory"],
      additionalProperties: false,
      properties: {
        judgeHistory: {
          properties: {
            sessions: {
              items: {
                additionalProperties: false,
                properties: {
                  id: { format: "uuid" },
                  userId: { format: "uuid" },
                  startedAt: { format: "date-time" },
                  endedAt: { format: "date-time", nullable: true },
                },
              },
            },
          },
        },
      },
    });
    expect(document.components?.schemas?.Match).toMatchObject({
      required: expect.arrayContaining(["version", "idempotencyKeys"]),
      properties: {
        version: { type: "integer", minimum: 0, description: expect.stringContaining("expectedVersion") },
        idempotencyKeys: {
          type: "array",
          items: { type: "string" },
          description: expect.stringContaining("untruncated"),
        },
      },
    });
    expect(document.components?.schemas?.Match).not.toHaveProperty("properties.idempotencyKeys.maxItems");
    const matchSchema = document.components?.schemas?.Match as {
      properties: { version: { description: string }; idempotencyKeys: { description: string } };
    };
    expect(matchSchema.properties.version.description).toContain("nondecreasing");
    expect(matchSchema.properties.version.description).toContain("point-in-time");
    expect(matchSchema.properties.version.description).toContain("HTTP responses may arrive out of order");
    expect(matchSchema.properties.idempotencyKeys.description).toContain("absence alone does not prove no write");
  });

  it("documents options, reservation and versioned correction/no-show", () => {
    const document = openApiSpec() as OpenApiDocument;
    expect(document.paths["/api/v1/matches/create-options"]?.get).toBeDefined();
    expect(document.paths["/api/v1/matches/{matchId}/judge/handover"]?.post?.requestBody).toBeDefined();
    for (const action of ["manual-correction", "no-show"]) {
      const operation = document.paths[`/api/v1/matches/{matchId}/${action}`]?.post;
      expect(operation?.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ in: "header", name: "Idempotency-Key", required: true })]));
    }
    expect(document.components?.schemas?.CreateMatchRequest).toMatchObject({ properties: { firstServerMethod: { enum: ["random", "manual", "rally"] } } });
    expect(document.components?.schemas?.Match).toMatchObject({ properties: { judgeReservation: { nullable: true } } });
  });
});

describe("GAP-007 team contracts", () => {
  it("documents lifecycle, metadata limits and invitation welcome response", () => {
    const spec = openApiSpec() as OpenApiDocument;
    expect(spec.components?.schemas?.CreateTeamRequest).toMatchObject({ additionalProperties: false, properties: { name: { minLength: 1, maxLength: 200 }, welcomeText: { maxLength: 2000 } } });
    expect(spec.components?.schemas?.UpdateTeamRequest).toMatchObject({ minProperties: 1, additionalProperties: false });
    for (const action of ["leave", "captain-transfer"]) expect(spec.paths[`/api/v1/teams/{id}/${action}`]?.post).toBeDefined();
    expect(spec.paths["/api/v1/teams/{id}/members/{userId}"]?.delete).toBeDefined();
    expect(spec.components?.schemas?.TeamInvitationResponse).toMatchObject({ required: ["status", "teamId"] });
  });
});

it("GAP-006 stop body documents the required bounded reason", () => {
  const spec = openApiSpec() as any;
  expect(spec.paths["/api/v1/tournaments/{id}/stop"].post.requestBody.required).toBe(true);
  expect(spec.components.schemas.TournamentStopRequest.required).toEqual(["code"]);
  expect(spec.components.schemas.TournamentStopRequest.properties.text.maxLength).toBe(500);
});

it("BUG-022 documents the organizer snapshot and strict versioned generation body", () => {
  const spec = openApiSpec() as any;
  expect(spec.paths["/api/v1/tournaments/{id}/bracket-generation-context"].get.responses[200].content["application/json"].schema).toMatchObject({
    required: ["tournament"],
    properties: { tournament: { $ref: "#/components/schemas/BracketGenerationTournament" } },
  });
  expect(spec.components.schemas.BracketGenerationTournament).toMatchObject({
    allOf: [
      { $ref: "#/components/schemas/Tournament" },
      {
        type: "object",
        required: ["bracketStateVersion"],
        properties: {
          bracketStateVersion: { type: "integer", minimum: 0 },
        },
      },
    ],
  });
  expect(spec.paths["/api/v1/tournaments/{id}/bracket-generations"].post.requestBody).toMatchObject({
    required: true,
    content: { "application/json": { schema: { $ref: "#/components/schemas/BracketGenerationRequest" } } },
  });
  expect(spec.components.schemas.BracketGenerationRequest).toEqual({
    type: "object",
    required: ["expectedVersion"],
    properties: {
      expectedVersion: { type: "integer", minimum: 0 },
      constructionAlgorithm: { type: "string", enum: ["compact", "power_of_two"] },
    },
    additionalProperties: false,
  });
});


it("GAP-010 admin edit and catalog expose bounded profile fields without email edits", () => {
  const spec = openApiSpec() as any;
  expect(spec.paths["/api/v1/admin/users"].get.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: "status", schema: { type: "string", enum: ["active", "blocked"] } })]));
  expect(spec.paths["/api/v1/admin/users/{userId}"].patch.requestBody.content["application/json"].schema.$ref).toBe("#/components/schemas/AdminUserUpdateRequest");
  expect(spec.components.schemas.AdminUserUpdateRequest).toMatchObject({ additionalProperties: false, minProperties: 1, properties: { firstName: { maxLength: 100 }, birthDate: { nullable: true }, organizationText: { maxLength: 200 } } });
  expect(spec.components.schemas.AdminUserUpdateRequest.properties.email).toBeUndefined();
  expect(spec.components.schemas.AdminUser.properties).toMatchObject({ lastLoginAt: { nullable: true, format: "date-time" }, createdAt: { format: "date-time" }, birthDate: { nullable: true } });
});

it("GAP-026 documents safe admin account detail and target-bound audit history", () => {
  const spec = openApiSpec() as any;
  expect(spec.paths["/api/v1/admin/users/{userId}"].get.responses[200].content["application/json"].schema).toMatchObject({
    required: ["user"],
    properties: { user: { $ref: "#/components/schemas/AdminUser" } },
  });
  const audit = spec.paths["/api/v1/admin/users/{userId}/audit"].get;
  expect(audit.parameters).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "userId", in: "path", required: true }),
    expect.objectContaining({ name: "cursor", in: "query", required: false }),
  ]));
  expect(audit.responses[200].content["application/json"].schema.$ref).toBe("#/components/schemas/AdminUserAuditFeed");
  expect(spec.components.schemas.AdminUserAuditItem).toMatchObject({
    additionalProperties: false,
    required: ["id", "createdAt", "actor", "action", "changedFields"],
  });
  expect(spec.components.schemas.AdminUserAuditItem.properties).not.toHaveProperty("meta");
  expect(spec.components.schemas.AdminUserAuditItem.properties).not.toHaveProperty("outcome");
});

it("GAP-028 documents only the exact-id admin recovery projection", () => {
  const spec = openApiSpec() as any;
  const recovery = spec.components.schemas.AdminMatchRecovery;
  expect(recovery).toMatchObject({
    additionalProperties: false,
    required: ["id", "kind", "status", "version", "allowedEmergencyAction"],
    properties: {
      id: { type: "string", format: "uuid" },
      kind: { enum: ["standalone", "tournament", "tutorial"] },
      status: {
        enum: [
          "waiting",
          "in_progress",
          "pending_confirmation",
          "finished",
          "stopped",
          "cancelled",
          "voided",
        ],
      },
      allowedEmergencyAction: { enum: ["force_close", null] },
    },
  });
  expect(spec.components.schemas.AdminMatchRecoveryError.properties.code.enum)
    .toEqual(expect.arrayContaining([
      "CSRF_INVALID",
      "FORBIDDEN",
      "PASSWORD_CHANGE_REQUIRED",
      "UNAUTHORIZED",
    ]));
  for (const path of [
    "/api/v1/admin/matches/{matchId}/recovery",
    "/api/v1/admin/matches/{matchId}/recovery/force-close",
  ]) {
    const operation = path.endsWith("force-close")
      ? spec.paths[path].post
      : spec.paths[path].get;
    expect(operation.responses[200].headers["Cache-Control"]).toBeDefined();
    expect(operation.responses[200].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/AdminMatchRecoveryResponse",
    );
    for (const response of Object.values(operation.responses) as any[]) {
      if (!response.content || response.description === "Success") continue;
      expect(response.content["application/json"].schema.$ref).toBe(
        "#/components/schemas/AdminMatchRecoveryError",
      );
    }
  }
});

it("GAP-008 documents consent, prestart editing and immutable invitation response", () => {
  const spec = openApiSpec() as any;
  expect(spec.paths["/api/v1/matches/{matchId}"].patch.requestBody.content["application/json"].schema.$ref).toBe("#/components/schemas/UpdateMatchRequest");
  for (const action of ["accept", "decline"]) expect(spec.paths[`/api/v1/match-invitations/{id}/${action}`].post.responses[200]).toBeDefined();
  expect(spec.components.schemas.MatchInvitationRequest.properties.kind.enum).toEqual(["player", "judge"]);
  expect(spec.components.schemas.CreateMatchRequest.properties.judgeUserId.format).toBe("uuid");
  expect(spec.components.schemas.Match.properties.invitations.items.$ref).toBe("#/components/schemas/MatchInvitation");
});

it("GAP-025 documents the nullable bounded team avatar preset", () => {
  const spec = openApiSpec() as any;
  const expected = {
    type: "string",
    enum: Array.from({ length: 10 }, (_, index) => `avatar_${index + 1}`),
    nullable: true,
  };
  expect(spec.components.schemas.Team.required).toContain("avatarKey");
  expect(spec.components.schemas.Team.properties.avatarKey).toEqual(expected);
  expect(spec.components.schemas.CreateTeamRequest.properties.avatarKey).toEqual(expected);
  expect(spec.components.schemas.UpdateTeamRequest.properties.avatarKey).toEqual(expected);
  expect(spec.components.schemas.CreateTeamRequest.additionalProperties).toBe(false);
  expect(spec.components.schemas.UpdateTeamRequest.additionalProperties).toBe(false);
});
