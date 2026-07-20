# Decisions (ADR)

## D1 — Stack (2026-07-20)

**Decision:** TypeScript monorepo with pnpm workspaces; Fastify + Drizzle API; Vite + React 19 + ic-kit web; Vitest; Playwright later for E2E.

**Why:** Single language, ic-kit compatibility, strong TDD tooling.

## D2 — Test database without Docker (2026-07-20)

**Decision:** Use PGlite (`@electric-sql/pglite`) for local/CI integration tests when Docker is unavailable. Production/dev with Docker uses real PostgreSQL 16 via `docker-compose.yml` and `DATABASE_URL`.

**Why:** NFR forbids SQLite substitutes; PGlite is Postgres-compatible WASM. Document fidelity risk: rare PG features may differ — CI with real Postgres service is preferred when available.

## D3 — Open questions defaults

| ID | Decision (provisional) | Revisit |
|----|------------------------|---------|
| Q1 Third-place match | Always create for single-elim size ≥ 4 (shell only until match wiring) | Phase 6.5 |
| Q2 Team ranking | Sum of current members' all-time wins | Phase 5 |
| Q3 Double elimination | Simplified DE with losers bracket shell | Phase 6.8 |
| Q4 Stop reasons | Codes: `injury`, `time`, `other` (+ optional text) | Phase 3.6 |
| Q5 Default judge | Tournament organizer by default | Phase 6 |
| Q6 Cookie SameSite | `Lax` for MVP | Phase 9 |

## D4 — Product versioning & commits (2026-07-20)

**Decision:** Версия продукта `a.b.c` ([`VERSIONING.md`](VERSIONING.md)):

- **a** — новый флоу (экраны, сценарии, крупные модули)
- **b** — функционал в существующих экранах / переписывание под новую задачу
- **c** — баги, UX-полировка, мелкие правки
- Увеличение **a** или **b** сбрасывает цифры справа в 0 (1.1.1 + b → 1.2.0; + a → 2.0.0)

**Git:** каждый коммит — детальное тело по [`.cursor/rules/git-commits.mdc`](../.cursor/rules/git-commits.mdc).

**Current release:** 1.0.0
