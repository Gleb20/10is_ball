# Архитектура as-built

Снимок кода на **2026-09-06**. Целевые требования находятся в
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
                      └─ Drizzle → PostgreSQL (production) / PGlite (local/tests)

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
| [`../../apps/api/src/db/client.ts`](../../apps/api/src/db/client.ts) | DB adapters и boot-time schema DDL |
| [`../../apps/api/src/bootstrap-admin.ts`](../../apps/api/src/bootstrap-admin.ts) | fail-closed explicit admin bootstrap после audit foundation |
| [`../../packages/shared/src/`](../../packages/shared/src/) | pure domain engines, включая bracket V1/V2 |
| [`../../render.yaml`](../../render.yaml) | Render API blueprint |
| [`../../apps/web/vercel.json`](../../apps/web/vercel.json) | Vercel build/rewrites/SPA fallback |

## Request/auth flow

1. Web обращается к относительному `/api`; в production Vercel переписывает его на
   Render.
2. Login устанавливает `tab10_session` (HttpOnly) и `tab10_csrf` cookie, а также
   возвращает CSRF token.
3. Fastify `onRequest` разрешает session token через `AuthService`.
4. Большинство routes используют `requireAuth`; admin routes — `requireAdmin`.
5. Вне `NODE_ENV=test` state-changing requests требуют равенства CSRF cookie и
   `x-csrf-token`.
6. Services читают/изменяют Drizzle tables. Нет queue, Redis, WebSocket или
   background worker.

Working-tree foundation добавляет fail-closed/atomic/audited bootstrap config до
подключения к DB, production DB guard и отдельный destructive-consent-protected
`TEST_DATABASE_URL`. Это ещё не означает production deploy; см.
[`../operations/DEPLOYMENT_AS_BUILT.md`](../operations/DEPLOYMENT_AS_BUILT.md).

Текущая защита не является достаточной: ownership/visibility gaps перечислены в
[`../BACKLOG.md`](../BACKLOG.md) (`SEC-003`, `SEC-006`, `SEC-007`, `BUG-001`).

## Match/tournament coupling

`MatchService` хранит snapshot счёта и JSON event log в строке match. При finish
он применяет user stats и вызывает установленный `TournamentService` hook.
`TournamentService` обновляет `tournaments.bracket_json` и материализует следующие
match rows. Эти действия не образуют одну транзакцию; см. `DATA-002`.

Новая генерация bracket использует schemaVersion 2. Legacy V1 JSON остаётся
read/playable по текущему коду/ADR, но для V1 DE известен hang risk (`DATA-006`).

## Web routes

Authenticated shell: `/`, `/history`, `/start`, `/admin`, `/matches`,
`/matches/new`, `/matches/:id`, `/rankings`, `/tournaments`,
`/tournaments/:id`, `/teams`, `/profile`, `/help`, `/onboarding`,
`/notifications`. Judge route `/matches/:id/judge` immersive. Вне shell:
`/login`, `/first-password`; `*` показывает Not Found.

## Ключевые границы и риски

- API и web — один deployable каждый; shared package компилируется отдельно.
- Production PostgreSQL и PGlite tests не полностью эквивалентны.
- Polling реализован неравномерно, server push отсутствует.
- Runtime validation не следует формальным схемам системно.
- `app.ts` объединяет routing, serialization и authorization, из-за чего легко
  пропустить actor/field filtering.
- Structured logging/readiness/DB migration ledger отсутствуют.

Детали: [API as-built](API_AS_BUILT.md), [data model as-built](DATA_MODEL_AS_BUILT.md),
[deployment as-built](../operations/DEPLOYMENT_AS_BUILT.md).
