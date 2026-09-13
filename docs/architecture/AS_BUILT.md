# Архитектура as-built

Снимок кода на **2026-09-13**. Целевые требования находятся в
[`../requirements/`](../requirements/); этот документ описывает то, что существует,
включая известные ограничения.

## Контекст выполнения

```text
Browser
  └─ React 19 + Vite SPA (apps/web)
       └─ REST/JSON /api/v1 + cookie/CSRF
            └─ Fastify modular monolith (apps/api)
                 ├─ AuthService
                 ├─ MatchService
                 ├─ TournamentService
                 ├─ TeamService
                 └─ NotificationService / HelpService
                      └─ Drizzle → PostgreSQL 16.15 (local/CI/staging/production)

PGlite                  explicit reduced-fidelity dev/test lane only

packages/shared     pure match/ranking/bracket/password/avatar domain helpers
packages/test-utils clock and DB test utilities
packages/ic-kit     vendored built UI kit
```

## Репозиторий

| Путь | Фактическая ответственность |
|---|---|
| [`../../apps/web/src/App.tsx`](../../apps/web/src/App.tsx) | SPA routes и auth guard |
| [`../../apps/web/src/api.ts`](../../apps/web/src/api.ts) | HTTP/CSRF client |
| [`../../apps/web/src/pages/`](../../apps/web/src/pages/) | page-level UI; большая часть state/fetch находится прямо в страницах |
| [`../../apps/api/src/app.ts`](../../apps/api/src/app.ts) | Fastify setup, auth/CSRF hooks и все HTTP routes в одном файле |
| [`../../apps/api/src/modules/`](../../apps/api/src/modules/) | application/domain services по auth, match, tournament, team, notification/help |
| [`../../apps/api/src/db/schema.ts`](../../apps/api/src/db/schema.ts) | Drizzle mapping фактических таблиц |
| [`../../apps/api/src/db/client.ts`](../../apps/api/src/db/client.ts) | DB adapters без boot-time DDL |
| [`../../apps/api/src/db/migrations.ts`](../../apps/api/src/db/migrations.ts) | immutable ledger, catalog/adoption checks и startup prefix policy |
| [`../../apps/api/src/bootstrap-admin.ts`](../../apps/api/src/bootstrap-admin.ts) | fail-closed explicit admin bootstrap после audit foundation |
| [`../../packages/shared/src/`](../../packages/shared/src/) | pure domain engines, включая bracket V1/V2 |
| [`../../render.yaml`](../../render.yaml) | Render API blueprint |
| [`../../apps/web/vercel.json`](../../apps/web/vercel.json) | Vercel build/rewrites/SPA fallback |
| [`../../.github/workflows/ci.yml`](../../.github/workflows/ci.yml) | quality/PostgreSQL/browser lanes и обязательный `release-gate` |
| [`../../.github/workflows/release.yml`](../../.github/workflows/release.yml) | bounded read-only exact-SHA public-stand monitor |

## Request/auth flow

1. Web обращается к относительному `/api`; в production Vercel переписывает его на
   Render.
2. Login устанавливает `tab10_session` (HttpOnly) и `tab10_csrf` cookie, а также
   возвращает CSRF token.
3. Fastify `onRequest` разрешает session token через `AuthService`.
4. Большинство routes используют `requireAuth`; admin routes — `requireAdmin`.
5. Вне `NODE_ENV=test` state-changing requests требуют равенства CSRF cookie и
   `x-csrf-token`.
6. Core match payloads проходят shared Zod runtime validation; services
   independently enforce actor/ownership and visibility.
7. Services читают/изменяют Drizzle tables. Нет Redis, WebSocket или background
   worker; scoring UI держит только in-memory FIFO intents.

Delivery foundation добавляет fail-closed/atomic/audited bootstrap config до
подключения к DB, production DB guard, отдельный destructive-consent-protected
`TEST_DATABASE_URL` и release identity. `/health` и `/ready` публикуют одну
`ReleaseMetadata`; web artifact содержит тот же объект в `/release.json`.

Temporary-password gate uses exact method+matched-path allowlist. Active event
visibility and P0 match/tournament ownership checks are server-side.

## Match/tournament coupling

`MatchService` хранит snapshot счёта и JSON event log в строке match. Terminal
result CAS, stats, judge release and `TournamentService` advancement execute in
one transaction; tournament row locking plus bracket version CAS serialize
parallel advancement and a partial unique index prevents duplicate actual rows.
Void uses the same transactional compensation boundary and immutable ledger.
D33 preserves bracket JSON/version, downstream matches/results/stats and
notifications for tournament corrections.

Новая генерация bracket использует schemaVersion 2. Legacy V1 JSON остаётся
read/playable по текущему коду/ADR, но для V1 DE известен hang risk (`DATA-006`).

## Web routes

Authenticated shell: `/`, `/history`, `/start`, `/admin`, `/matches`,
`/matches/new`, `/matches/:id`, `/rankings`, `/tournaments`,
`/tournaments/:id`, `/teams`, `/profile`, `/help`, `/onboarding`,
`/notifications`. Judge route `/matches/:id/judge` immersive. Вне shell:
`/login`, `/first-password`; `*` показывает Not Found.

Wave A добавляет centralized runtime-401 recovery с сохранением безопасного
внутреннего return path и незавершённого draft, bounded initial cold-start state,
persisted onboarding, полный Home dashboard, notification lifecycle, guarded
form submissions и общий visible-only refresh primitive. JudgePage сохраняет
отдельный ownership heartbeat, сериализованную score queue и D33 terminal/void
read-only behavior.

## Delivery boundary

- `pnpm dev` поднимает закреплённый PostgreSQL 16.15 и запускает явную migration
  command до API/web; `pnpm dev:pglite` остаётся отдельным упрощённым режимом.
- API startup не изменяет persistent schema. Он требует точный известный migration
  prefix и допускает только более новые trailing migrations для rollback binary.
- PR и push точного merge SHA в `main` проходят одинаковые quality,
  PostgreSQL/migration и compiled-browser lanes. Только успешный агрегатор
  `release-gate` допускает release workflow.
- Render native Git integration ждёт CI checks, применяет migrations и запускает
  compiled API; Vercel публикует production branch `main`. Release workflow не
  мутирует providers и только ждёт exact SHA/version на стабильных origins.

## Ключевые границы и риски

- API и web — один deployable каждый; shared package компилируется отдельно.
- PGlite не покрывает полную семантику PostgreSQL; поэтому он не является
  release gate без обязательного PostgreSQL 16.15 lane.
- Home, active lists/details используют единый visible-only 30-second refresh;
  JudgePage сохраняет отдельный ownership heartbeat. Server push отсутствует.
- Runtime validation is explicit for P0 match mutations but remains incomplete
  across older non-P0 routes.
- `app.ts` объединяет routing, serialization и authorization, из-за чего легко
  пропустить actor/field filtering.
- Structured request logging и полноценная telemetry отсутствуют; `/ready`
  проверяет DB, но отдельные dependency/latency metrics ещё не реализованы.

Детали: [API as-built](API_AS_BUILT.md), [data model as-built](DATA_MODEL_AS_BUILT.md),
[deployment as-built](../operations/DEPLOYMENT_AS_BUILT.md).

## Wave B candidate services

ProfileService owns own/public DTO and aggregate statistics. HistoryService owns
a parameterized union/keyset feed across visible matches/tournaments; PostgreSQL
is a required acceptance lane. RankingService narrows MatchService ranking data
to active team membership. Existing auth, migration and D33 boundaries remain.
