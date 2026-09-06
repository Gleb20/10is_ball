# Backlog аудита Tab-10

Живой backlog после [baseline-аудита](audits/2026-09-06-baseline.md). Порядок
внутри файла не заменяет поле Priority. Каждый canonical finding имеет один
уникальный heading; ссылки на ID разрешены в других документах.

Допустимые статусы: `confirmed` → `ready` → `in_progress` → `verified_local` →
`verified_prod` → `done`; `blocked_decision` используется до принятого ADR.
Внешняя зависимость фиксируется в `Dependencies`, но не создаёт новый status.
Правила ведения — в [WORKFLOW.md](WORKFLOW.md).

## Security и права

### SEC-001 — Ротация скомпрометированного доступа к БД

- **Type:** security
- **Priority:** P0
- **Status:** in_progress
- **Evidence:** live-looking Neon credential находился в `apps/api/.env.example`; локальное удаление не отзывает уже раскрытый доступ. Зафиксированная точка baseline: `docs/audits/2026-09-06-baseline.md:93`; текущий очищенный scan: `docs/audit/evidence/secret-scan.json:15` (`candidates=[]`).
- **Expected:** старый credential отозван в Neon, Render использует новый secret, старый доступ отрицательно проверен; значения не попадают в код/логи/docs.
- **Actual:** current worktree/`HEAD`/`origin/main` location scan сообщает 0 candidates после cleanup, но это не отзывает ранее раскрытый credential; внешняя ротация не подтверждена. См. [Q-OPS-001](OPEN_QUESTIONS.md#q-ops-001--статус-ротации-credential).
- **Repro:** проверить историю репозитория на secret fingerprint и состояние credential в Neon/Render без публикации значения.
- **Risk:** несанкционированное чтение, изменение или удаление production-данных.
- **Verification:** rotate → redeploy → health/login smoke → доказать отказ старого credential → secret scan HEAD и history.
- **Dependencies:** владелец Neon/Render; затем SEC-004 и OPS-004.

### SEC-002 — Password hash в ответе профиля

- **Type:** security
- **Priority:** P0
- **Status:** ready
- **Evidence:** [`PATCH /me/profile`](../apps/api/src/app.ts) возвращает raw row из `updateProfile`, включая `passwordHash` из [`users`](../apps/api/src/db/schema.ts). Точные точки: `apps/api/src/app.ts:505`, `apps/api/src/modules/auth/auth-service.ts:524`, `apps/api/src/db/schema.ts:28`.
- **Expected:** ни один HTTP response/log не содержит password hash или другие внутренние auth-поля.
- **Actual:** успешное обновление профиля сериализует полную DB-строку.
- **Repro:** войти, вызвать `PATCH /api/v1/me/profile`, проверить поле `user.passwordHash`.
- **Risk:** раскрытие verifier повышает последствия XSS, логирования и утечки ответа.
- **Verification:** API regression test на allowlist полей; grep/contract test всех user serializers.
- **Dependencies:** нет.

### SEC-003 — Обход обязательной смены временного пароля

- **Type:** security
- **Priority:** P0
- **Status:** ready
- **Evidence:** `requireAuth` в [`app.ts`](../apps/api/src/app.ts) разрешает URL через `req.url.includes(...)`, включая совпадение в query string. Точные точки: `apps/api/src/app.ts:115`, `apps/api/src/app.ts:117`.
- **Expected:** пользователь с `mustChangePassword=true` может вызвать только точные allowlisted route+method.
- **Actual:** запрещённый route можно замаскировать подстрокой allowlisted path в query.
- **Repro:** с temporary-password session вызвать mutation с query, содержащим `/auth/me` или `/auth/logout`.
- **Risk:** аккаунт получает продуктовые возможности до установки постоянного пароля.
- **Verification:** негативные API tests для path/query/encoding и точная проверка router path+method.
- **Dependencies:** нет.

### SEC-004 — Fail-open bootstrap администратора

- **Type:** security
- **Priority:** P0
- **Status:** verified_local
- **Evidence:** baseline-аудит зафиксировал Render default `SEED_ADMIN=1` и fallback credentials; current [`render.yaml`](../render.yaml) задаёт default-off в `render.yaml:22`. Bootstrap возвращает atomic `existing`/`provisioned` outcomes в `apps/api/src/bootstrap-admin.ts:121` и `apps/api/src/bootstrap-admin.ts:127`; создание и durable system audit выполняются в одной транзакции в `apps/api/src/modules/auth/auth-service.ts:537` и `apps/api/src/modules/auth/auth-service.ts:562`. Focused concurrency/audit characterization находится в `apps/api/src/bootstrap-admin.integration.test.ts:16`.
- **Expected:** production startup fail-closed без явно заданных secrets; bootstrap одноразовый, аудируемый и отключаемый.
- **Actual:** baseline был fail-open; current foundation требует точный opt-in и явные valid values, ставит Render default `0`, не ротирует существующего active admin, атомарно различает созданную и уже существующую запись и пишет один durable audit event в той же транзакции. Внешние Render/production настройки и deploy ещё не проверены.
- **Repro:** запустить production-like API без части `SEED_ADMIN_*`, изучить созданного/существующего admin.
- **Risk:** полный захват приложения.
- **Verification:** independent focused foundation run прошёл 40/40 tests в 7 files: bootstrap unit 12, bootstrap persistence 1, test DB guard 9, migration URL 7, runtime audit 7, safe log 2, env loader 2; остаются external production-like smoke и dashboard `SEED_ADMIN=0` verification.
- **Dependencies:** SEC-001; решение о production bootstrap в Q-OPS-002 желательно, но fail-closed не зависит от него.

### SEC-005 — Уязвимые production dependencies

- **Type:** security
- **Priority:** P0
- **Status:** ready
- **Evidence:** `pnpm audit --prod --json` 2026-09-06T16:11:41.852Z: 17 advisories — 12 high, 5 moderate, 0 critical; среди затронутых цепочек Drizzle и `find-my-way`. Current lock points: `pnpm-lock.yaml:3054`, `pnpm-lock.yaml:3225`. Immutable baseline сохраняет свой исторический результат без переписывания.
- **Expected:** нет известных high/critical advisories в production graph либо есть документированное исключение с компенсацией.
- **Actual:** high advisories не устранены и не triaged по достижимости.
- **Repro:** `pnpm audit --prod` на зафиксированном lockfile.
- **Risk:** SQL injection/DoS и supply-chain exposure в зависимости от достижимости.
- **Verification:** staged upgrade, полный CI, targeted security tests, повторный audit с сохранённым отчётом.
- **Dependencies:** совместимость Fastify/Drizzle и реальный PostgreSQL test.

### SEC-006 — Organizer-only операции доступны любому вошедшему

- **Type:** authorization
- **Priority:** P0
- **Status:** ready
- **Evidence:** handlers start match, add participant/guest и generate/regenerate bracket в [`app.ts`](../apps/api/src/app.ts) не передают/не проверяют actor как владельца. Точные точки без actor: `apps/api/src/app.ts:564`, `apps/api/src/app.ts:960`, `apps/api/src/app.ts:1060`.
- **Expected:** start матча выполняет только creator/organizer; управление roster/bracket — только organizer соответствующего турнира.
- **Actual:** любой authenticated user может мутировать чужие события через прямой API.
- **Repro:** user B вызывает указанные endpoints для сущности user A.
- **Risk:** подмена состава, сетки и спортивного результата.
- **Verification:** role/ownership matrix API tests с organizer, participant, active judge, outsider и admin.
- **Dependencies:** ADR D17/D18/D23; cancel-specific drift ведётся в BUG-002.

### SEC-007 — Cross-tournament IDOR при удалении участника

- **Type:** authorization
- **Priority:** P0
- **Status:** ready
- **Evidence:** participant removal в [`TournamentService`](../apps/api/src/modules/tournaments/tournament-service.ts) обновляет строку по participant ID без совместного ограничения tournament ID. Точная точка predicate: `apps/api/src/modules/tournaments/tournament-service.ts:301`.
- **Expected:** participant mutation требует совпадения route tournament, participant tournament и organizer actor.
- **Actual:** ID из другого турнира может быть удалён через текущий route context.
- **Repro:** organizer A подставляет participantId турнира B в endpoint турнира A.
- **Risk:** межтенантная порча roster и bracket readiness.
- **Verification:** negative integration test на mismatched IDs и SQL predicate по обоим идентификаторам.
- **Dependencies:** SEC-006.

## Целостность данных и домена

### DATA-001 — Request validation и доменные invariants не применяются

- **Type:** correctness
- **Priority:** P0
- **Status:** ready
- **Evidence:** routes в [`app.ts`](../apps/api/src/app.ts) в основном приводят `req.body` типами; существующие Zod contracts не являются runtime gate. Пример прямого type assertion без runtime schema: `apps/api/src/app.ts:517`.
- **Expected:** schema validation и сервисные invariants отклоняют пустой/дублирующийся roster, blocked users, неверные side/winner/rules/state transitions без мутаций.
- **Actual:** допустимы malformed payloads, self/duplicate players, изменение version/event при неверной стороне и `cancelled → stopped`; create flow неатомарен.
- **Repro:** создать пустой/duplicate match; отправить invalid side/winner; stop cancelled match; сравнить state/version.
- **Risk:** невозможные матчи, ошибочная статистика и повреждённый event log.
- **Verification:** table-driven API/domain tests на все границы и отсутствие side effects; transactional create.
- **Dependencies:** MATCH acceptance и DATA-003 constraints.

### DATA-002 — Finish, stats и tournament advancement неатомарны

- **Type:** concurrency
- **Priority:** P0
- **Status:** ready
- **Evidence:** [`MatchService`](../apps/api/src/modules/matches/match-service.ts) сохраняет результат/статистику отдельно от hook в [`TournamentService`](../apps/api/src/modules/tournaments/tournament-service.ts); stats используют lost-update-prone read/modify/write. Последовательные точки вне общей транзакции: `apps/api/src/modules/matches/match-service.ts:496`, `apps/api/src/modules/matches/match-service.ts:509`, `apps/api/src/modules/matches/match-service.ts:513`; read/modify/write stats виден в `apps/api/src/modules/matches/match-service.ts:1167` и `apps/api/src/modules/matches/match-service.ts:1188`.
- **Expected:** результат, stats compensation/application и переход сетки образуют идемпотентную транзакцию с CAS/locking.
- **Actual:** сбой/параллельные полуфиналы могут оставить частично применённые stats, duplicate/missing next match или stalled bracket; legacy V1 path не имеет CAS, а V1 DE ещё не отклоняется по D25.
- **Repro:** параллельно завершить два связанных tournament matches и инъецировать сбой между finish/stats/advance.
- **Risk:** необратимо неверные рейтинги и сетки.
- **Verification:** real-Postgres concurrency tests, fault injection, invariant «один node → один actual match», idempotent replay.
- **Dependencies:** DATA-003; D25 снимает требование совместимости с V1 DE, но не транзакционность поддерживаемого V2.

### DATA-003 — Boot-time DDL заменяет versioned migrations

- **Type:** database
- **Priority:** P1
- **Status:** ready
- **Evidence:** [`db/client.ts`](../apps/api/src/db/client.ts) выполняет `CREATE/ALTER IF NOT EXISTS` при старте; миграция содержит PGlite/Postgres-sensitive casts; отсутствует полная система версий и часть constraints/indexes. Точки boot-time DDL: `apps/api/src/db/client.ts:79`, `apps/api/src/db/client.ts:306`.
- **Expected:** упорядоченные reviewable migrations, одинаково проверенные на PGlite и ephemeral PostgreSQL, с DB invariants и rollback/forward plan.
- **Actual:** drift исправляется ad-hoc DDL на каждом boot; destructive/semantic изменения не отслеживаются.
- **Repro:** поднять schema старой версии и сравнить с Drizzle schema; прогнать migration на real PostgreSQL.
- **Risk:** production drift, startup failure, незаметное отсутствие constraints.
- **Verification:** schema snapshot/diff, clean+upgrade real-PG tests, запрет production `DATABASE_URL` в test harness.
- **Dependencies:** SEC-001, OPS-003.

### DATA-004 — Invitation и membership race conditions

- **Type:** concurrency
- **Priority:** P1
- **Status:** ready
- **Evidence:** [`TeamService`](../apps/api/src/modules/teams/team-service.ts) и tournament invitation flows не подкреплены достаточными unique constraints/atomic transitions. Invitation tables без pair-level unique constraint: `apps/api/src/db/schema.ts:229`, `apps/api/src/db/schema.ts:280`; team flow читает состояние и затем отдельно вставляет invitation в `apps/api/src/modules/teams/team-service.ts:78` и `apps/api/src/modules/teams/team-service.ts:84`.
- **Expected:** один активный invite/membership на пару сущностей; respond/expire идемпотентны; expired notification перестаёт быть actionable/new.
- **Actual:** параллельные запросы могут создать duplicates или конфликтующие состояния.
- **Repro:** одновременно invite/respond для одинаковых team/tournament и user.
- **Risk:** двойное членство, неверные badge/actions, нестабильные roster counts.
- **Verification:** DB constraints + concurrent integration tests + notification-state assertions.
- **Dependencies:** DATA-003.

### DATA-005 — Standalone void и immutable audit отсутствуют

- **Type:** data-governance
- **Priority:** P0
- **Status:** ready
- **Evidence:** target actor/soft-invalidation policy принят в `docs/DECISIONS.md:131` (D24); current service всё ещё физически удаляет match в `apps/api/src/modules/matches/match-service.ts:1146`, а текущая audit table не является immutable sporting ledger (`apps/api/src/db/schema.ts:314`).
- **Expected:** finished/stopped standalone match может void только active admin или creator; reason optional, second approver отсутствует, UI требует explicit confirmation. Исходные result/events/version и immutable actor/timestamp audit сохраняются, stats/ranking компенсируются идемпотентно в одной операции; hard delete запрещён.
- **Actual:** полноценного void нет, а admin delete физически удаляет матч и частично разворачивает stats.
- **Repro:** finished standalone удалить через current admin endpoint и проверить отсутствие match/source audit; отдельно вызвать отсутствующий creator/admin void flow.
- **Risk:** потеря спортивной истории и недоказуемая/неполная коррекция рейтинга.
- **Verification:** AT-MATCH-VOID-001..003 и AT-ADM-MATCH-005/007; creator/admin/participant/judge/outsider matrix, ledger/standalone compensation/idempotency tests; доказать отсутствие hard-delete finished route и browser confirmation.
- **Dependencies:** ADR D19/D24; DATA-002/003 для atomic compensation и durable schema. Tournament downstream policy вынесена в DATA-007.

### DATA-006 — Legacy V1 double-elimination не отклоняется и может зависать

- **Type:** legacy-data
- **Priority:** P1
- **Status:** ready
- **Evidence:** known hang path зафиксирован `todo`-характеризацией в `packages/shared/src/tournament-bracket-v1.characterization.test.ts:28`; target retirement/fail-closed policy принят в `docs/DECISIONS.md:152` (D25).
- **Expected:** legacy schemaVersion 1 DE отклоняется bounded `UNSUPPORTED_BRACKET_VERSION` без mutation/migration/reset; поддерживаемый V2 SE/DE lifecycle остаётся рабочим, V1 SE не меняется.
- **Actual:** current V1 DE input достигает execution path с известным зависанием вместо явного bounded rejection.
- **Repro:** запустить characterization для problematic V1 DE graph с bounded timeout.
- **Risk:** malformed/legacy input может удерживать процесс и делать tournament operation недоступной.
- **Verification:** превратить characterization в deterministic bounded rejection; V2 SE/DE regression matrix и V1 SE non-regression; доказать отсутствие implicit data mutation.
- **Dependencies:** ADR D25; любой production reset/recreate остаётся отдельной approval-gated OPS action, не частью этого item.

### DATA-007 — Турнирный void с сыгранными downstream-матчами не определён

- **Type:** data-governance
- **Priority:** P0
- **Status:** blocked_decision
- **Evidence:** D19/D24 требуют согласованного tournament reconciliation, но [Q-MATCH-003](OPEN_QUESTIONS.md#q-match-003--void-турнирного-матча-с-downstream-результатами) не выбирает между запретом, cascade-void и repair-required flow; current code отдельного void не имеет.
- **Expected:** один наблюдаемый outcome для void upstream tournament result после сыгранных downstream matches, с атомарными ledger/compensation/bracket invariants и без hard delete.
- **Actual:** actor и soft-invalidation policy известны, но зависимый tournament outcome и его acceptance criteria не определены.
- **Repro:** завершить upstream tournament match, сыграть материализованный downstream match и попытаться исправить upstream result.
- **Risk:** молчаливое каскадное повреждение сетки, статистики и уже сыгранной спортивной истории.
- **Verification:** после закрытия Q-MATCH-003 добавить отдельные observable acceptance scenarios и real-PostgreSQL concurrency/rollback tests для выбранного поведения.
- **Dependencies:** Q-MATCH-003; DATA-002/003/005.

## Функциональные и UI-дефекты

### BUG-001 — Видимость активных и завершённых событий не соблюдается

- **Type:** authorization
- **Priority:** P0
- **Status:** ready
- **Evidence:** list/detail match и tournament routes в [`app.ts`](../apps/api/src/app.ts) возвращают глобальные данные любому authenticated user; tutorial может попадать в списки. Глобальные service calls без actor/scope: `apps/api/src/app.ts:510`, `apps/api/src/app.ts:546`, `apps/api/src/app.ts:876`, `apps/api/src/app.ts:915`.
- **Expected:** active — только organizer, participants, current active judge; completed — все active non-blocked club users; tutorial изолирован.
- **Actual:** посторонний видит активные события и историю вне разрешённого scope.
- **Repro:** создать active event user A, запросить list/detail user B; повторить для completed/blocked/tutorial.
- **Risk:** утечка закрытых событий и несоответствие HISTORY-003.
- **Verification:** AT-VIS-001..004 на list/detail/home/history для всех ролей и статусов.
- **Dependencies:** ADR D17; SEC-006.

### BUG-002 — Права start, early stop и cancel шире целевой модели

- **Type:** authorization
- **Priority:** P0
- **Status:** ready
- **Evidence:** start handler не передаёт actor (`apps/api/src/app.ts:564`); [`MatchService.stopMatch`](../apps/api/src/modules/matches/match-service.ts) использует manager check, где participant проходит в `apps/api/src/modules/matches/match-service.ts:868` и active judge — в `apps/api/src/modules/matches/match-service.ts:876`. Тот же check вызывается cancel в `apps/api/src/modules/matches/match-service.ts:1047`, поэтому participant/judge получают право вопреки D23.
- **Expected:** start — только creator/organizer; early stop — creator/organizer или current active judge; cancel — только active admin или creator, reason optional, с явным UI confirmation и server actor/state/version/idempotency checks.
- **Actual:** outsider может start через API; обычный participant может stop; participant/current judge может cancel, тогда как admin path отделён в force-close.
- **Repro:** вызвать start outsider; stop обычным participant без judge session; cancel participant и active judge, которые не creator/admin.
- **Risk:** несанкционированный запуск, искажение результата или отмена чужого матча.
- **Verification:** AT-MATCH-START-001, AT-MATCH-STOP-001/002 и AT-MATCH-CANCEL-001..004 с creator/admin/participant/judge/outsider actor matrix и browser confirmation.
- **Dependencies:** ADR D18/D23; DATA-001 для request/version validation.

### BUG-003 — Быстрый двойной `+1` теряет очко

- **Type:** concurrency-ui
- **Priority:** P0
- **Status:** ready
- **Evidence:** [`JudgePage.tsx`](../apps/web/src/pages/JudgePage.tsx) отправляет два запроса с одним `expectedVersion`; второй conflict не ставится в очередь. `point()` читает текущую version до await в `apps/web/src/pages/JudgePage.tsx:209` и кнопка остаётся доступна в `apps/web/src/pages/JudgePage.tsx:417`.
- **Expected:** каждое намеренное нажатие либо сериализовано и применено один раз, либо UI явно блокирует повтор до sync.
- **Actual:** одно из двух быстрых нажатий silently/через error теряется.
- **Repro:** быстро нажать `+1` дважды до завершения первого request.
- **Risk:** неверный счёт в основном продуктовым флоу.
- **Verification:** fake-latency component test + browser test; проверить idempotency и итог +2.
- **Dependencies:** DATA-001/DATA-002 API invariants.

### BUG-004 — Judge lock не освобождается при выходе

- **Type:** lifecycle
- **Priority:** P1
- **Status:** ready
- **Evidence:** [`JudgePage.tsx`](../apps/web/src/pages/JudgePage.tsx) не гарантирует release при Cancel/Back/unmount; освобождение ждёт TTL. Release существует только в явном action `apps/web/src/pages/JudgePage.tsx:241`; setup Cancel просто навигирует в `apps/web/src/pages/JudgePage.tsx:464`.
- **Expected:** явный выход освобождает lock best-effort и навигация показывает результат; crash остаётся за TTL.
- **Actual:** штатный выход оставляет слот занятым до expiry.
- **Repro:** acquire → Back/Cancel → открыть judge другим пользователем.
- **Risk:** матч временно нельзя судить.
- **Verification:** component/browser lifecycle tests и API assertion releasedAt; TTL fallback отдельно.
- **Dependencies:** BUG-005.

### BUG-005 — Judge UI игнорирует потерю lock и внешние изменения

- **Type:** live-state
- **Priority:** P1
- **Status:** ready
- **Evidence:** heartbeat errors в [`JudgePage.tsx`](../apps/web/src/pages/JudgePage.tsx) не переводят UI в lost-lock; polling медленнее documented cadence и не привязан к visibility. Ошибка heartbeat поглощается в `apps/web/src/pages/JudgePage.tsx:156`, polling задан на 30/60 секунд в `apps/web/src/pages/JudgePage.tsx:149`.
- **Expected:** lost lock немедленно блокирует scoring; активный экран синхронизируется с server state и polling паузится/возобновляется по visibility.
- **Actual:** stale UI может позволять действия, уже недействительные на сервере.
- **Repro:** acquire, отозвать/expire session или изменить match другим клиентом, наблюдать экран.
- **Risk:** ошибочные действия, конфликтный UX, недоверие к счёту.
- **Verification:** heartbeat failure/poll tests и two-browser scenario.
- **Dependencies:** OPS-002 observability полезна, но не блокирует.

### BUG-006 — Ошибка action скрывает весь экран матча

- **Type:** error-handling
- **Priority:** P1
- **Status:** ready
- **Evidence:** [`MatchDetailPage.tsx`](../apps/web/src/pages/MatchDetailPage.tsx) использует общий error state для initial load и mutations; 403 от Stop заменяет детали ошибкой. Mutation пишет общий error в `apps/web/src/pages/MatchDetailPage.tsx:102`, а тот же state передан всему `AsyncState` в `apps/web/src/pages/MatchDetailPage.tsx:148`.
- **Expected:** mutation error показывается рядом с действием, уже загруженные данные остаются видимыми.
- **Actual:** неразрешённое действие разрушает контекст страницы.
- **Repro:** viewer открывает match и нажимает доступную Stop; получить 403.
- **Risk:** пользователь теряет навигационный контекст и не понимает права.
- **Verification:** component test «loaded data survives action error» и browser smoke.
- **Dependencies:** BUG-002, BUG-009.

### BUG-007 — Истёкшая/отозванная сессия не ведёт на login

- **Type:** auth-ui
- **Priority:** P1
- **Status:** ready
- **Evidence:** [`api.ts`](../apps/web/src/api.ts) и [`auth.tsx`](../apps/web/src/auth.tsx) не централизуют реакцию на runtime 401. Общий request только выбрасывает ошибку в `apps/web/src/api.ts:40`, а auth refresh запускается лишь при mount в `apps/web/src/auth.tsx:36`.
- **Expected:** 401 очищает auth state, сохраняет безопасный return path и показывает login без reload loop.
- **Actual:** экран остаётся «вошедшим» до полной перезагрузки и показывает разрозненные ошибки.
- **Repro:** открыть приложение, отозвать session, выполнить API action.
- **Risk:** полурабочая UI-сессия и потеря введённых данных.
- **Verification:** API client/auth provider test и browser revoke scenario.
- **Dependencies:** нет.

### BUG-008 — Активные списки и детали остаются устаревшими

- **Type:** live-state
- **Priority:** P1
- **Status:** ready
- **Evidence:** match/tournament pages не имеют согласованного visible-only polling/manual refresh; home/list используют snapshot запроса. Match detail загружается только mount-effect в `apps/web/src/pages/MatchDetailPage.tsx:39`; Home — только mount-effect в `apps/web/src/pages/HomePage.tsx:24`.
- **Expected:** active state обновляется с принятой частотой, при возврате вкладки выполняется refresh, есть ручной retry.
- **Actual:** пользователь видит старый status/score/bracket до навигации или reload.
- **Repro:** открыть событие в двух браузерах, изменить в одном, наблюдать второй.
- **Risk:** ложные решения организатора/участника.
- **Verification:** fake-timer component tests и two-browser smoke на match/tournament/home.
- **Dependencies:** BUG-001 visibility filters.

### BUG-009 — Формы допускают duplicate submissions

- **Type:** interaction
- **Priority:** P1
- **Status:** ready
- **Evidence:** tournament/team/admin/password/onboarding/feedback actions не имеют общей pending-disable/idempotency стратегии. Например, create-user submit не disabled при pending в `apps/web/src/pages/AdminPage.tsx:146`, а onboarding promise action — в `apps/web/src/pages/OnboardingPage.tsx:23`.
- **Expected:** submit блокируется на время request; server idempotency/uniqueness защищает критические create/respond operations.
- **Actual:** двойной tap создаёт параллельные requests и потенциальные duplicates.
- **Repro:** double-click submit под network throttling на каждой форме.
- **Risk:** дубли сущностей, приглашений и противоречивый UI.
- **Verification:** parameterized form tests + server constraints для критических mutations.
- **Dependencies:** DATA-003/DATA-004.

### BUG-010 — Self-challenge создаёт self-vs-self матч

- **Type:** domain-ui
- **Priority:** P1
- **Status:** ready
- **Evidence:** challenge action в [`RankingsPage.tsx`](../apps/web/src/pages/RankingsPage.tsx) доступен для себя; backend не запрещает duplicate user sides. CTA рендерится для каждой podium row без self guard в `apps/web/src/pages/RankingsPage.tsx:81`; service без distinct-user guard записывает каждого участника в `apps/api/src/modules/matches/match-service.ts:90` и `apps/api/src/modules/matches/match-service.ts:95`.
- **Expected:** current user нельзя выбрать/передать на обе стороны; backend отклоняет duplicate participant независимо от UI.
- **Actual:** ranking prefill позволяет создать матч пользователя против себя.
- **Repro:** открыть собственную позицию в ranking → challenge → submit.
- **Risk:** невозможный матч и испорченная статистика.
- **Verification:** API invariant test + ranking/create component test.
- **Dependencies:** DATA-001.

### BUG-011 — Admin UI не поддерживает безопасный unblock

- **Type:** admin-ui
- **Priority:** P1
- **Status:** ready
- **Evidence:** [`AdminPage.tsx`](../apps/web/src/pages/AdminPage.tsx) не предоставляет unblock, при этом допускает self-block affordance. Role controls имеют self guard в `apps/web/src/pages/AdminPage.tsx:186`, но Block рендерится без него в `apps/web/src/pages/AdminPage.tsx:206`.
- **Expected:** unblock доступен для blocked target; self/last-admin destructive actions скрыты и запрещены сервером.
- **Actual:** восстановить пользователя из UI нельзя, опасное self-action показывается.
- **Repro:** открыть active и blocked users в admin UI.
- **Risk:** operational lockout и ручные API-workarounds.
- **Verification:** component/API tests на block/unblock/self/last-admin matrix.
- **Dependencies:** нет.

### BUG-012 — Onboarding нельзя надёжно продолжить

- **Type:** state-machine
- **Priority:** P1
- **Status:** ready
- **Evidence:** [`OnboardingPage.tsx`](../apps/web/src/pages/OnboardingPage.tsx) — статическая карточка; completion/resume flag не реализует заявленный guided flow. Локальный state ограничен `done` в `apps/web/src/pages/OnboardingPage.tsx:8`, а completion сразу навигирует home в `apps/web/src/pages/OnboardingPage.tsx:37`.
- **Expected:** auto-open once, resume after interruption, complete/skip persistence, manual restart from profile.
- **Actual:** состояние шага и прохождение не соответствуют ONB-001..005.
- **Repro:** начать onboarding, reload/close, войти снова, попробовать restart.
- **Risk:** новый пользователь не получает воспроизводимое обучение.
- **Verification:** AT-ONB-001/002 плюс reload/resume E2E.
- **Dependencies:** нет; полный PRD v2 закреплён D26.

### BUG-013 — Уведомления имеют неполную read/expiry семантику

- **Type:** notifications
- **Priority:** P1
- **Status:** ready
- **Evidence:** [`NotificationsPage.tsx`](../apps/web/src/pages/NotificationsPage.tsx) не помечает видимые карточки автоматически и не показывает timestamps; expired invitations могут оставаться «новыми». Visible filter доверяет lifecycle в `apps/web/src/pages/NotificationsPage.tsx:55`, а read выполняется только action-кнопкой в `apps/web/src/pages/NotificationsPage.tsx:230`.
- **Expected:** видимая часть отмечается read по принятому правилу; expired/revoked items не actionable и имеют время/причину.
- **Actual:** badge и список могут расходиться с фактической актуальностью.
- **Repro:** открыть список с unread и expired invitation; сравнить badge после просмотра/relogin.
- **Risk:** ложные актуальные действия и шум.
- **Verification:** AT-NOTIF-001..004 integration/component tests.
- **Dependencies:** DATA-004.

### BUG-014 — Ranking period boundaries рассчитаны в UTC вместо Europe/Moscow

- **Type:** timezone-correctness
- **Priority:** P1
- **Status:** ready
- **Evidence:** [`ranking.ts`](../packages/shared/src/ranking.ts) явно строит Monday/month start в UTC; [`MatchService`](../apps/api/src/modules/matches/match-service.ts) использует эти границы для week/month. Точные точки: `packages/shared/src/ranking.ts:21`, `packages/shared/src/ranking.ts:31`, `apps/api/src/modules/matches/match-service.ts:953`.
- **Expected:** calendar day/week/month boundaries и отображение используют `Europe/Moscow`, absolute timestamps остаются UTC (ADR D20).
- **Actual:** событие около московской полуночи может попасть в предыдущий/следующий ranking period.
- **Repro:** взять instants по обе стороны 00:00 Monday/month в Moscow, передать server/browser с разными timezone.
- **Risk:** разные пользователи видят формально неверный недельный/месячный рейтинг.
- **Verification:** AT-RANK-002 table tests на UTC↔Moscow boundary, host TZ matrix и API integration.
- **Dependencies:** нет.

### BUG-015 — Busy organizer/participant с bye обходит запрет активного матча

- **Type:** tournament-correctness
- **Priority:** P1
- **Status:** ready
- **Evidence:** обычные acceptance scenarios используют deterministic non-bye seed в `apps/api/src/domain.integration.test.ts:1699`; отдельный hermetic characterization с фиксированным bye seed начинается в `apps/api/src/domain.integration.test.ts:1736` и подтверждает ошибочный HTTP 200 в `apps/api/src/domain.integration.test.ts:1803`. Reproducer читает structured JSON reporter в `scripts/audit/reproduce-tournament-busy-bye.mjs:30` и принимает результат только при ровно одном passed test в `scripts/audit/reproduce-tournament-busy-bye.mjs:42`; env-переключателя и парсинга English failure text нет.
- **Expected:** если organizer или participant уже участвует в активном standalone match, start турнира отклоняется с `PLAYER_ALREADY_IN_ACTIVE_MATCH` независимо от seed и распределения bye.
- **Actual:** guard проверяет только материализуемые стартовые пары; busy участник, получивший bye, не попадает в проверку, и tournament start отвечает HTTP 200.
- **Repro:** запустить `pnpm audit:reproduce-busy-bye`; отдельно запустить обычные AT-ADM-MATCH-003/AT-MATCH-CANCEL-001 acceptance scenarios и убедиться, что characterization не меняет их seed или ожидания.
- **Risk:** busy пользователь одновременно остаётся в standalone event и проходит в tournament bracket, нарушая invariant одного активного матча и делая дальнейшую сетку неоднозначной.
- **Verification:** real-PostgreSQL integration matrix для organizer и participant × bye/non-bye × deterministic seeds; на rejection проверить отсутствие частично созданных tournament matches и перехода статуса.
- **Dependencies:** DATA-001, DATA-002, TECH-001.

## Пробелы возможностей

### GAP-001 — Главная не покрывает PRD

- **Type:** product-gap
- **Priority:** P2
- **Status:** confirmed
- **Evidence:** [`HomePage.tsx`](../apps/web/src/pages/HomePage.tsx) и `/home` не дают полный HOME-001..006: active events, tournaments in recent, полный набор stats/rival/period. Current aggregate fields перечислены в `apps/web/src/pages/HomePage.tsx:31`; traceability фиксирует partial coverage в `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md:13`.
- **Expected:** состав и empty states соответствуют HOME-001..006 с visibility policy.
- **Actual:** реализован сокращённый hero/last matches/ranking/notifications aggregate.
- **Repro:** сравнить response/UI с PRD на new, active и experienced users.
- **Risk:** главная не отвечает на ключевые вопросы пользователя.
- **Verification:** component/API tests + browser states; AT-EMPTY-001.
- **Dependencies:** BUG-001; полный PRD v2 закреплён D26.

### GAP-002 — Профиль и публичная карточка неполны

- **Type:** product-gap
- **Priority:** P2
- **Status:** confirmed
- **Evidence:** [`ProfilePage.tsx`](../apps/web/src/pages/ProfilePage.tsx) не покрывает PROFILE-001..006; нет полноценного public profile route/avatar/session management UI. Реализация начинается как own-profile view в `apps/web/src/pages/ProfilePage.tsx:11`; current gap отражён в `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md:14`.
- **Expected:** собственный/public профиль, privacy fields, stats/facts, edit/avatar и sessions по PRD/ADR D10.
- **Actual:** сокращённая карточка и часть редактирования.
- **Repro:** пройти PROFILE requirements по UI/routes.
- **Risk:** неполный identity/stats сценарий и несогласованность avatar требований с D10.
- **Verification:** contract/component/E2E matrix для own/public/blocked users.
- **Dependencies:** reconcile PRD PROFILE-004 с ADR D10.

### GAP-003 — История без фильтров, поиска и пагинации

- **Type:** product-gap
- **Priority:** P2
- **Status:** confirmed
- **Evidence:** [`HistoryPage.tsx`](../apps/web/src/pages/HistoryPage.tsx) использует общие списки без HISTORY-002/AT-VIS-003 contract. Она вызывает два полных list endpoint в `apps/web/src/pages/HistoryPage.tsx:33` и объединяет их в памяти в `apps/web/src/pages/HistoryPage.tsx:56`; отсутствие dedicated API/E2E записано в `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md:16`.
- **Expected:** match+tournament feed, filters/search/stable pagination и visibility.
- **Actual:** упрощённая выдача без dedicated history API.
- **Repro:** искать/фильтровать по периоду, роли, исходу, типу и имени.
- **Risk:** история не масштабируется и раскрывает лишние данные до BUG-001.
- **Verification:** AT-VIS-003 API+E2E; pagination stability tests.
- **Dependencies:** BUG-001, DATA-003 indexes.

### GAP-004 — Рейтинг без team filter и public profile flow

- **Type:** product-gap
- **Priority:** P2
- **Status:** confirmed
- **Evidence:** [`RankingsPage.tsx`](../apps/web/src/pages/RankingsPage.tsx) не покрывает RANK-004/005; challenge доступен не для всех строк и содержит BUG-010. UI предлагает только period filter в `apps/web/src/pages/RankingsPage.tsx:38`; current coverage отмечен broken в `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md:15`.
- **Expected:** all/week/month, team comparison, public card and safe challenge CTA.
- **Actual:** базовая individual ranking выдача.
- **Repro:** пройти RANK-001..005 на UI.
- **Risk:** заявленный социальный/командный сценарий отсутствует.
- **Verification:** AT-RANK-* + component/E2E navigation.
- **Dependencies:** BUG-010, GAP-002, timezone ADR D20.

### GAP-005 — Match create/detail/judge покрывают только часть требований

- **Type:** product-gap
- **Priority:** P2
- **Status:** confirmed
- **Evidence:** страницы [`MatchCreatePage.tsx`](../apps/web/src/pages/MatchCreatePage.tsx), [`MatchDetailPage.tsx`](../apps/web/src/pages/MatchDetailPage.tsx), [`JudgePage.tsx`](../apps/web/src/pages/JudgePage.tsx) не имеют полного 2v2/rules/first-server/groups/revenge/log/no-show/handover/correction набора. Current form implementation начинается в `apps/web/src/pages/MatchCreatePage.tsx:26`; requirement gap сводится в `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md:17`.
- **Expected:** MATCH-001..017 и JUDGE-001..012 по принятым D23/D24, включая cancel/void safeguards.
- **Actual:** рабочий 1v1 happy path и часть judge действий.
- **Repro:** пройти requirements/acceptance matrix на UI и API.
- **Risk:** ключевой домен выглядит готовым, но альтернативные флоу полурабочие.
- **Verification:** scenario matrix unit/API/component/E2E; real two-client judge tests.
- **Dependencies:** P0 DATA/BUG, ADR D23/D24/D26.

### GAP-006 — Турнирный флоу и управление сеткой неполны

- **Type:** product-gap
- **Priority:** P2
- **Status:** confirmed
- **Evidence:** [`TournamentDetailPage.tsx`](../apps/web/src/pages/TournamentDetailPage.tsx) не покрывает full rule config, pair/bye edit UX, current/next/duration/placements/top-3; тесты преимущественно проверяют algorithm dialog. Current page entrypoint — `apps/web/src/pages/TournamentDetailPage.tsx:54`; отсутствие full browser lifecycle отмечено в `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md:19`.
- **Expected:** TOURNAMENT-001..019 и browser-usable V2 SE/DE lifecycle; V1 DE bounded fail-closed.
- **Actual:** create/roster/generate/start/stop и bracket render существуют частично, с concurrency risks; V1 DE ещё достигает known hang path.
- **Repro:** пройти турниры 3/5/8 игроков SE/DE от invite до placement.
- **Risk:** главный сценарий продукта может застрять или требовать ручных обходов.
- **Verification:** deterministic end-to-end tournament suite и responsive bracket QA.
- **Dependencies:** DATA-002/006, SEC-006/007, ADR D25.

### GAP-007 — Teams остаются функциональным stub

- **Type:** product-gap
- **Priority:** P2
- **Status:** confirmed
- **Evidence:** [`TeamsPage.tsx`](../apps/web/src/pages/TeamsPage.tsx) не реализует полный TEAM-001..009 lifecycle. Страница ограничена list/create flow начиная с `apps/web/src/pages/TeamsPage.tsx:7`; sparse coverage записан в `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md:20`.
- **Expected:** captain management, invite/respond, leave/transfer/archive и использование состава в event picker.
- **Actual:** доступна лишь часть list/create/invite flow.
- **Repro:** пройти создание → invite → accept → use member → transfer/leave/archive.
- **Risk:** обещанный командный workflow не завершён.
- **Verification:** AT-TEAM-001..006 + component/E2E.
- **Dependencies:** DATA-004; полный PRD v2 закреплён D26.

### GAP-008 — Notifications реализованы частично

- **Type:** product-gap
- **Priority:** P2
- **Status:** confirmed
- **Evidence:** backend/UI покрывают ограниченный набор типов; popup и полный action lifecycle отсутствуют. UI явно ветвится только по текущим типам начиная с `apps/web/src/pages/NotificationsPage.tsx:154`; partial lifecycle зафиксирован в `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md:21`.
- **Expected:** NOTIF-001..006 с приглашениями, актуальностью, read-state и popup suppression.
- **Actual:** list/read и часть tournament уведомлений.
- **Repro:** инвентаризировать product events и созданные notification types.
- **Risk:** пользователь пропускает обязательные действия или видит устаревшие.
- **Verification:** notification event matrix + AT-NOTIF-*.
- **Dependencies:** BUG-013, DATA-004.

### GAP-009 — Onboarding и Help не достигают заявленного результата

- **Type:** product-gap
- **Priority:** P2
- **Status:** confirmed
- **Evidence:** onboarding статичен; [`HelpPage.tsx`](../apps/web/src/pages/HelpPage.tsx) использует фиксированный feedback kind и не покрывает категории/context tips. Фиксированный kind находится в `apps/web/src/pages/HelpPage.tsx:46`, а static guided-state gap — в `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md:22`.
- **Expected:** ONB-001..005 и HELP-001..003.
- **Actual:** отдельные страницы существуют, но workflow сокращён.
- **Repro:** пройти первый вход/skip/resume/restart и отправку разных feedback categories.
- **Risk:** плохая обучаемость и слабая обратная связь.
- **Verification:** E2E first-login journey + help component/API tests.
- **Dependencies:** BUG-012; полный PRD v2 закреплён D26.

### GAP-010 — Admin UI не покрывает каталог операций

- **Type:** product-gap
- **Priority:** P2
- **Status:** confirmed
- **Evidence:** [`AdminPage.tsx`](../apps/web/src/pages/AdminPage.tsx) без полного search/filter/profile edit/unblock/created/last-login набора ADM-002..008. Current page загружает единый user list в `apps/web/src/pages/AdminPage.tsx:28`; coverage summary — `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md:11`.
- **Expected:** безопасное управление users и audit visibility по PRD.
- **Actual:** create, role, block/reset и match ops представлены частично.
- **Repro:** сверить каждое ADM requirement с control/API response.
- **Risk:** эксплуатация требует прямых API/DB действий.
- **Verification:** admin component/E2E matrix и audit assertions.
- **Dependencies:** BUG-011, DATA-005.

### GAP-011 — Accessibility и responsive качество не подтверждены

- **Type:** accessibility
- **Priority:** P2
- **Status:** confirmed
- **Evidence:** большинство controls меньше 44px; selected ButtonGroup contrast около 1.73:1; auth nested `100dvh`, safe-area double apply, menu/aria-live/avatar semantics и bracket navigation имеют дефекты. Точные audit findings: `docs/A11Y_CHECKLIST.md:13`, `docs/A11Y_CHECKLIST.md:14`, `docs/A11Y_CHECKLIST.md:16`; nested viewport rule виден в `apps/web/src/styles.css:766`, а quality gap — в `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md:27`.
- **Expected:** [A11Y checklist](A11Y_CHECKLIST.md), WCAG AA для ключевых элементов, 360px+ и judge landscape без overflow/semantic violations.
- **Actual:** public production login и synthetic local viewports перечислены в `docs/audit/evidence/visual-baseline/README.md:9`; они подтвердили отсутствие horizontal overflow на снятых экранах, но не закрывают axe, keyboard, contrast, judge landscape и полный PRD state matrix.
- **Repro:** browser audit на 360×640, mobile Safari safe-area, keyboard и screen-reader semantics.
- **Risk:** продукт труден или недоступен на целевых устройствах.
- **Verification:** axe + Playwright geometry/keyboard + ручная contrast/safe-area/judge/bracket проверка.
- **Dependencies:** current production — interim regression baseline по D22; будущий redesign не блокирует исправление подтверждённых defects.

## Эксплуатация и качество

### OPS-001 — OpenAPI не описывает фактический API

- **Type:** documentation-contract
- **Priority:** P1
- **Status:** ready
- **Evidence:** live `/api/v1/openapi.json` сообщает version 0.1.0 и 12 paths, тогда как [`app.ts`](../apps/api/src/app.ts) регистрирует 60 operations/54 paths; target [`08_API_SPEC.md`](requirements/08_API_SPEC.md) также расходится. Exact source/OpenAPI counts: `docs/audit/evidence/route-openapi-inventory.json:8`, `docs/audit/evidence/route-openapi-inventory.json:9`, `docs/audit/evidence/route-openapi-inventory.json:10`, `docs/audit/evidence/route-openapi-inventory.json:11`; live snapshot: `docs/audit/evidence/production-http-baseline.json:68`.
- **Expected:** generated/validated OpenAPI покрывает все public routes, auth, payloads, errors и текущую release version.
- **Actual:** три несовместимых представления API: live OpenAPI, код и target spec.
- **Repro:** сравнить route inventory с OpenAPI paths и API spec.
- **Risk:** клиенты/тесты опираются на ложный контракт.
- **Verification:** route-vs-spec CI checker и schema contract tests; обновить API as-built.
- **Dependencies:** DATA-001 validation schemas.

### OPS-002 — Наблюдаемость и readiness отсутствуют

- **Type:** operations
- **Priority:** P1
- **Status:** ready
- **Evidence:** Fastify создаётся с `logger:false`; `/health` возвращает liveness/time без проверки DB; NFR telemetry не реализована. Точные точки: `apps/api/src/app.ts:82`, `apps/api/src/app.ts:165`.
- **Expected:** structured logs/request ID/latency/error signals, readiness с DB и безопасная диагностика judge/backup/login metrics.
- **Actual:** production failure трудно отличить от cold start или DB outage.
- **Repro:** остановить/сломать DB и вызвать `/health`; изучить logs при 500.
- **Risk:** длительное обнаружение и восстановление инцидентов.
- **Verification:** readiness failure test, redacted structured log assertions, dashboard/runbook smoke.
- **Dependencies:** Q-OPS-002/003 для владельца/retention, базовая readiness не блокируется.

### OPS-003 — Backup и seed scripts опасны для production данных

- **Type:** operations-safety
- **Priority:** P1
- **Status:** ready
- **Evidence:** [`backup-rehearsal.sh`](../scripts/backup-rehearsal.sh) принимает произвольную restore DB/drop path, имеет слабое quoting/predictable temp/no trap; local seed не имеет production guard. Predictable temp и interpolated DROP находятся в `scripts/backup-rehearsal.sh:16`, `scripts/backup-rehearsal.sh:30`; seed содержит только comment guard в `scripts/seed-local-meme-players.mjs:3`.
- **Expected:** явный allowlist test DB, случайный temp с cleanup trap, quoted identifiers, dry-run/confirmation и fail-closed seed.
- **Actual:** ошибочная env/аргумент может затронуть реальную БД.
- **Repro:** code review + запуск только на disposable database с malicious/space identifier.
- **Risk:** удаление production данных.
- **Verification:** shellcheck/Bats или безопасный integration harness; negative production URL tests.
- **Dependencies:** Q-OPS-003 для целевого backup процесса.

### OPS-004 — Release/version drift

- **Type:** release-management
- **Priority:** P1
- **Status:** confirmed
- **Evidence:** package 1.10.1, live OpenAPI 0.1.0, docs называли unreleased endpoints, а production уже отдаёт некоторые из них; deployed commits не зафиксированы. Current package version: `package.json:4`; live API version: `docs/audit/evidence/production-http-baseline.json:68`.
- **Expected:** один release version/commit для web+API, documented deploy status и smoke evidence.
- **Actual:** невозможно доказать, какая версия опубликована и какие функции поддерживаются.
- **Repro:** сравнить package, OpenAPI, changelog, Vercel/Render commit metadata.
- **Risk:** регрессии и rollback без воспроизводимого artifact.
- **Verification:** release checklist, build metadata endpoint/UI, deploy smoke tied to commit SHA.
- **Dependencies:** [Q-OPS-002](OPEN_QUESTIONS.md#q-ops-002--production-release-policy).

### OPS-005 — Cold start не имеет явного UX состояния

- **Type:** resilience-ux
- **Priority:** P1
- **Status:** ready
- **Evidence:** первый live API probe 2026-09-06 превысил 25s, следующий стал ready примерно через 20s; UI использует обычные loading/error paths без отдельного bounded wake-up состояния. Probe result recorded at `docs/audits/2026-09-06-baseline.md:72`; generic Home loading state — `apps/web/src/pages/HomePage.tsx:57`.
- **Expected:** до 60s только для Render cold start: явное «сервис просыпается/загрузка», timeout и Retry; после wake обычные SLO и ошибки не маскируются.
- **Actual:** пользователь видит неопределённую загрузку/ошибку и не знает, когда повторить.
- **Repro:** дать free Render уснуть и открыть приложение/health through Vercel.
- **Risk:** ложное ощущение поломки и бесконечное ожидание.
- **Verification:** AT-OPS-COLD-001/002 с simulated delayed first response и warm timeout; production cold smoke.
- **Dependencies:** ADR D21, OPS-002 для корректной классификации readiness.

### TECH-001 — Full test suite стабилизирован локально

- **Type:** test-reliability
- **Priority:** P0
- **Status:** verified_local
- **Evidence:** baseline API failure остаётся immutable history в `docs/audits/2026-09-06-baseline.md:67`. После отделения deterministic acceptance seed (`apps/api/src/domain.integration.test.ts:1699`) от hermetic known-defect characterization (`apps/api/src/domain.integration.test.ts:1736`) команда `pnpm test` прошла green три раза подряд (confirmed 2026-09-06); текущий full suite на Node 24.20.0 также green: shared 517 passed + 1 todo, test-utils 4, web 70, API 83 passed + 3 PostgreSQL skipped. Initial hosted PostgreSQL job `101526650172` выполнил fresh-schema/date smoke, затем честно упал на двух неверных test expectations; corrected `AT-MATCH-007/011` и `AT-TRN-010` находятся в `apps/api/src/postgres-date.integration.test.ts:139` и `apps/api/src/postgres-date.integration.test.ts:220`. Follow-up GitHub run `34048623246` и оба job green; exact snapshot — `docs/audit/evidence/hosted-ci-foundation.json`. Passing BUG-015 characterization подтверждает воспроизводимость дефекта, а не его исправление.
- **Expected:** полный deterministic CI зелёный; flaky тест блокирует релиз согласно NFR.
- **Actual:** локальная repeatability подтверждена тремя полными прогонами; прежние acceptance failures были связаны со смешением seed-сценариев. Первый hosted PostgreSQL run выявил fixture drift (`pointsToWin=1` и пропущенный third-place match), исправленный без retry/skip; follow-up quality и PostgreSQL jobs прошли. BUG-015 остаётся отдельным детерминированным product defect, а не flaky test.
- **Repro:** выполнить `pnpm test` последовательно; `pnpm audit:reproduce-busy-bye` должен запускать только один отдельный characterization test.
- **Risk:** текущий configured gate воспроизводим локально/hosted, но не заменяет отсутствующие browser E2E и ещё не покрытые product races; product risk busy-bye отслеживается независимо в BUG-015.
- **Verification:** три последовательных full suites и final Node 24.20.0 `pnpm run ci` green локально; GitHub run `34048623246` green, включая PostgreSQL fresh schema/date + `200/409` race + one-time stats + final/third-place advancement.
- **Dependencies:** BUG-015; TECH-004 для final Node 24 CI evidence.

### TECH-002 — Критические флоу не покрыты browser E2E

- **Type:** test-gap
- **Priority:** P1
- **Status:** ready
- **Evidence:** нет automated Playwright journeys/axe suite; traceability ранее заявляла E2E layers без соответствующих тестов. Manual Browser evidence теперь содержит 17-route organizer smoke и отдельный admin pass (`docs/audit/evidence/visual-baseline/README.md:12`), а viewport scope описан в `docs/audit/evidence/visual-baseline/README.md:9`; web manifest по-прежнему содержит только Vitest test scripts в `apps/web/package.json:15` и `apps/web/package.json:16`.
- **Expected:** критические auth/match/judge/tournament/admin journeys и negative authz проверяются на real browser; coverage thresholds измеряются, но не заменяют сценарии.
- **Actual:** преимущественно unit/integration/jsdom плюс одноразовый manual Browser baseline; repeatable E2E, geometry assertions, session expiry и two-client concurrency не подтверждаются.
- **Repro:** inventory test files против acceptance catalog и web routes.
- **Risk:** визуальные/интеграционные дефекты проходят CI.
- **Verification:** минимальная Playwright suite, multi-context judge/tournament, axe и viewport matrix; CI artifact screenshots/traces.
- **Dependencies:** сначала стабилизировать TECH-001 и P0 API invariants.

### TECH-003 — Login rate limiter неверно считает и не масштабируется

- **Type:** technical-debt
- **Priority:** P1
- **Status:** ready
- **Evidence:** in-memory limiter в auth service считает успешные входы, не очищает map и работает отдельно на каждой replica. Process-local Map объявлен в `apps/api/src/modules/auth/auth-service.ts:66`; счётчик создаётся/повышается в `apps/api/src/modules/auth/auth-service.ts:82` и `apps/api/src/modules/auth/auth-service.ts:86` до credential verification в `apps/api/src/modules/auth/auth-service.ts:165`.
- **Expected:** лимитирует неуспешные попытки по безопасному ключу/окну, очищает состояние и имеет понятную multi-instance policy.
- **Actual:** легитимные логины тратят лимит; память растёт; горизонтальный deploy обходит limit.
- **Repro:** серия успешных логинов, множество уникальных ключей, два процесса.
- **Risk:** ложные блокировки, memory growth и слабая защита brute force.
- **Verification:** fake-clock unit tests success/failure/expiry/cleanup и documented production topology.
- **Dependencies:** решение о shared store только при реальной multi-replica потребности.

### TECH-004 — Node 24 alignment подтверждён локально и в CI; hosting deploy pending

- **Type:** build-tooling
- **Priority:** P1
- **Status:** verified_local
- **Evidence:** baseline configs расходились между Node 20/24; current pins согласованы в `.node-version:1`, `package.json:34`, `apps/api/package.json:7`, `render.yaml:16` и `.github/workflows/ci.yml:30`. На exact Node 24.20.0 + pnpm 9.15.0 выполнены frozen install и полный `pnpm run ci`: audit gates, lint, typecheck, tests и builds green 2026-09-06. GitHub run `34048623246` также green для Quality/PGlite и PostgreSQL 16; `docs/audit/evidence/hosted-ci-foundation.json` привязывает evidence к SHA.
- **Expected:** install/lint/typecheck/test/build и deployment проходят на одной явно поддерживаемой Node 24 version.
- **Actual:** repo-controlled config и локальный полный quality/build pipeline подтверждены exact Node 24.20.0; corrected GitHub Actions run green на Node 24/PostgreSQL 16. Vercel/Render build и deploy этого snapshot намеренно не выполнялись и не подтверждены.
- **Repro:** clean checkout с Node 24 → frozen install → `pnpm run ci`; сравнить hosting runtime metadata.
- **Risk:** локально зелёная работа ломается в CI/hosting или наоборот.
- **Verification:** local quality/build gate и GitHub quality + PostgreSQL lanes green на одном commit SHA; Vercel/Render build/smoke остаются отдельным approval-bounded deploy gate.
- **Dependencies:** OPS-004 release evidence; Q-OPS-002.
