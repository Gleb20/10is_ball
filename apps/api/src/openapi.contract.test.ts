import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
  "PATCH /api/v1/me/profile",
  "PATCH /api/v1/profile/me",
  "PATCH /api/v1/me/onboarding",
  "POST /api/v1/matches",
  "POST /api/v1/matches/{matchId}/start",
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
  "PATCH /api/v1/tournaments/{id}/bracket",
  "POST /api/v1/tournaments/{id}/stop",
  "POST /api/v1/teams",
  "POST /api/v1/teams/{id}/invite",
  "POST /api/v1/team-invitations/{id}/respond",
  "POST /api/v1/notifications/read-visible",
  "POST /api/v1/feedback",
]);
const IDEMPOTENT_OPERATIONS = new Set([
  "POST /api/v1/admin/matches/{matchId}/force-close",
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
          expect(
            response.content?.["application/json"]?.schema?.$ref,
            `${key} ${status} error`,
          ).toBe("#/components/schemas/ApiError");
        }
      }
    }
  });

  it("keeps Wave B history, ranking, and nested profile DTOs distinct", () => {
    const successSchema = (route: string) =>
      spec.paths[route]?.get?.responses?.["200"]?.content?.["application/json"]
        ?.schema;

    expect(successSchema("/api/v1/history")).toEqual({
      $ref: "#/components/schemas/HistoryFeed",
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
