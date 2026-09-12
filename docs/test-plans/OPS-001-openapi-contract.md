# OPS-001 — runtime OpenAPI contract test plan

## Scope

- Backlog: `OPS-001`.
- Requirement: `08_API_SPEC.md` section 14.
- Acceptance: `AT-OPS-API-001`.
- User-visible outcome: `/api/v1/openapi.json` describes every directly
  registered public operation in the current source, its session/CSRF boundary,
  path parameters, key JSON payload/result/error schemas and root release
  version.
- Non-goals: implementing target-only routes, renaming current routes, adding
  runtime validation to cast-based handlers, deployment, production mutation or
  product-version bump.

## Deterministic Red

Run under repository Node 24:

```bash
pnpm --filter @tab10/api test -- src/openapi.contract.test.ts
```

Before implementation all three checks failed: OpenAPI contained 16 of 62
registered operations, advertised `0.1.0` instead of root `1.10.1`, and had no
security schemes or reusable schemas.

## Green matrix

1. Exact set equality between literal Fastify registrations in `app.ts` and
   operations in `openapi.ts`; duplicate/missing `operationId` fails.
2. OpenAPI `info.version` equals the root `package.json` version.
3. Public routes explicitly use empty security; protected reads require the
   session cookie; protected mutations require session cookie and CSRF header.
4. Every `{parameter}` has one required path parameter; every current JSON-body
   route has an `application/json` request schema.
5. Every operation has a schema-bearing success response; every declared 4xx/5xx
   response uses the shared `ApiError` schema.
6. After the combined BUG-013 route merge, `pnpm audit:routes:strict` reports
   63/63 operations across 57/57 paths and no missing/unregistered
   entries; the committed inventory becomes the regression baseline.

## Broader gates

```bash
pnpm audit:docs
pnpm audit:routes
pnpm --filter @tab10/api typecheck
pnpm run ci
```

Production `/api/v1/openapi.json` remains out of scope until a separately
authorized release; its recorded `0.1.0` snapshot must not be rewritten.
