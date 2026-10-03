# Архитектура as-built

Снимок кода на **2026-10-03**. Целевые требования находятся в
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
                 ├─ TeamService / GuestService
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
readable; V1 SE остаётся playable. Запуск legacy V1 DE отклоняется безопасно
по D25/AT-TRN-015; прежний hang risk закрыт DATA-006.

## Web routes

Authenticated shell: `/`, `/history`, `/start`, `/admin`, `/admin/users/:id`, `/matches`,
`/matches/new`, `/matches/:id`, `/rankings`, `/tournaments`, `/tournaments/new`,
`/tournaments/:id`, `/teams`, `/teams/:id`, `/profile`, `/users/:id`, `/guests`,
`/guests/:id`, `/help`, `/onboarding`,
`/notifications`. Judge route `/matches/:id/judge` immersive. Вне shell:
`/login`, `/first-password`; `*` показывает Not Found.

Wave A добавляет centralized runtime-401 recovery с сохранением безопасного
внутреннего return path и незавершённого draft, bounded initial cold-start state,
persisted onboarding, полный Home dashboard, notification lifecycle, guarded
form submissions и общий visible-only refresh primitive. JudgePage сохраняет
отдельный ownership heartbeat, сериализованную score queue и D33 terminal/void
read-only behavior.

Stage 2 candidate D36: shell без bottom tabs и общего меню; Home содержит
прямые CTA, личные текущие дела, историю и top-3 с вторичными текстовыми
входами. `/start` переводит к Home actions. TaskNavigation использует источник
перехода либо same-account контекст истории/сетки и безопасный route fallback.
История повторно загружает страницы перед восстановлением scroll; сетка
восстанавливает zoom, позицию и рабочую карточку. Явный Home в Judge проходит
через existing releaseAndExit и переносит результат на целевую страницу.
При первом pending/error Home сохраняет именованные входы в историю и рейтинг;
завершённая краткая карточка матча показывает победившую сторону по `winnerSide`
без повтора имени. Турнирные сводки обходятся без полного match detail fanout.

Stage 14 candidate добавляет account-card route и actor-bound return context для
History, Teams и Admin detail. Восстановление принимается только при совпадающих
actor, target, source и ephemeral token. Явный Home и прямой переход A→B удаляют
устаревший context; scroll/focus восстанавливаются после свежего GET.
AdminPage/AdminUserPage разделяют поколения actor, route, load и mutation, поэтому
поздний ответ старого экрана не раскрывает secret/error и не снимает новый
pending. Team settings сохраняют draft при неизвестном исходе и выполняют
GET-only review; destructive membership/role actions требуют подтверждения.

## Delivery boundary

- `pnpm dev` поднимает закреплённый PostgreSQL 16.15 и запускает явную migration
  command до API/web; `pnpm dev:pglite` остаётся отдельным упрощённым режимом.
- API startup не изменяет persistent schema. Он требует точный известный migration
  prefix и допускает только более новые trailing migrations для rollback binary.
- PR и push точного merge SHA в `main` проходят одинаковые quality,
  PostgreSQL/migration и compiled-browser lanes. Только успешный агрегатор
  `release-gate` допускает release workflow.
- Render native Git integration настроена на `commit`: применяет migrations и
  запускает compiled API параллельно hosted CI. Vercel начинает сборку `main`,
  но source gate D40 удерживает web до готовности API и окна drain. Release
  workflow не мутирует providers и проверяет exact SHA/version; окончательная
  приёмка требует также успешного hosted CI.

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

### Wave E candidate boundaries

MatchService owns historical consent and prestart roster reconciliation; NotificationService
synchronizes expiration and enriches history. Domain event producers write notifications
inside their existing action transactions. The web notice polls the owner-scoped center,
suppresses immersive judge/tutorial routes and persists dismiss/read without accepting an
invitation. Center and notice state are isolated by actor; stale responses cannot navigate
the next actor. Admin mutations share one globally UUID-sorted user-row lock query for
current active admins, actor and target, compatible with match participant locking.
Wave E functional acceptance and the subsequent D+E+F full local1249/1249 gate passed. The candidate remains unpublished; see wave-f-local evidence.

### Wave F application UI boundary

The vendored ic-kit is unchanged. `apps/web/src/ui.tsx` retains its Dialog portal
and presentation while stabilizing onClose and computing current focus controls.
It filters CSS-hidden ancestors and recovers disabled/removed/hidden active focus
through a panel-scoped MutationObserver, disconnecting on close and deferring to
a later mounted modal. Existing busy close guards and connected-opener restore
remain. Nested-modal lifecycle is source-reviewed, not a dedicated runtime test.

Application CSS owns44px floors, selected/dark contrast and one auth/judge inset
owner. Judge changes add a single authoritative polite summary and ordinary
disclosure controls, leaving mutation serialization unchanged. Each bracket band
exposes keyboard/scroll controls and100–150% enlargement with fixed round labels;
model/topology remains unchanged. Ranking-row avatars adjacent to named links
are decorative. These boundaries pass the current local gate and scoped Firefox
checks; full device/AT/WebKit compatibility remains incomplete.


## D40 completion candidate 6.0.0

Match preparation is an editable scorekeeping screen backed only by volatile
client state. `POST /matches/launches` atomically creates the match, roster,
rules, actual first server, judge session and start. Actor-bound receipts and a
frozen attempt prevent duplicate creation after a lost response or reauth.

`matchFacts` projects authoritative first server, playing time, judge-session
activations and event chronology. Missing legacy facts stay unknown. Passing
one phone does not invent a new judge. Scoring retains its ordered intent queue,
version checks and single-session ownership.

Bracket generation reads a versioned context and uses `/bracket-generations`,
serialized with roster changes and start. The legacy unversioned endpoint fails
closed with 409. Closing the dialog retains pending/unknown feedback on the page;
it neither cancels nor repeats the operation. The planned date is a pre-start
DATE field, without scheduled auto-start or changes to sporting results.

`GuestService` owns reusable guest identities, actor-bound create/rename receipts
and immutable participation snapshots. Equal names do not merge identities;
legacy one-off guests are not backfilled. Cursor history exposes only permitted
terminal events. Home links to the guest catalogue and card; event forms expose
one-off and saved guest choices explicitly. Team avatars are nullable keys from
the existing catalogue, without uploads or additional storage.

`AdminMatchRecoveryService` exposes only the exact-ID minimal DTO and authorized
force-close to active admins; it does not open arbitrary active-match detail or
grant organizer rights. Production web builds await matching API version/SHA,
DB readiness and a continuous drain interval; independent hosted CI, Render,
Neon and web/API/proxy checks remain necessary for release acceptance.


### Native Judge navigation — integration candidate 6.0.0

`main.tsx` uses a React Router data router. `JudgeNavigationBridge` intercepts
same-document POP through `useBlocker`; `JudgePage` settles its existing mutation
and scoring queue before one best-effort release. `blocker.proceed()` preserves
the actual history entry; no raw popstate compensation or unload release is used.
A volatile one-shot destination notice is consumed by the shell. Cross-document
navigation and process loss still rely on server TTL. Independent review and the
current full-gate receipt determine acceptance; source presence alone does not.
