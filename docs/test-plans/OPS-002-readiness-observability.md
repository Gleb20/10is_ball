# OPS-002 — Readiness and observability

- Scope: public DB-backed `/ready`, independent `/health`, `X-Request-Id`,
  structured completion/error signals and safe redaction.
- Non-goals: production dashboards/alerts, retention policy, deployment or
  external service mutation.
- Red: `/ready` returned 404 and `/health` had no request ID.
- Green: deterministic PGlite tests cover readiness success/failure, fixed IDs,
  correlated 4xx/5xx logs and canaries in query/header/body/error values.
- Verification: focused OPS/OpenAPI/Home 7/7; strict route inventory 64/64
  operations and 58/58 paths; combined Node 24 CI passed docs/routes/secret/ops
  audits, lint/typecheck, shared 522, test-utils 4, web 124, API 150 + 7 guarded
  PostgreSQL skips, and API/web builds. Production rollout remains approval-gated.
