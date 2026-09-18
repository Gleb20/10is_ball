# Backlog аудита Tab-10

Живой backlog после [baseline-аудита](audits/2026-09-06-baseline.md). Порядок
внутри файла не заменяет поле Priority. Каждый canonical finding имеет один
уникальный heading; ссылки на ID разрешены в других документах.

Допустимые статусы: `confirmed` → `ready` → `in_progress` → `verified_local` →
`verified_prod` → `done`; `blocked_decision` используется до принятого ADR.
Внешняя зависимость фиксируется в `Dependencies`, но не создаёт новый status.
Правила ведения — в [WORKFLOW.md](WORKFLOW.md).

Wave A (`BUG-004..016`, `GAP-001`, `OPS-005`) интегрируется по
[`OPS-004 completion waves`](test-plans/OPS-004-completion-waves.md). Frozen
source evidence от 2026-09-07 остаётся историческим `verified_local` evidence;
текущая интеграция сохраняет статус `in_progress`, пока общий API/PostgreSQL/CI и
browser desktop/390 gates не приняты. Свежий web gate 2026-09-13: typecheck green,
focused Wave A 59/59 и полный web suite 125/125.

## Security и права

### SEC-001 — Ротация скомпрометированного доступа к БД

- **Type:** security
- **Priority:** P0
- **Status:** verified_prod
- **Evidence:** live-looking Neon credential находился в `apps/api/.env.example`; baseline сохранён в `docs/audits/2026-09-06-baseline.md:93`. 2026-09-06 Neon control plane завершил reset роли `neondb_owner`, Render получил новый secret и вышел в `live`; sanitized evidence: [`sec-001-production-rotation.json`](audit/evidence/sec-001-production-rotation.json). Текущий repo scan: `docs/audit/evidence/secret-scan.json:15` (`candidates=[]`).
- **Expected:** старый credential отозван в Neon, Render использует новый secret, старый доступ отрицательно проверен; значения не попадают в код/логи/docs.
- **Actual:** пароль Neon-роли ротирован; terminal operations `apply_config`/`epc_sync` завершены, Render deploy `dep-daerpe8u01pc73fpfh80` использует новый `DATABASE_URL`, `SEED_ADMIN=0`, direct и proxied health отвечают 200. Отозвано 26 admin-сессий, active осталось 0. Независимый login старым URL не выполнен: Neon plugin не принимает произвольный retained URI, поэтому пункт не переводится в `done`.
- **Repro:** проверить историю репозитория на secret fingerprint и состояние credential в Neon/Render без публикации значения.
- **Risk:** несанкционированное чтение, изменение или удаление production-данных.
- **Verification:** control-plane reset завершён → Render env merge/deploy `live` → startup logs без auth/fatal ошибок → direct/proxy health 200 → active admin sessions 0 → repo secret scan 0. Остаётся независимое доказательство authentication failure старого credential безопасным инструментом.
- **Dependencies:** безопасный arbitrary-URI negative probe; затем SEC-004 и OPS-004.

### SEC-002 — Password hash в ответе профиля

- **Type:** security
- **Priority:** P0
- **Status:** verified_prod
- **Requirements:** PROFILE-001, PROFILE-003, NFR Security §4, AT-PROFILE-001.
- **Evidence:** Historical Red API test зафиксировал 19 DB-полей, включая `passwordHash`, `blockedAt`, `lastLoginAt` и storage path. Текущий `updateProfile` возвращает отдельный `OwnProfileUser` allowlist; regression test `API_PATCH_me_profile__PROFILE_003__AT-PROFILE-001__response_allowlist__SEC-002` проверяет точный набор 13 полей (10 `AuthUser` + 3 profile fields).
- **Expected:** ни один HTTP response/log не содержит password hash или другие внутренние auth-поля.
- **Actual:** успешное обновление профиля сериализует только `id`, `email`, `role`, `status`, `firstName`, `lastName`, `birthDate`, `organizationText`, `positionText`, `mustChangePassword`, `avatarKey`; исправление входит в опубликованный foundation SHA `6892d6e6fe79425eadf76c39bf052500bde5055a`.
- **Repro:** войти, вызвать `PATCH /api/v1/me/profile`, проверить поле `user.passwordHash`.
- **Risk:** раскрытие verifier повышает последствия XSS, логирования и утечки ответа.
- **Verification:** focused Red → Green (1/1), полный `auth.integration.test.ts` 9/9, API suite 84 passed + 3 real-PostgreSQL skipped, API typecheck passed; grep review подтвердил, что остальные HTTP user responses уже используют `AuthUser` или route-level projection. Полный `pnpm run ci` прошёл на bundled Node 24.19.0: audit gates, lint, typecheck, 517 shared + 1 todo, 4 test-utils, 70 web, 84 API + 3 real-PostgreSQL skipped, API/web builds.
- **Non-goals:** полный GET/edit/avatar/public-profile flow из GAP-002 и переименование существующего route.
- **Permissions:** только локальные code/test/docs changes; production deploy и production mutation не входят в scope.
- **Open questions:** нет.
- **Dependencies:** exact-SHA release/smoke закрыт evidence OPS-004; полный profile flow остаётся GAP-002.

### SEC-003 — Обход обязательной смены временного пароля

- **Type:** security
- **Priority:** P0
- **Status:** verified_local
- **Evidence:** `requireAuth` в [`app.ts`](../apps/api/src/app.ts) разрешает URL через `req.url.includes(...)`, включая совпадение в query string. Точные точки: `apps/api/src/app.ts:115`, `apps/api/src/app.ts:117`.
- **Expected:** пользователь с `mustChangePassword=true` может вызвать только точные allowlisted route+method.
- **Actual:** auth gate сравнивает точную пару HTTP method + matched router path;
  query/encoding/subroute не расширяют три разрешённые пары.
- **Repro:** с temporary-password session вызвать mutation с query, содержащим `/auth/me` или `/auth/logout`.
- **Risk:** аккаунт получает продуктовые возможности до установки постоянного пароля.
- **Verification:** exact bypass matrix green в `auth.integration.test.ts`; полный
  local release barrier обязателен перед `verified_prod`.
- **Dependencies:** нет.

### SEC-004 — Fail-open bootstrap администратора

- **Type:** security
- **Priority:** P0
- **Status:** verified_prod
- **Evidence:** baseline-аудит зафиксировал Render default `SEED_ADMIN=1` и fallback credentials; current [`render.yaml`](../render.yaml) задаёт default-off в `render.yaml:22`. Bootstrap возвращает atomic `existing`/`provisioned` outcomes в `apps/api/src/bootstrap-admin.ts:121` и `apps/api/src/bootstrap-admin.ts:127`; создание и durable system audit выполняются в одной транзакции в `apps/api/src/modules/auth/auth-service.ts:537` и `apps/api/src/modules/auth/auth-service.ts:562`. Focused concurrency/audit characterization находится в `apps/api/src/bootstrap-admin.integration.test.ts:16`.
- **Expected:** production startup fail-closed без явно заданных secrets; bootstrap одноразовый, аудируемый и отключаемый.
- **Actual:** baseline был fail-open; published foundation требует точный opt-in и явные valid values, ставит Render default `0`, не ротирует существующего active admin, атомарно различает созданную и уже существующую запись и пишет один durable audit event в той же транзакции. SHA `6892d6e6fe79425eadf76c39bf052500bde5055a` подтверждён GitHub CI, Render, Vercel и exact-SHA smoke.
- **Repro:** запустить production-like API без части `SEED_ADMIN_*`, изучить созданного/существующего admin.
- **Risk:** полный захват приложения.
- **Verification:** independent focused foundation run прошёл 40/40 tests в 7 files: bootstrap unit 12, bootstrap persistence 1, test DB guard 9, migration URL 7, runtime audit 7, safe log 2, env loader 2; live `SEED_ADMIN=0`, GitHub run `34195797553`, Render `live`, Vercel `READY` и public smoke подтверждены evidence OPS-004.
- **Dependencies:** SEC-001; решение о production bootstrap в Q-OPS-002 желательно, но fail-closed не зависит от него.

### SEC-005 — Уязвимые production dependencies

- **Type:** security
- **Priority:** P0
- **Status:** verified_local
- **Evidence:** `pnpm audit --prod --json` 2026-09-06T16:11:41.852Z: 17 advisories — 12 high, 5 moderate, 0 critical; среди затронутых цепочек Drizzle и `find-my-way`. Current lock points: `pnpm-lock.yaml:3054`, `pnpm-lock.yaml:3225`. Immutable baseline сохраняет свой исторический результат без переписывания.
- **Expected:** нет известных high/critical advisories в production graph либо есть документированное исключение с компенсацией.
- **Actual:** Fastify 5.12.3 и Drizzle 0.45.2 устраняют high цепочки; production
  graph содержит 0 high/critical и 3 documented moderate React Router findings.
- **Repro:** `pnpm audit --prod` на зафиксированном lockfile.
- **Risk:** SQL injection/DoS и supply-chain exposure в зависимости от достижимости.
- **Verification:** frozen install и `pnpm audit --prod --audit-level high`
  прошли; evidence в `audit/evidence/sec-005-production-dependencies.json`.
- **Dependencies:** совместимость Fastify/Drizzle и реальный PostgreSQL test.

### SEC-006 — Organizer-only операции доступны любому вошедшему

- **Type:** authorization
- **Priority:** P0
- **Status:** verified_local
- **Evidence:** handlers start match, add participant/guest и generate/regenerate bracket в [`app.ts`](../apps/api/src/app.ts) не передают/не проверяют actor как владельца. Точные точки без actor: `apps/api/src/app.ts:564`, `apps/api/src/app.ts:960`, `apps/api/src/app.ts:1060`.
- **Expected:** start матча выполняет только creator/organizer; управление roster/bracket — только organizer соответствующего турнира.
- **Actual:** services получают actor и server-side отклоняют non-owner start,
  direct roster и bracket mutation без side effects.
- **Repro:** user B вызывает указанные endpoints для сущности user A.
- **Risk:** подмена состава, сетки и спортивного результата.
- **Verification:** role/ownership matrix API tests с organizer, participant, active judge, outsider и admin.
- **Dependencies:** ADR D17/D18/D23; cancel-specific drift ведётся в BUG-002.

### SEC-007 — Cross-tournament IDOR при удалении участника

- **Type:** authorization
- **Priority:** P0
- **Status:** verified_local
- **Evidence:** participant removal в [`TournamentService`](../apps/api/src/modules/tournaments/tournament-service.ts) обновляет строку по participant ID без совместного ограничения tournament ID. Точная точка predicate: `apps/api/src/modules/tournaments/tournament-service.ts:301`.
- **Expected:** participant mutation требует совпадения route tournament, participant tournament и organizer actor.
- **Actual:** participant сначала разрешается внутри route tournament, а SQL
  mutation ограничена одновременно participant и tournament IDs.
- **Repro:** organizer A подставляет participantId турнира B в endpoint турнира A.
- **Risk:** межтенантная порча roster и bracket readiness.
- **Verification:** negative integration test на mismatched IDs и SQL predicate по обоим идентификаторам.
- **Dependencies:** SEC-006.

## Целостность данных и домена

### DATA-001 — Request validation и доменные invariants не применяются

- **Type:** correctness
- **Priority:** P0
- **Status:** verified_local
- **Evidence:** routes в [`app.ts`](../apps/api/src/app.ts) в основном приводят `req.body` типами; существующие Zod contracts не являются runtime gate. Пример прямого type assertion без runtime schema: `apps/api/src/app.ts:517`.
- **Expected:** schema validation и сервисные invariants отклоняют пустой/дублирующийся roster, blocked users, неверные side/winner/rules/state transitions без мутаций.
- **Actual:** shared Zod schemas и service invariants fail closed; create и roster
  writes транзакционны, invalid payload/state не меняет rows/version/event log.
- **Repro:** создать пустой/duplicate match; отправить invalid side/winner; stop cancelled match; сравнить state/version.
- **Risk:** невозможные матчи, ошибочная статистика и повреждённый event log.
- **Verification:** table-driven API/domain tests на все границы и отсутствие side effects; transactional create.
- **Dependencies:** MATCH acceptance и DATA-003 constraints.

### DATA-002 — Finish, stats и tournament advancement неатомарны

- **Type:** concurrency
- **Priority:** P0
- **Status:** verified_local
- **Evidence:** [`MatchService`](../apps/api/src/modules/matches/match-service.ts) сохраняет результат/статистику отдельно от hook в [`TournamentService`](../apps/api/src/modules/tournaments/tournament-service.ts); stats используют lost-update-prone read/modify/write. Последовательные точки вне общей транзакции: `apps/api/src/modules/matches/match-service.ts:496`, `apps/api/src/modules/matches/match-service.ts:509`, `apps/api/src/modules/matches/match-service.ts:513`; read/modify/write stats виден в `apps/api/src/modules/matches/match-service.ts:1167` и `apps/api/src/modules/matches/match-service.ts:1188`.
- **Expected:** результат, stats compensation/application и переход сетки образуют идемпотентную транзакцию с CAS/locking.
- **Actual:** match CAS, SQL stats, judge release, tournament row lock/bracket CAS,
  next-match materialization и notifications выполняются одной transaction;
  replay не дублирует effects. DATA-006 legacy V1 DE остаётся отдельным P1.
- **Repro:** параллельно завершить два связанных tournament matches и инъецировать сбой между finish/stats/advance.
- **Risk:** необратимо неверные рейтинги и сетки.
- **Verification:** real-Postgres concurrency tests, fault injection, invariant «один node → один actual match», idempotent replay.
- **Dependencies:** DATA-003; D25 снимает требование совместимости с V1 DE, но не транзакционность поддерживаемого V2.

### DATA-003 — Boot-time DDL заменяет versioned migrations

- **Type:** database
- **Priority:** P1
- **Status:** verified_local
- **Evidence:** [`db/client.ts`](../apps/api/src/db/client.ts) выполняет `CREATE/ALTER IF NOT EXISTS` при старте; миграция содержит PGlite/Postgres-sensitive casts; отсутствует полная система версий и часть constraints/indexes. Точки boot-time DDL: `apps/api/src/db/client.ts:79`, `apps/api/src/db/client.ts:306`.
- **Expected:** упорядоченные reviewable migrations, одинаково проверенные на PGlite и ephemeral PostgreSQL, с DB invariants и rollback/forward plan.
- **Actual:** drift исправляется ad-hoc DDL на каждом boot; destructive/semantic изменения не отслеживаются.
- **Repro:** поднять schema старой версии и сравнить с Drizzle schema; прогнать migration на real PostgreSQL.
- **Risk:** production drift, startup failure, незаметное отсутствие constraints.
- **Verification:** schema snapshot/diff, clean+upgrade real-PG tests, запрет production `DATABASE_URL` в test harness.
- **Dependencies:** SEC-001, OPS-003.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### DATA-004 — Invitation и membership race conditions

- **Type:** concurrency
- **Priority:** P1
- **Status:** verified_local
- **Requirements / acceptance:** TEAM-004/005, TOURNAMENT-005/007/018,
  NOTIF-001/002/005/006; AT-TEAM-001/002/007, AT-TRN-004/019,
  AT-NOTIF-001/002/003/005.
- **Evidence:** Red на Node 24 воспроизвёл 4/4 дефекта: concurrent team/tournament invite возвращал разные invitation IDs, concurrent team accept создавал две active memberships, а expired notification оставалась `new`. Green PGlite DATA-004 suite 4/4 подтверждает pair-level convergence, stable retry, actor/tenant no-op, transactional notification rollback и terminal expiry/cancellation lifecycle. Migration tests 4/4 подтверждают fresh/historical upgrade, deterministic duplicate classification и четыре partial unique indexes.
- **Expected:** один активный invite/membership на пару сущностей; respond/expire идемпотентны; expired notification перестаёт быть actionable/new.
- **Actual:** current integrated checkout сериализует invite/add/respond/bracket-close по parent row, выполняет invitation, membership/participant и notification changes одной transaction и защищает результат четырьмя partial unique indexes. Повтор pending invite возвращает существующий ID без второй notification; повтор terminal response возвращает сохранённый outcome; expired/cancelled notifications становятся read и не actionable/new.
- **Repro:** до исправления одновременно отправить одинаковые invite/respond requests; regression сохранён в `apps/api/src/data-004.integration.test.ts`.
- **Risk:** двойное членство, неверные badge/actions, нестабильные roster counts.
- **Verification:** focused API DATA-004 4/4; migration/schema-drift 4/4; API typecheck, web typecheck и focused notification component 1/1 green. Final combined root Node 24.19.0 `pnpm run ci` green: docs/routes/secrets/busy-bye audits, lint/typecheck, shared 518, test-utils 4, web 88, API 128 + 7 guarded real-PostgreSQL tests skipped, API/web builds. `TEST_DATABASE_URL` отсутствовал, поэтому два новых DATA-004 PostgreSQL concurrency tests не выполнялись; production migration/release не выполнялись.
- **Test plan:** [`test-plans/DATA-004-invitation-membership-races.md`](test-plans/DATA-004-invitation-membership-races.md).
- **Non-goals / permissions:** UI redesign, generic notification redesign,
  production migration/deploy, external Neon branch and other backlog items are
  excluded. Only disposable PGlite and guarded loopback PostgreSQL are allowed.
- **Open questions:** none; canonical requirements already define the outcome.
- **Dependencies:** DATA-003 migration foundation; guarded real-PostgreSQL execution и production release остаются отдельными gates.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### DATA-005 — Standalone void и immutable audit отсутствуют

- **Type:** data-governance
- **Priority:** P0
- **Status:** verified_local
- **Evidence:** target actor/soft-invalidation policy принят в `docs/DECISIONS.md:131` (D24); current service всё ещё физически удаляет match в `apps/api/src/modules/matches/match-service.ts:1146`, а текущая audit table не является immutable sporting ledger (`apps/api/src/db/schema.ts:314`).
- **Expected:** finished/stopped standalone match может void только active admin или creator; reason optional, second approver отсутствует, UI требует explicit confirmation. Исходные result/events/version и immutable actor/timestamp audit сохраняются, stats/ranking компенсируются идемпотентно в одной операции; hard delete запрещён.
- **Actual:** forward migration `0001` добавляет `voided` и append-only
  `match_void_audits`; creator/active-admin flow сохраняет facts, компенсирует
  stats once и запрещает terminal hard purge.
- **Repro:** finished standalone удалить через current admin endpoint и проверить отсутствие match/source audit; отдельно вызвать отсутствующий creator/admin void flow.
- **Risk:** потеря спортивной истории и недоказуемая/неполная коррекция рейтинга.
- **Verification:** AT-MATCH-VOID-001..003 и AT-ADM-MATCH-005/007; creator/admin/participant/judge/outsider matrix, ledger/standalone compensation/idempotency tests; доказать отсутствие hard-delete finished route и browser confirmation.
- **Dependencies:** ADR D19/D24; DATA-002/003 для atomic compensation и durable schema. Tournament downstream policy вынесена в DATA-007.

### DATA-006 — Legacy V1 double-elimination отклоняется до legacy execution

- **Type:** legacy-data
- **Priority:** P1
- **Status:** verified_local
- **Requirements:** TOURNAMENT-019; AT-TRN-015; ADR D25.
- **Evidence:** Red на Node 24: deterministic slot-proxy test вошёл в `KNOWN_V1_DE_HANG_PATH_ENTERED`, parser вернул playable `v1`, loader выдал старый `BRACKET_UNSUPPORTED`, а start/edit/regenerate/dissolve вернули HTTP 200. Green: shared parser/generator/lifecycle guards возвращают единый `UNSUPPORTED_BRACKET_VERSION` до slot traversal; PGlite API matrix 5/5 подтверждает четыре отказа без mutation и сохранённый V1 SE start.
- **Expected:** legacy schemaVersion 1 DE отклоняется bounded `UNSUPPORTED_BRACKET_VERSION` без mutation/migration/reset; поддерживаемый V2 SE/DE lifecycle остаётся рабочим, V1 SE не меняется.
- **Actual:** current integrated checkout code классифицирует V1 DE как unsupported до чтения slots; exported V1 DE generator и lifecycle helpers fail closed; API start/edit/regenerate/dissolve возвращают HTTP 400 и сохраняют исходное persisted state. V1 SE и V2 SE/DE regressions green.
- **Repro:** `pnpm --filter @tab10/shared test -- src/tournament-bracket-v1.characterization.test.ts src/tournament-bracket-v1.test.ts src/bracket-v2/bracket-v2.test.ts`; `pnpm --filter @tab10/api test -- src/modules/tournaments/bracket-load.test.ts src/legacy-bracket.integration.test.ts`.
- **Risk:** malformed/legacy input может удерживать процесс и делать tournament operation недоступной.
- **Verification:** focused shared 29/29; focused API 7/7; full shared property suite green; focused V2 SE/DE API lifecycle green; shared/API typecheck green. Общий combined CI фиксируется после интеграции.
- **Non-goals:** V1 DE migration/read rendering, production data operation, V2 redesign, DATA-002 transaction repair и GAP-006 browser lifecycle.
- **Permissions:** только local code/test/docs; production/deploy/commit/push/version bump не выполнялись.
- **Open questions:** нет.
- **Dependencies:** ADR D25 выполнен; любой production reset/recreate остаётся отдельной approval-gated OPS action, не частью этого item.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### DATA-007 — Турнирный void с сыгранными downstream-матчами не определён

- **Type:** data-governance
- **Priority:** P0
- **Status:** verified_local
- **Evidence:** D33 закрыл Q-MATCH-003 policy `preserve_bracket_and_downstream`;
  integration test сравнивает bracket JSON/version, downstream rows,
  notifications и unrelated stats до/после.
- **Expected:** один наблюдаемый outcome для void upstream tournament result после сыгранных downstream matches, с атомарными ledger/compensation/bracket invariants и без hard delete.
- **Actual:** меняются только target match, его stats и одна audit row. Уже
  выполненное продвижение и downstream history не пересчитываются.
- **Repro:** завершить upstream tournament match, сыграть материализованный downstream match и попытаться исправить upstream result.
- **Risk:** молчаливое каскадное повреждение сетки, статистики и уже сыгранной спортивной истории.
- **Verification:** AT-MATCH-VOID-004 PGlite equality/replay test green; общий
  PostgreSQL void replay/append-only и release barrier обязательны перед prod.
- **Dependencies:** D33; DATA-002/003/005.

## Функциональные и UI-дефекты

### BUG-001 — Видимость активных и завершённых событий не соблюдается

- **Type:** authorization
- **Priority:** P0
- **Status:** verified_local
- **Evidence:** list/detail match и tournament routes в [`app.ts`](../apps/api/src/app.ts) возвращают глобальные данные любому authenticated user; tutorial может попадать в списки. Глобальные service calls без actor/scope: `apps/api/src/app.ts:510`, `apps/api/src/app.ts:546`, `apps/api/src/app.ts:876`, `apps/api/src/app.ts:915`.
- **Expected:** active — только organizer, participants, current active judge; completed — все active non-blocked club users; tutorial изолирован.
- **Actual:** match/tournament list/detail/home применяют D17 actor scope;
  terminal events club-visible только active users, tutorial изолирован.
- **Repro:** создать active event user A, запросить list/detail user B; повторить для completed/blocked/tutorial.
- **Risk:** утечка закрытых событий и несоответствие HISTORY-003.
- **Verification:** AT-VIS-001..004 на list/detail/home/history для всех ролей и статусов.
- **Dependencies:** ADR D17; SEC-006.

### BUG-002 — Права start, early stop и cancel шире целевой модели

- **Type:** authorization
- **Priority:** P0
- **Status:** verified_local
- **Evidence:** start handler не передаёт actor (`apps/api/src/app.ts:564`); [`MatchService.stopMatch`](../apps/api/src/modules/matches/match-service.ts) использует manager check, где participant проходит в `apps/api/src/modules/matches/match-service.ts:868` и active judge — в `apps/api/src/modules/matches/match-service.ts:876`. Тот же check вызывается cancel в `apps/api/src/modules/matches/match-service.ts:1047`, поэтому participant/judge получают право вопреки D23.
- **Expected:** start — только creator/organizer; early stop — creator/organizer или current active judge; cancel — только active admin или creator, reason optional, с явным UI confirmation и server actor/state/version/idempotency checks.
- **Actual:** server actor matrix соответствует D18/D23; cancel/force-close имеют
  strict version + UUID key, CAS, replay и atomic judge release.
- **Repro:** вызвать start outsider; stop обычным participant без judge session; cancel participant и active judge, которые не creator/admin.
- **Risk:** несанкционированный запуск, искажение результата или отмена чужого матча.
- **Verification:** AT-MATCH-START-001, AT-MATCH-STOP-001/002 и AT-MATCH-CANCEL-001..004 с creator/admin/participant/judge/outsider actor matrix и browser confirmation.
- **Dependencies:** ADR D18/D23; DATA-001 для request/version validation.

### BUG-003 — Быстрый двойной `+1` теряет очко

- **Type:** concurrency-ui
- **Priority:** P0
- **Status:** verified_local
- **Evidence:** [`JudgePage.tsx`](../apps/web/src/pages/JudgePage.tsx) отправляет два запроса с одним `expectedVersion`; второй conflict не ставится в очередь. `point()` читает текущую version до await в `apps/web/src/pages/JudgePage.tsx:209` и кнопка остаётся доступна в `apps/web/src/pages/JudgePage.tsx:417`.
- **Expected:** каждое намеренное нажатие либо сериализовано и применено один раз, либо UI явно блокирует повтор до sync.
- **Actual:** UI ставит каждое намерение в FIFO с отдельным key и следующей
  authoritative version; conflict очищает очередь, reload-ит score и явно
  сообщает о неначисленном действии.
- **Repro:** быстро нажать `+1` дважды до завершения первого request.
- **Risk:** неверный счёт в основном продуктовым флоу.
- **Verification:** fake-latency component test + browser test; проверить idempotency и итог +2.
- **Dependencies:** DATA-001/DATA-002 API invariants.

### BUG-004 — Judge lock не освобождается при выходе

- **Type:** lifecycle
- **Priority:** P1
- **Status:** verified_local
- **Evidence:** deterministic pre-fix component Red: Cancel/Back не ждали release, destination result отсутствовал. Current integrated checkout `JudgePage` объединяет normal exits одним guarded best-effort release; `AppShell` показывает success/warning notice. Plain unmount не вызывает release.
- **Expected:** явный выход освобождает lock best-effort и навигация показывает результат; crash остаётся за TTL.
- **Actual:** current integrated checkout Back, Cancel и explicit exit ожидают release перед навигацией; при failure всё равно переходят с warning и оставляют cleanup TTL. Production остаётся на прежнем release.
- **Repro:** acquire → Back/Cancel → открыть judge другим пользователем.
- **Risk:** матч временно нельзя судить.
- **User-visible outcome:** Cancel, Back и явный выход сначала делают один best-effort release, затем всегда переходят к матчу/турниру с понятным success/warning результатом; простой unmount не подменяет crash safety и не отправляет release.
- **Non-goals:** `beforeunload`/crash release, handover, score transaction, redesign, production/deploy/version bump.
- **Permissions:** только local code/tests/docs, ephemeral PGlite и local browser fixtures; production/external services не изменяются.
- **Open questions:** нет — normal exits и TTL fallback уже заданы JUDGE-006/008.
- **Verification:** [`test-plans/BUG-004-005-judge-lifecycle.md`](test-plans/BUG-004-005-judge-lifecycle.md); `JudgePage.test.tsx` 18/18 + `layout.test.tsx` 3/3, API domain 32/32. In-app Browser 1280×800 подтвердил Cancel, Back и explicit release, destination success и `Судья не назначен`; failure/unmount детерминированы component tests. Final combined root Node 24.19.0 `pnpm run ci` green: shared 518, test-utils 4, web 88, API 128 + 7 guarded real-PostgreSQL tests skipped, audits/lint/typecheck/builds.
- **Dependencies:** BUG-005.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### BUG-005 — Judge UI игнорирует потерю lock и внешние изменения

- **Type:** live-state
- **Priority:** P1
- **Status:** verified_local
- **Evidence:** deterministic pre-fix component Red подтвердил отсутствие lost-lock state, authoritative sync и visibility-aware cleanup. Current integrated checkout использует один guarded 30-second loop, ownership ref и отдельную lost-lock phase.
- **Expected:** lost lock немедленно блокирует scoring; активный экран синхронизируется с server state и polling паузится/возобновляется по visibility.
- **Actual:** current integrated checkout heartbeat `401/403/409` или lost code очищает point queue, блокирует mutations и refetch-ит match; external terminal state становится read-only. Hidden polling остановлен, visible resume синхронизирует немедленно и создаёт один timer. Production остаётся на прежнем release.
- **Repro:** acquire, отозвать/expire session или изменить match другим клиентом, наблюдать экран.
- **Risk:** ошибочные действия, конфликтный UX, недоверие к счёту.
- **User-visible outcome:** heartbeat 401/403/409 или lost-session code немедленно очищает pending score intents, скрывает score mutations, показывает lost-lock alert и best-effort синхронизирует server match; external terminal state становится read-only без reload.
- **Non-goals:** WebSocket/SSE, general BUG-007 auth redirect, server score transaction, handover, redesign, production/deploy/version bump.
- **Permissions:** только local code/tests/docs, ephemeral PGlite и local browser fixtures; production/external services не изменяются.
- **Open questions:** нет.
- **Verification:** [`test-plans/BUG-004-005-judge-lifecycle.md`](test-plans/BUG-004-005-judge-lifecycle.md); component 401/403/409, external terminal, hidden→visible, duplicate timer/cleanup green. API 401 + expired/released `409 JUDGE_NOT_ACTIVE` green. In-app Browser 390×844 с внешней отменой из второй auth session показал lost-lock, authoritative cancelled match и отсутствие score/Undo controls. Final combined root Node 24.19.0 `pnpm run ci` green: shared 518, test-utils 4, web 88, API 128 + 7 guarded real-PostgreSQL tests skipped, audits/lint/typecheck/builds.
- **Dependencies:** OPS-002 observability полезна, но не блокирует.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### BUG-006 — Ошибка action скрывает весь экран матча

- **Type:** error-handling
- **Priority:** P1
- **Status:** verified_local
- **Requirements / acceptance:** общие UI rules; AT-UI-001/002.
- **Evidence:** Red component test подтвердил, что общий error state заменяет уже загруженную карточку после rejected Stop. Working tree разделяет load/action errors и сохраняет title/score/participants/navigation с локальным alert.
- **Expected:** mutation error показывается рядом с действием, уже загруженные данные остаются видимыми.
- **Actual:** текущая интегрированная реализация сохраняет загруженные данные и показывает action-local alert; production остаётся на прежнем поведении до release.
- **Repro:** viewer открывает match и нажимает доступную Stop; получить 403.
- **Risk:** пользователь теряет навигационный контекст и не понимает права.
- **User-visible outcome:** mutation failure остаётся рядом с actions; loaded match title/score и навигация не исчезают, повторное действие доступно после settle.
- **Non-goals / permissions:** BUG-007 auth redirect, BUG-008 polling, redesign, production/deploy/commit/push/version bump исключены.
- **Open questions:** нет.
- **Verification:** [`test-plans/BUG-006-009-action-resilience.md`](test-plans/BUG-006-009-action-resilience.md); Red→Green component test «loaded data survives action error», focused web/typecheck, full Node 24 CI и desktop/mobile browser smoke.
- **Local evidence (2026-09-07):** focused merged web matrix 36/36 и API auth/DATA-004 matrix 15/15 green; web/API typechecks и diff check green. In-app Browser подтвердил stale Stop reject с сохранёнными title, score `0 : 0`, participants и navigation на 1280×800 и 390×844; mobile `scrollWidth=clientWidth=390`, console errors отсутствуют. Final combined root Node 24.19.0 `pnpm run ci` green: shared 522, test-utils 4, web 111, API 131 + 7 guarded PostgreSQL skips, audits/lint/typecheck/builds.
- **Dependencies:** BUG-002, BUG-009.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### BUG-007 — Истёкшая/отозванная сессия не ведёт на login

- **Type:** auth-ui
- **Priority:** P1
- **Status:** verified_local
- **Evidence:** deterministic pre-fix Red 2/2: API client после первого `401` выполнил второй fetch, а `/matches/new` сохранил authenticated screen вместо login. Current integrated checkout общий client latch/event, `AuthProvider` и protected-route `Activity` recovery проходят focused 4/4; внешний return target отклоняется.
- **Expected:** 401 очищает auth state, сохраняет безопасный return path и показывает login без reload loop.
- **Actual:** current integrated checkout первый runtime `401` очищает user и блокирует следующие protected requests до успешного `login`/`me`; login с Email focus показывается на том же route, hidden `Activity` сохраняет draft и приостанавливает effects. Успешный вход возвращает route/draft, mutation не replay-ится. Production остаётся на прежнем release.
- **Repro:** открыть приложение, отозвать session, выполнить API action.
- **Risk:** полурабочая UI-сессия и потеря введённых данных.
- **User-visible outcome:** истёкшая/отозванная сессия сразу показывает понятный повторный вход; после него пользователь возвращается к безопасному внутреннему route с незавершённой формой, а не повторяет ввод с нуля.
- **Non-goals:** automatic retry мутаций, offline draft persistence после reload/crash, изменение server session TTL/revocation, first-password redesign, production/deploy/version bump.
- **Permissions:** только local code/tests/docs и disposable local browser fixture; production/external services не изменяются.
- **Open questions:** нет — AUTH-001/006 и AT-AUTH-009 задают поведение.
- **Verification:** [`test-plans/BUG-007-runtime-auth-recovery.md`](test-plans/BUG-007-runtime-auth-recovery.md); focused API-client/router/AuthProvider 4/4, web typecheck и full web 92/92 green. In-app Browser на 1280×800 и 390×844 подтвердил revoke → focused login → re-login → тот же `/matches/new` и сохранённые title/guest values; mobile document width 390, app errors/framework overlay отсутствуют. Full item bundled Node 24.19.0 CI-mode run green: docs/routes/secrets/busy-bye audits, lint/typecheck, shared 518, test-utils 4, web 92, API 128 + 7 guarded PostgreSQL skips и API/web builds. Первый TTY run имел runner-only `onTaskUpdate` timeout после 518/518 shared assertions; controlled non-interactive run устранил transport failure. Final combined root CI green: shared 522, test-utils 4, web 111, API 131 + 7 skips and both builds.
- **Dependencies:** нет.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### BUG-008 — Активные списки и детали остаются устаревшими

- **Type:** live-state
- **Priority:** P1
- **Status:** verified_local
- **Requirements:** LIVE-001, D27, AT-LIVE-001/002; JUDGE-008/AT-JUDGE-009 остаются отдельным совместимым loop.
- **Evidence:** pre-fix Red не мог импортировать отсутствующий shared refresh primitive; прежние Home/list/details выполняли только mount snapshot. Current integrated checkout использует один coalescing visible-only 30-second loop с immediate visible resume, cleanup, terminal-detail stop и ручным refresh.
- **Expected:** active state обновляется с принятой частотой, при возврате вкладки выполняется refresh, есть ручной retry.
- **Actual:** Home, match/tournament lists и active details синхронизируются каждые 30 секунд только при visible document; initial/background errors допускают retry без потери последнего валидного экрана. JudgePage не получает второй timer.
- **Repro:** открыть событие в двух браузерах, изменить в одном, наблюдать второй.
- **Risk:** ложные решения организатора/участника.
- **User-visible outcome:** статус, счёт и tournament state обновляются без navigation/reload; «Обновить» доступно на каждой live surface, а background failure не скрывает уже загруженные данные.
- **Non-goals:** WebSocket/SSE, server push, JudgePage heartbeat redesign, auth redirect BUG-007, form submission BUG-009, production/deploy/version bump.
- **Permissions:** только local code/tests/docs, disposable PGlite и local Browser fixture; production/external services не изменяются.
- **Open questions:** нет — D27 фиксирует cadence и границы.
- **Verification:** [`test-plans/BUG-008-live-refresh.md`](test-plans/BUG-008-live-refresh.md); focused web 20/20 и typecheck green. Local in-app Browser: desktop two-client match start обновил Home `Ожидание → Идёт`; 390×844 two-client tournament cancel обновил detail `Сбор → Отменён` без horizontal overflow. Console errors отсутствуют; только известные React Router future warnings. Item worktree full bundled Node 24.19.0 / pnpm 9.15.0 `pnpm run ci` green: audits/lint/typecheck/build, shared 518, test-utils 4, web 97, API 128 + 7 guarded real-PostgreSQL tests skipped. Final combined root CI green: shared 522, test-utils 4, web 111, API 131 + 7 skips and both builds.
- **Dependencies:** BUG-001 visibility filters verified locally; production release остаётся отдельным gate.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### BUG-009 — Формы допускают duplicate submissions

- **Type:** interaction
- **Priority:** P1
- **Status:** verified_local
- **Requirements / acceptance:** общие UI rules; AUTH-004, ADM-003, TEAM-001/004/005, TOURNAMENT-001/005, HELP-003, ONB-001/003; AT-UI-002, AT-TEAM-007, AT-TRN-019.
- **Evidence:** Red parameterized component matrix получила два API calls от sync double-submit на admin/team/tournament/feedback и два tutorial calls плюс competing skip. Red API race вернул `200 + 500` для одного normalized email. Working tree использует общий ref-backed single-flight guard и target-compatible unique-conflict mapping.
- **Expected:** submit блокируется на время request; server idempotency/uniqueness защищает критические create/respond operations.
- **Actual:** текущая интегрированная реализация допускает только один in-flight request на scoped surface; normalized email conflict возвращает 409 и оставляет одну строку. Production остаётся на прежнем поведении до release.
- **Repro:** double-click submit под network throttling на каждой форме.
- **Risk:** дубли сущностей, приглашений и противоречивый UI.
- **User-visible outcome:** связанные CTA disabled с pending label, sync double-click/tap запускает один request, а ошибка возвращает форму в actionable state без потери контекста.
- **Non-goals:** новые idempotency contracts/schema для team/tournament/feedback/tutorial create, full onboarding/teams/tournament redesign и unrelated forms.
- **Permissions:** только local code/tests/docs и disposable PGlite/browser fixture; production/external mutation, deploy, commit/push/tag/version bump запрещены.
- **Open questions:** нет; client guard дополняет, но не заменяет `users_email_unique` и DATA-004 invitation/membership safeguards.
- **Verification:** [`test-plans/BUG-006-009-action-resilience.md`](test-plans/BUG-006-009-action-resilience.md); parameterized component matrix, concurrent normalized-email API test, DATA-004 regression, typechecks, full Node 24 CI и desktop/mobile browser.
- **Local evidence (2026-09-07):** deterministic deferred component tests подтвердили disabled pending labels и один request для admin/team/tournament/feedback/first-password/onboarding/invitation/match actions; browser `dblclick` создал ровно одну matching user row на 1280×800 и 390×844. Concurrent case-insensitive email API race даёт `[200,409]`, публичный `EMAIL_ALREADY_EXISTS` и одну persisted row. Focused/full evidence общее с BUG-006; 7 guarded real PostgreSQL tests не запускались без `TEST_DATABASE_URL`, production не изменялась.
- **Dependencies:** DATA-003/DATA-004.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### BUG-010 — Self-challenge создаёт self-vs-self матч

- **Type:** domain-ui
- **Priority:** P1
- **Status:** verified_local
- **Evidence:** до исправления deterministic component Red 2/2 подтвердил self CTA на podium и принятие подставленного `opponentId=currentUserId`. DATA-001 уже обеспечивал серверный distinct-user invariant и no-write `AT-MATCH-013`; дефект оставался только в web affordance/query prefill.
- **Expected:** current user нельзя выбрать/передать на обе стороны; backend отклоняет duplicate participant независимо от UI.
- **Actual:** current integrated checkout ranking скрывает `Вызов` только для собственной строки; create wizard отбрасывает self-prefill, показывает `Нельзя вызвать самого себя` и не вызывает API. Production остаётся на прежнем release.
- **Repro:** regression сохранён в `RankingsPage.test.tsx` и `MatchCreatePage.test.tsx`; серверный self-vs-self no-write — в `match-validation.integration.test.ts`.
- **Risk:** невозможный матч и испорченная статистика.
- **User-visible outcome:** пользователь видит challenge CTA у соперников, но не у себя; подмена URL не создаёт матч и объясняется inline-ошибкой.
- **Non-goals:** ranking redesign/public profile, полный 2v2 wizard, BUG-009 duplicate-submit matrix, production/deploy/version bump.
- **Permissions:** только local code/tests/docs, disposable PGlite и local browser fixture; production/external services не изменяются.
- **Open questions:** нет — MATCH-003 и AT-MATCH-013 уже определяют distinct-user outcome.
- **Verification:** [`test-plans/BUG-010-self-challenge.md`](test-plans/BUG-010-self-challenge.md); component Red 2/2 → Green 4/4, API validation 7/7. In-app Browser на 1280×800 и 390×844 подтвердил отсутствие self CTA, сохранение двух rival CTA и fail-closed self-query без навигации/создания. Final combined root Node 24.19.0 `pnpm run ci` green: shared 518, test-utils 4, web 90, API 128 + 7 guarded real-PostgreSQL tests skipped, audits/lint/typecheck/builds.
- **Dependencies:** DATA-001.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### BUG-011 — Admin UI не поддерживает безопасный unblock

- **Type:** admin-ui
- **Priority:** P1
- **Status:** verified_local
- **Evidence:** до исправления component Red показывал self-block affordance и отсутствие Unblock, а API Red подтверждал успешный self-block с отзывом текущей admin session при наличии второго admin.
- **Expected:** unblock доступен для blocked target; self/last-admin destructive actions скрыты и запрещены сервером.
- **Actual:** local UI показывает Block только для другого active target и Unblock только для blocked target; self Block/role change скрыты. Сервер сохраняет `LAST_ADMIN`, возвращает `SELF_BLOCK_FORBIDDEN` для self-target при наличии другого admin и допускает unblock только через active-admin route. Unblock не оживляет revoked sessions, но разрешает fresh login с прежним действующим паролем; audit содержит block/unblock.
- **Repro:** deterministic Red сохранён в `AdminPage.test.tsx` и `auth.integration.test.ts`; до Green self row содержал Block, blocked row не содержал Unblock, а direct self-block отвечал `200`.
- **Risk:** operational lockout и ручные API-workarounds.
- **User-visible outcome:** администратор безопасно восстанавливает blocked пользователя через явное подтверждение и сразу видит active status; собственный аккаунт нельзя заблокировать ни через UI, ни прямым запросом.
- **Non-goals:** полный ADM search/filter/edit/audit UI, reset-password redesign, транзакционное изменение captain transfer, production/deploy/version bump.
- **Permissions:** только local code/tests/docs, disposable PGlite и local browser fixture; production/external services не изменялись.
- **Open questions:** нет — ADM-005/006, AT-AUTH-008 и D28 задают outcome.
- **Verification:** [`test-plans/BUG-011-safe-unblock.md`](test-plans/BUG-011-safe-unblock.md); component 8/8 и auth/admin API 11/11, web/API typechecks green. In-app Browser на 1280×800 и 390×844 подтвердил status-specific actions, self guard, confirmation, server-refetched active state и отсутствие horizontal overflow; только известные React Router future warnings. Full Node 24 CI — см. test plan/changelog.
- **Dependencies:** нет.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### BUG-012 — Onboarding нельзя надёжно продолжить

- **Type:** state-machine
- **Priority:** P1
- **Status:** verified_local
- **Requirements / acceptance:** ONB-001..005; AT-ONB-001..003; D26.
- **Evidence:** Red на Node 24: API 3/3 и web 2/2 падали из-за отсутствия onboarding fields/route, auto-open/resume и profile restart. Green: PGlite onboarding 4/4, migration/schema 4/4 и web onboarding/single-flight/judge-return 26/26 подтверждают authoritative step, validation/no-write, safe legacy backfill, completion/restart и возврат из tutorial.
- **Expected:** auto-open once после first password, server-persisted resume after interruption, per-step skip, complete/close persistence, manual restart from profile и optional isolated tutorial.
- **Actual:** current integrated checkout auth response возвращает `onboardingStep`/`onboardingCompletedAt`; incomplete user направляется на семь шагов и после нового login/remount продолжает с сохранённого шага. `PATCH /api/v1/me/onboarding` валидирует `set-step|complete|restart`; Profile restart сбрасывает completion/step, а tutorial возвращается на последний шаг. Production остаётся на прежнем release.
- **Repro:** regression сохранён в `onboarding.integration.test.ts`, `onboarding-resume.test.tsx` и tutorial return case `JudgePage.test.tsx`.
- **Risk:** новый пользователь не получает воспроизводимое обучение.
- **User-visible outcome:** после прерывания или нового входа пользователь видит тот же шаг; завершённый/закрытый onboarding сам не открывается, а кнопка профиля начинает его заново.
- **Non-goals:** redesign/spotlight overlay поверх каждой product page, автоматическое завершение onboarding по одному tutorial (D34), GAP-009 help/feedback, production/deploy/version bump.
- **Permissions:** только local code/docs, disposable PGlite и loopback browser fixtures; production/external services не изменялись.
- **Open questions:** нет; Q-ONB-001 закрыт D34: tutorial возвращает на последний шаг, завершение только явной кнопкой.
- **Verification:** [`test-plans/BUG-012-onboarding-resume.md`](test-plans/BUG-012-onboarding-resume.md); focused API/migration/web checks green. Combined Node 24.19.0 CI green: shared 522, test-utils 4, web 116, API 136 passed + 7 guarded PostgreSQL skips. Local Browser evidence from the task chat covers desktop 1280×720 and mobile 390×844 auto-open/resume/complete/restart/tutorial-return.
- **Dependencies:** полный PRD v2 закреплён D26; D34 задаёт explicit completion для once/resume/restart core.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### BUG-013 — Уведомления имеют неполную read/expiry семантику

- **Type:** notifications
- **Priority:** P1
- **Status:** verified_local
- **Evidence:** deterministic Node 24 Red зафиксировал 3/3 API-дефекта: single read использовал wall clock, batch visible-read route отсутствовал, terminal DTO не имел actionable/reason/time contract. Component Red подтвердил отсутствие automatic visible-read. Current integrated checkout API использует injected clock и idempotent `readAt`, owner-scoped `POST /notifications/read-visible`, независимые actionable/read признаки и DATA-004 terminal source timestamps; UI показывает Moscow created/terminal time и причину.
- **Expected:** видимая часть отмечается read по принятому правилу; expired/revoked items не actionable и имеют время/причину.
- **Actual:** current integrated checkout открытие Actual batch-помечает только показанные unread rows; still-pending invitation остаётся actionable и видимой со статусом «Прочитано». Timeout/revocation остаются в истории с `timeout|invitation_revoked`, `lifecycleAt` и без actions. Production остаётся на прежнем release.
- **Repro:** regression сохранён в `bug-013.integration.test.ts` и `NotificationsPage.test.tsx`; local Browser прошёл Actual → History → Home badge loop.
- **Risk:** ложные актуальные действия и шум.
- **User-visible outcome:** просмотр очищает спокойный unread indicator, не отзывает актуальное приглашение и явно объясняет, когда и почему приглашение стало недействительным.
- **Non-goals:** новые notification types/popup/pagination, полный GAP-008 event matrix, redesign, schema migration, production/deploy/version bump.
- **Permissions:** только local code/docs, disposable PGlite и synthetic loopback Browser; production/external services не изменялись.
- **Open questions:** нет; action lifecycle и read state уже раздельны в target data contract.
- **Verification:** [`test-plans/BUG-013-notification-read-lifecycle.md`](test-plans/BUG-013-notification-read-lifecycle.md); focused API BUG-013/DATA-004 7/7, notification component 2/2, API/web typechecks и diff check green. Browser на 1280×800 и 390×844 подтвердил automatic read, cleared Home badge, terminal reason/time, zero revoked actions, `scrollWidth=clientWidth` и отсутствие app console errors. Final combined Node 24 CI evidence записывается перед handoff.
- **Dependencies:** DATA-004.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### BUG-014 — Ranking period boundaries рассчитаны в UTC вместо Europe/Moscow

- **Type:** timezone-correctness
- **Priority:** P1
- **Status:** verified_local
- **Evidence:** deterministic Red 6/6 показал отсутствующие Moscow helpers и прежние UTC boundaries. Current shared unit table 13/13 и PGlite API integration 2/2 доказывают Monday/month `00:00 Europe/Moscow` как абсолютный `21:00Z` предыдущего дня, включая обе стороны границы.
- **Expected:** ranking calendar week/month boundaries используют `Europe/Moscow`, absolute timestamps остаются UTC (ADR D20).
- **Actual:** current integrated checkout `MatchService` фильтрует `finishedAt` по Moscow boundary через explicit shared helpers; deprecated UTC-named exports оставлены совместимыми alias. Production остаётся на прежней UTC-boundary реализации.
- **Repro:** regression tables используют instants до/ровно после 00:00 Monday/month в Moscow; API создаёт два finished match вокруг границы и учитывает только текущий.
- **Risk:** разные пользователи видят формально неверный недельный/месячный рейтинг.
- **User-visible outcome:** weekly/monthly ranking переключается одновременно для всех клиентов по московскому календарю, независимо от timezone процесса.
- **Non-goals:** team/public-profile GAP-004, generic user-facing timestamp/default-title formatting (BUG-016), production/deploy/version bump.
- **Permissions:** только local shared/API/tests/docs и disposable PGlite; production/external services не изменяются.
- **Open questions:** нет — ADR D20 и AT-RANK-002 задают точный outcome.
- **Verification:** [`test-plans/BUG-014-moscow-ranking-boundaries.md`](test-plans/BUG-014-moscow-ranking-boundaries.md); shared Red 6/6 → Green 13/13; одинаковый результат при host TZ `UTC`, `America/Los_Angeles`, `Asia/Tokyo`; PGlite API 2/2 и shared/API typecheck green. Final combined root Node 24.19.0 CI green: shared 522, test-utils 4, web 111, API 131 + 7 guarded PostgreSQL skips, audits/lint/typecheck/builds.
- **Dependencies:** нет.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### BUG-015 — Busy organizer/participant с bye обходит запрет активного матча

- **Type:** tournament-correctness
- **Priority:** P1
- **Status:** verified_local
- **Evidence:** deterministic Red на Node 24 подтвердил прежний HTTP 200 вместо `400`; текущие AT-TRN-020 PGlite regressions с фиксированным bye seed покрывают отдельно busy organizer и busy participant и проверяют error contract плюс отсутствие изменений status/startedAt/bracket version/JSON и tournament match rows. `pnpm audit:reproduce-busy-bye` теперь запускает ровно organizer-bye acceptance и принимает только один passed test из structured JSON reporter.
- **Expected:** если organizer или participant уже участвует в активном standalone match, start турнира отклоняется с `PLAYER_ALREADY_IN_ACTIVE_MATCH` независимо от seed и распределения bye.
- **Actual:** current integrated checkout `TournamentService.start` проверяет весь игровой roster до первой materialization/write; bye не исключает зарегистрированного участника из active-match guard. Production остаётся на прежнем release.
- **Repro:** запустить `pnpm audit:reproduce-busy-bye`; команда должна подтвердить rejection и неизменность tournament state. Полный `domain.integration.test.ts` сохраняет non-bye start/unblock scenarios.
- **Risk:** busy пользователь одновременно остаётся в standalone event и проходит в tournament bracket, нарушая invariant одного активного матча и делая дальнейшую сетку неоднозначной.
- **User-visible outcome:** start блокируется одинаковым `PLAYER_ALREADY_IN_ACTIVE_MATCH` для busy organizer/participant, включая получившего bye; повтор после освобождения standalone match остаётся возможен.
- **Non-goals:** DB-level/concurrent cross-event exclusivity, bracket redesign, production/deploy/version bump.
- **Permissions:** только local server/tests/docs и disposable PGlite; production/external services не изменялись.
- **Open questions:** нет — TOURNAMENT-012/013 и AT-TRN-009/020 задают outcome.
- **Verification:** [`test-plans/BUG-015-busy-bye-start-guard.md`](test-plans/BUG-015-busy-bye-start-guard.md); Red 1/1, focused bye matrix 2/2, full domain 33/33 и API typecheck green. Combined Node 24.19.0 CI green: shared 522, test-utils 4, web 116, API 136 passed + 7 guarded PostgreSQL skips; production verification не выполнялась.
- **Dependencies:** DATA-001, DATA-002, TECH-001.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### BUG-016 — User-facing default event time зависит от timezone браузера

- **Type:** timezone-correctness
- **Priority:** P2
- **Status:** verified_local
- **Requirements / acceptance:** D20; MATCH-001; TOURNAMENT-001; AT-MATCH-015; AT-TRN-021.
- **Evidence:** deterministic pre-fix matrix различалась в `UTC`, `America/Los_Angeles` и `Asia/Tokyo`; current formatters явно используют `Europe/Moscow` и дают 6/6 одинаковых ожидаемых labels.
- **Expected:** пользовательские calendar labels/default event titles используют `Europe/Moscow`, absolute instants остаются UTC.
- **Actual:** current integrated checkout match/tournament defaults больше не зависят от browser timezone; production остаётся на прежнем release.
- **Repro:** fixed instant `2026-01-15T21:05:00.000Z` даёт `Матч 16.01, 00:05` и `Турнир 16.01.2026, 00:05:00` во всех трёх TZ.
- **Risk:** разные пользователи получают разные автоматически сохранённые названия одного московского момента.
- **User-visible outcome:** одинаковые московские default titles на всех клиентах при сохранённых ручном редактировании и payload/API contracts.
- **Non-goals:** остальные timestamps, API/UTC storage, redesign, production/deploy/version bump.
- **Permissions:** local web/tests/docs и synthetic Browser only.
- **Verification:** [`test-plans/BUG-016-moscow-default-event-titles.md`](test-plans/BUG-016-moscow-default-event-titles.md); agent full web 121/121 и Browser desktop/390, root timezone matrix 6/6; combined CI выполняется после интеграции текущей волны.
- **Dependencies:** ADR D20; BUG-009 интегрирован.

## Пробелы возможностей


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).


### BUG-017 — Judge device conflict incorrectly returns HTTP 500

- **Type:** bug
- **Priority:** P1
- **Status:** verified_local
- **Requirements / acceptance:** JUDGE-004; AT-JUDGE-002; API judge acquire.
- **Evidence:** Wave F local browser request a975e61f-5771-4d63-8e7e-a544c3e6188e returned500 at judge/acquire. Source separately confirms MatchService throws JUDGE_OTHER_DEVICE but app.ts omits that code from message/status mapping. Browser fixture cleanup may explain the retained first session; it does not justify a500 for this domain conflict.
- **Expected:** second auth session receives409 JUDGE_OTHER_DEVICE with meaningful Russian message; first judge authority and persisted session remain unchanged.
- **Actual:** JUDGE_OTHER_DEVICE now maps to409 and a Russian recovery message; same/cross-match second-session tests preserve first judge authority.
- **Repro:** create two auth sessions for one active user; acquire a valid waiting match in the first, then acquire from the second; capture deterministic API Red before mapping repair.
- **User-visible outcome:** device conflict is explained without implying a server failure or granting a second judge slot.
- **Non-goals:** change device exclusivity, judge TTL/release, schema, web UI, broad error refactor or production.
- **Permissions:** scoped local API/test/OpenAPI changes and disposable PGlite; no commit/push/version/release.
- **Risk:** confusing recovery from a valid device conflict; ensure no extra judge row or authority change.
- **Open questions:** none; existing JUDGE-004 rule retained.
- **Verification:** Focused Red2→Green2, four related judge cases, typecheck and scoped review PASS; fresh full D+E+F gate1249/1249 accepted. [Evidence](audit/evidence/bug-017-local.json). Public release remains pending.
- **Dependencies:** independent of F shared web changes; app.ts/OpenAPI/new API test assigned to separate BUG-017 task, parent owns canonical docs.


- **Focused result:** mapping repaired with two added lines; deterministic API Red2/2 at500 -> Green2/2 at409. Four selected existing judge cases pass (29 outside filter), API typecheck/rollback and parent scoped review pass. [Evidence](audit/evidence/bug-017-local.json). Remains in_progress until final F integration gate; no release.

### GAP-001 — Главная не покрывает PRD

- **Type:** product-gap
- **Priority:** P2
- **Status:** verified_local
- **Requirements / acceptance:** HOME-001..006; AT-HOME-001/002; AT-EMPTY-001; AT-VIS-001/002/004.
- **Evidence:** `HomeService` формирует visibility-safe active standalone+tournament, единый recent-5, полный hero/rival и top-3 period; typed `HomePage` показывает все HOME-001..006 sections и actionable empty states.
- **Expected:** состав и empty states соответствуют HOME-001..006 с visibility policy.
- **Actual:** current integrated checkout API/UI покрывает полный agreed Home slice; production остаётся на прежнем release.
- **Repro:** сравнить response/UI с PRD на new, active и experienced users.
- **Risk:** главная не отвечает на ключевые вопросы пользователя.
- **User-visible outcome:** пользователь видит полный hero, доступные активные события, единый recent feed, топ-3 за всё время/месяц, уведомления и профиль; пустые разделы ведут к следующему полезному действию.
- **Non-goals:** визуальный редизайн production-baseline; новые правила рейтинга или rival heuristic; история с фильтрами; deploy/production mutation.
- **Permissions:** локальный код, документация, PGlite и browser evidence; release/deploy запрещены без отдельного approval.
- **Open questions:** нет; active match на Home — только standalone, чтобы дочерний tournament match не дублировал активный tournament; recent feed также объединяет standalone match и tournament как события верхнего уровня.
- **Verification:** Red 2 API + 3 component → Green 5/5; full web 122/122 до BUG-016 formatter addition; focused API/OpenAPI/visibility/load 9/9; web/API typecheck green. Root headless Chrome подтвердил active match+tournament, month toggle, zero console/page errors и отсутствие overflow на 1280×800 и 360×800. Combined CI выполняется после интеграции текущей волны.
- **Dependencies:** полный PRD v2 закреплён D26; BUG-001 API filter verified locally.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### GAP-002 — Профиль и публичная карточка неполны

- **Type:** product-gap
- **Priority:** P2
- **Status:** verified_local
- **Evidence:** [`ProfilePage.tsx`](../apps/web/src/pages/ProfilePage.tsx) не покрывает PROFILE-001..006; нет полноценного public profile route/avatar/session management UI. Реализация начинается как own-profile view в `apps/web/src/pages/ProfilePage.tsx:11`; current gap отражён в `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md:14`.
- **Expected:** собственный/public профиль, privacy fields, stats/facts, edit/avatar и sessions по PRD/ADR D10.
- **Actual:** Wave B реализует канонический own/public profile DTO, privacy-safe blocked-target behavior, stats/facts/teams, own edit, read-only preset avatar, sessions/revoke и profile → challenge navigation. Полный aggregate gate ещё выполняется; status остаётся `in_progress`.
- **Repro:** пройти PROFILE requirements по UI/routes.
- **Risk:** неполный identity/stats сценарий и несогласованность avatar требований с D10.
- **Verification:** Wave B API 220/220 и web 148/148; browser own/public/blocked/profile-session/challenge flows прошли на desktop и 390px. Aggregate/final gate pending.
- **Dependencies:** reconcile PRD PROFILE-004 с ADR D10.
- **Execution slices (wave B):** 1) Перенести профильный сервис и own/public DTO из bc9c, закрыть privacy и blocked-target проверки. 2) Перенести edit/stats/facts/session UI и совместимый старый PATCH. 3) Проверить own/public/blocked, revoke session, переход в challenge в браузере. Профильный сервис единолично владеет GET /players/:userId; upload/regenerate не вводить.
- **Acceptance mapping:** PROFILE-001..006; ADR D10; verification evidence фиксируется по каждой slice, полный ID закрывается после всех slices и release gate.


- **Final local acceptance 2026-09-13:** `pnpm run verify:all` 1010/1010, zero failures/skips/todo; strengthened compiled browser rerun 19/19. Desktop/390 rendered review accepted. [Wave B evidence](audit/evidence/wave-b-local.json) supersedes pending checks above; public release pending.

### GAP-003 — История без фильтров, поиска и пагинации

- **Type:** product-gap
- **Priority:** P2
- **Status:** verified_local
- **Evidence:** [`HistoryPage.tsx`](../apps/web/src/pages/HistoryPage.tsx) использует общие списки без HISTORY-002/AT-VIS-003 contract. Она вызывает два полных list endpoint в `apps/web/src/pages/HistoryPage.tsx:33` и объединяет их в памяти в `apps/web/src/pages/HistoryPage.tsx:56`; отсутствие dedicated API/E2E записано в `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md:16`.
- **Expected:** match+tournament feed, filters/search/stable pagination и visibility.
- **Actual:** server-side period/role/result/event/search filters, stable opaque cursor pagination, tournament outcome mapping and visibility/tutorial/void semantics are implemented. History selector/interaction issues remain under the aggregate full gate; status remains `in_progress`.
- **Repro:** искать/фильтровать по периоду, роли, исходу, типу и имени.
- **Risk:** история не масштабируется и раскрывает лишние данные до BUG-001.
- **Verification:** Wave B API history 2/2 PostgreSQL checks and browser history journey are recorded; final aggregate gate and selector correction remain pending.
- **Dependencies:** BUG-001, DATA-003 indexes.
- **Execution slices (wave B):** 1) Перенести HistoryService из e263 с серверными фильтрами и курсором. 2) Проверить одинаковые timestamps, границы периода, void/tutorial/visibility и отсутствие повторов между страницами. 3) Подключить UI фильтров, поиска, следующей страницы и проверить возврат из деталей.
- **Acceptance mapping:** HISTORY-001..004; AT-VIS-003; verification evidence фиксируется по каждой slice, полный ID закрывается после всех slices и release gate.


- **Final local acceptance 2026-09-13:** `pnpm run verify:all` 1010/1010, zero failures/skips/todo; strengthened compiled browser rerun 19/19. Desktop/390 rendered review accepted. [Wave B evidence](audit/evidence/wave-b-local.json) supersedes pending checks above; public release pending.

### GAP-004 — Рейтинг без team filter и public profile flow

- **Type:** product-gap
- **Priority:** P2
- **Status:** verified_local
- **Evidence:** [`RankingsPage.tsx`](../apps/web/src/pages/RankingsPage.tsx) не покрывает RANK-004/005; challenge доступен не для всех строк и содержит BUG-010. UI предлагает только period filter в `apps/web/src/pages/RankingsPage.tsx:38`; current coverage отмечен broken в `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md:15`.
- **Expected:** all/week/month, team comparison, public card and safe challenge CTA.
- **Actual:** all/week/month ranking, active-member team filter and aggregate, privacy-safe public profile navigation and self/blocked challenge boundaries are implemented. Aggregate/final gate remains pending; status stays `in_progress`.
- **Repro:** пройти RANK-001..005 на UI.
- **Risk:** заявленный социальный/командный сценарий отсутствует.
- **Verification:** Wave B API 220/220 and web 148/148; ranking → public profile → challenge and Moscow-boundary flows passed in desktop and 390px browser checks. Aggregate/final gate pending.
- **Dependencies:** BUG-010, GAP-002, timezone ADR D20.
- **Execution slices (wave B):** 1) Перенести team/period ranking из 76bc без дублирующего playerCard endpoint. 2) Использовать публичный DTO GAP-002 и active-membership фильтр; проверить недоступную команду и self challenge. 3) Проверить ranking → public profile → challenge и границы Moscow в браузере.
- **Acceptance mapping:** RANK-001..005; AT-RANK-*; verification evidence фиксируется по каждой slice, полный ID закрывается после всех slices и release gate.


- **Final local acceptance 2026-09-13:** `pnpm run verify:all` 1010/1010, zero failures/skips/todo; strengthened compiled browser rerun 19/19. Desktop/390 rendered review accepted. [Wave B evidence](audit/evidence/wave-b-local.json) supersedes pending checks above; public release pending.

### GAP-005 — Match create/detail/judge покрывают только часть требований

- **Type:** product-gap
- **Priority:** P2
- **Status:** verified_local
- **Evidence:** страницы [`MatchCreatePage.tsx`](../apps/web/src/pages/MatchCreatePage.tsx), [`MatchDetailPage.tsx`](../apps/web/src/pages/MatchDetailPage.tsx), [`JudgePage.tsx`](../apps/web/src/pages/JudgePage.tsx) не имеют полного 2v2/rules/first-server/groups/revenge/log/no-show/handover/correction набора. Current form implementation начинается в `apps/web/src/pages/MatchCreatePage.tsx:26`; requirement gap сводится в `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md:17`.
- **Expected:** MATCH-001..017 и JUDGE-001..012 по принятым D23/D24, включая cancel/void safeguards.
- **Actual:** рабочий 1v1 happy path и часть judge действий.
- **Repro:** пройти requirements/acceptance matrix на UI и API.
- **Risk:** ключевой домен выглядит готовым, но альтернативные флоу полурабочие.
- **Verification:** scenario matrix unit/API/component/E2E; real two-client judge tests.
- **Dependencies:** P0 DATA/BUG, ADR D23/D24/D26.
- **Execution slices (wave C):** 1) Перенести из 82fe создание 2v2/guests/rules/first-server и реванш. 2) Перенести журнал/no-show/handover/manual correction с version/idempotency/audit. 3) Проверить два клиента, утрату роли/сессии, intentional rapid taps, повторы и D33. Общие API/DTO фиксировать до UI.
- **Acceptance mapping:** MATCH-001..017; JUDGE-001..012; verification evidence фиксируется по каждой slice, полный ID закрывается после всех slices и release gate.


- **Wave C review scope:** retain D33 and A/B recovery; close MATCH-004 groups, reservation exclusivity, handover vs old-judge writes, no-show replay. Parent requires real PostgreSQL ordered race/rollback and two-client browser acceptance.

- **Accepted Wave C 2026-09-13:** full `verify:all` 1056/1056 (quality980, PostgreSQL47, browser25, cleanup4), zero failures/skips/todo/interrupted; 16 compiled desktop/390 journeys and rendered review. Independent review repairs and authoritative persisted-state assertions passed. [Evidence](audit/evidence/wave-c-local.json). Released2.1.0 at615169c780a4522591d3359530177e7574923f14; CI34730792219 and GET-only exact-SHA smoke passed (public functional mutations not tested).

### GAP-006 — Турнирный флоу и управление сеткой локально проверены

- **Type:** product-gap
- **Priority:** P2
- **Status:** verified_local
- **Evidence:** исходный baseline выше был актуален до Wave D и теперь superseded. [`TournamentDetailPage.tsx`](../apps/web/src/pages/TournamentDetailPage.tsx) покрывает настройки и их invalidation, seed/BYE swaps, regeneration, current/next/highlight, duration, results и призовые места; API сохраняет полную summary и причину остановки. Первый полный aggregate прошёл 1133/1133, после чего rendered review выявил ложную подсказку о следующем auto-BYE матче завершённого турнира. Regression сначала был Red, исправление прошло 17/17 focused tests и typecheck, затем финальный aggregate прошёл 1135/1135: quality 1034, PostgreSQL 56, browser 41 (32 journeys + 9 foundation), cleanup 4, без failed/skipped/todo/interrupted. Desktop, 390px и landscape rendered states просмотрены. [Evidence](audit/evidence/wave-d-local.json).
- **Expected:** TOURNAMENT-001..019 и browser-usable V2 SE/DE lifecycle; V1 DE bounded fail-closed.
- **Actual:** реализованы и локально проверены organizer-owned create/roster/settings/generate/regenerate/start/advance/stop/cancel/dissolve, редактирование seed/BYE с подтверждением invalidation, V2 SE/DE 3/5/8, summary с duration/results/top-3 и персональным current/next/highlight. Stopped tournament не получает places/top-3; D33 void не входит в статистику, сохраняя bracket places. Legacy V1 DE fail-closed исправлен ранее. Wave D ещё не опубликована.
- **Repro:** пройти турниры 3/5/8 игроков SE/DE от invite до placement.
- **Risk:** локальная проверка не подтверждает hosted CI или публичный artifact до отдельного release.
- **Verification:** deterministic end-to-end tournament suite и responsive bracket QA.
- **Dependencies:** DATA-002/006, SEC-006/007, ADR D25.
- **Execution slices (wave D, после GAP-007):** 1) Полные настройки/roster/pair/bye editing и invalidation/regenerate. 2) Start/advance/stop/cancel/dissolve, current/next/duration/placements/top-3. 3) SE/DE 3/5/8 участников, busy-bye, concurrent advancement и D33; browser portrait/landscape bracket.
- **Acceptance mapping:** TOURNAMENT-001..019; AT-TRN-001..021 локально закрыты; переход к `verified_prod` требует release evidence.


- **Read summary slice:** duration, played counts, game points and placements выводятся из persisted matches/bracket; stopped не имеет placements/top, D33 void сохраняет bracket places и исключается из статистики. Участники одного elimination round делят место; points не назначают победителя. Pure Red→Green tests покрывают SE/DE 3/5/8; финальный aggregate и rendered browser review прошли.

### GAP-007 — Полный team lifecycle локально проверен

- **Type:** product-gap
- **Priority:** P2
- **Status:** verified_local
- **Evidence:** исходный stub baseline superseded Wave D. [`TeamsPage.tsx`](../apps/web/src/pages/TeamsPage.tsx) и `TeamDetailPage.tsx` покрывают list/create/detail, welcome, edit, invite/history/respond, captain transfer, member removal, leave и архивное состояние. Service/API дополнительно проверяют privacy-safe DTO, historical membership access и transactional captain/archive invariants. Финальный aggregate прошёл 1135/1135: quality 1034, PostgreSQL 56, browser 41 (32 journeys + 9 foundation), cleanup 4, без failed/skipped/todo/interrupted. Desktop и 390px rendered states просмотрены. [Evidence](audit/evidence/wave-d-local.json).
- **Expected:** captain management, invite/respond, leave/transfer/archive и использование состава в event picker.
- **Actual:** реализованы и локально проверены TEAM-001..009: enriched member data без private user fields, captain-only invitation metadata, доступ current/former members и pending invitees, automatic archive при отсутствии active members, cancel pending invitations при archive и atomic block→captain reassignment/archive. Event picker использует active own teams. Публичного Wave D release нет.
- **Repro:** пройти создание → invite → accept → use member → transfer/leave/archive.
- **Risk:** локальная проверка не подтверждает hosted CI или публичный artifact до отдельного release.
- **Verification:** AT-TEAM-001..007 + service/API/component/E2E и deterministic PostgreSQL concurrency.
- **Dependencies:** DATA-004; полный PRD v2 закреплён D26.
- **Execution slices (wave D, до GAP-006):** 1) Captain/invite/respond/detail с active-membership invariants. 2) Leave/transfer/archive и недопустимые переходы. 3) Подключение состава к event picker и браузерный lifecycle нескольких пользователей; конкурентные изменения на PostgreSQL.
- **Recheck 2026-09-13 (superseded baseline):** до Wave D service имел create/get/list/invite/respond и block-triggered captain selection, но не имел update/remove/leave/manual-transfer/archive API или team-detail UI. Текущий candidate закрыл эти пункты; `matchCreateOptions` продолжает использовать own active teams без отдельного picker service.
- **Bounded orders:** domain transaction/DTO and captain invariants → canonical route/OpenAPI contracts with legacy invite/respond compatibility → team detail/welcome/controls → multi-user browser and real PostgreSQL captain/leave/accept races. Inspect blockUser→transferCaptainOnBlock atomicity before changing lifecycle; preserve historical memberships and current team ranking semantics.

- **Acceptance mapping:** TEAM-001..009; AT-TEAM-001..007 локально закрыты; переход к `verified_prod` требует release evidence.


### GAP-008 — Notifications реализованы частично

- **Type:** product-gap
- **Priority:** P2
- **Status:** verified_local
- **Evidence:** backend/UI покрывают ограниченный набор типов; popup и полный action lifecycle отсутствуют. UI явно ветвится только по текущим типам начиная с `apps/web/src/pages/NotificationsPage.tsx:154`; partial lifecycle зафиксирован в `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md:21`.
- **Expected:** NOTIF-001..006 с приглашениями, актуальностью, read-state и popup suppression.
- **Actual:** list/read и часть tournament уведомлений.
- **Repro:** инвентаризировать product events и созданные notification types.
- **Risk:** пользователь пропускает обязательные действия или видит устаревшие.
- **Verification:** notification event matrix + AT-NOTIF-*.
- **Dependencies:** BUG-013, DATA-004.
- **Execution slices (wave E):** 1) Сопоставить каждый product event с типом и получателем уведомления. 2) Реализовать недостающие types/popup/suppression и действия. 3) Проверить expiry/cancel/revoke/read/retry и отсутствие дублей; browser multi-user flow.
- **Acceptance mapping:** NOTIF-001..006; AT-NOTIF-*; verification evidence фиксируется по каждой slice, полный ID закрывается после всех slices и release gate.


- **Wave E implementation checkpoint:** added historical match/player/judge consent, strict organizer prestart patch, persisted invitation expiry/read state and one dismissible popup with judge/tutorial suppression. Focused API contract1/1, lifecycle6/6, PostgreSQL concurrency2/2 and popup/notification UI8/8 passed. Event matrix, full fixture reconciliation and browser gates remain open; not production-verified. Consent changes apply to new standalone outsider participants, preserve same-team/guest and legacy matches.

- **Coordinator recheck:** independent review reproduced cross-match PostgreSQL40P01 in side swap versus reinvite/create; nonplaying tournament creator versus judge reinvite reproduced the same omitted-creator lock dependency (also DATA-002/GAP-006). Creator is added to each operation's existing sorted lock set; focused regression/re-review pending. Initial E aggregate was interrupted before PG/browser acceptance, not passed. Original186 source files remain unchanged.

- **Final local acceptance 2026-09-13:** [Wave E evidence](audit/evidence/wave-e-local.json) combines successful cleanup4, quality1112, PostgreSQL66 and browser47 (38 journeys plus9 foundation), total1229 with zero failed/skipped/todo/interrupted. The initial full command failed solely because Chromium could not launch inside macOS sandbox; only that lane was repeated with local authorization. Relevant functional desktop/390 journeys passed. Accessibility/responsive quality remains GAP-011/TECH-002, public release pending.

### GAP-009 — Onboarding и Help не достигают заявленного результата

- **Type:** product-gap
- **Priority:** P2
- **Status:** verified_local
- **Evidence:** onboarding статичен; [`HelpPage.tsx`](../apps/web/src/pages/HelpPage.tsx) использует фиксированный feedback kind и не покрывает категории/context tips. Фиксированный kind находится в `apps/web/src/pages/HelpPage.tsx:46`, а static guided-state gap — в `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md:22`.
- **Expected:** ONB-001..005 и HELP-001..003.
- **Actual:** отдельные страницы существуют, но workflow сокращён.
- **Repro:** пройти первый вход/skip/resume/restart и отправку разных feedback categories.
- **Risk:** плохая обучаемость и слабая обратная связь.
- **Verification:** E2E first-login journey + help component/API tests.
- **Dependencies:** BUG-012; полный PRD v2 закреплён D26.
- **Execution slices (wave E):** 1) Завершить contextual guide поверх persisted steps с явным завершением после tutorial. 2) Категории Help/feedback и contextual tips. 3) First-login/skip/resume/restart/tutorial-return и отправка разных категорий с ошибками/retry.
- **Acceptance mapping:** ONB-001..005; HELP-001..003; D34; verification evidence фиксируется по каждой slice, полный ID закрывается после всех slices и release gate.


- **Wave E bounded recheck:** preserve D34 and existing auth/security guards; implement only PRD help categories/context tips and admin catalog/profile fields. Parent owns acceptance, rollback snapshot and final browser/PostgreSQL gates. No audit viewer, attachments or new production mutation tests.

- **Final local acceptance 2026-09-13:** [Wave E evidence](audit/evidence/wave-e-local.json) combines successful cleanup4, quality1112, PostgreSQL66 and browser47 (38 journeys plus9 foundation), total1229 with zero failed/skipped/todo/interrupted. The initial full command failed solely because Chromium could not launch inside macOS sandbox; only that lane was repeated with local authorization. Relevant functional desktop/390 journeys passed. Accessibility/responsive quality remains GAP-011/TECH-002, public release pending.

### GAP-010 — Admin UI не покрывает каталог операций

- **Type:** product-gap
- **Priority:** P2
- **Status:** verified_local
- **Evidence:** [`AdminPage.tsx`](../apps/web/src/pages/AdminPage.tsx) без полного search/filter/profile edit/unblock/created/last-login набора ADM-002..008. Current page загружает единый user list в `apps/web/src/pages/AdminPage.tsx:28`; coverage summary — `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md:11`.
- **Expected:** безопасное управление users по ADM-002..008, включая persisted audit для административных изменений по ADM-008.
- **Actual:** create, role, block/reset и match ops представлены частично.
- **Repro:** сверить каждое ADM requirement с control/API response.
- **Risk:** эксплуатация требует прямых API/DB действий.
- **Verification:** admin component/E2E matrix и assertions persisted audit.
- **Dependencies:** BUG-011, DATA-005.
- **Execution slices (wave E):** 1) Search/filter/profile edit/created/last-login и persisted audit. 2) Ролевые запреты, self/last-admin, session revocation и пустые результаты поиска. 3) Полный browser admin lifecycle и persisted audit assertions.
- **Acceptance mapping:** ADM-002..008; AT-AUTH-008; verification evidence фиксируется по каждой slice, полный ID закрывается после всех slices и release gate.


- **Wave E bounded recheck:** preserve D34 and existing auth/security guards; implement only PRD help categories/context tips and admin catalog/profile fields. Parent owns acceptance, rollback snapshot and final browser/PostgreSQL gates. No audit viewer, attachments or new production mutation tests.

- **Final local acceptance 2026-09-13:** [Wave E evidence](audit/evidence/wave-e-local.json) combines successful cleanup4, quality1112, PostgreSQL66 and browser47 (38 journeys plus9 foundation), total1229 with zero failed/skipped/todo/interrupted. The initial full command failed solely because Chromium could not launch inside macOS sandbox; only that lane was repeated with local authorization. Relevant functional desktop/390 journeys passed. Accessibility/responsive quality remains GAP-011/TECH-002, public release pending.

### GAP-011 — Accessibility и responsive качество не подтверждены

- **Type:** accessibility
- **Priority:** P2
- **Status:** in_progress
- **Evidence:** Baseline defects are preserved in the visual audit. Current source/Red/Green/review: [Wave F local evidence](audit/evidence/wave-f-local.json).
- **Expected:** [A11Y checklist](A11Y_CHECKLIST.md), WCAG AA для ключевых элементов, 360px+ и judge landscape без overflow/semantic violations.
- **Actual:** Shared44px/contrast/auth geometry, Dialog current-controls/focus recovery, judge disclosure/live summary, bracket keyboard/touch/zoom and decorative ranking avatar repaired. Fresh full gate1249/1249 and Firefox7/7 pass. WebKit fails before app page creation; complete compatibility/device/AT coverage remains open.
- **Repro:** browser audit на 360×640, mobile Safari safe-area, keyboard и screen-reader semantics.
- **Risk:** продукт труден или недоступен на целевых устройствах.
- **Verification:** Chromium48 journeys +9foundation, full web227, PostgreSQL66, independent review PASS; [engine results](audit/evidence/wave-f-compatibility.json) explicitly retain WebKit7 runtime failures and axe incomplete checks. This ID remains in_progress for full NFR breadth.
- **Dependencies:** current production — interim regression baseline по D22; будущий redesign не блокирует исправление подтверждённых defects.

## Эксплуатация и качество
- **Execution slices (wave F и в каждой UI-задаче):** 1) Закрывать geometry/44px/contrast/keyboard/focus/safe-area по мере интеграции страниц. 2) Убрать временное исключение color-contrast из critical E2E после исправления. 3) Полный desktop/390/360/judge-landscape и доступный WebKit проход; неподтверждённые physical-device проверки явно оставить residual, не объявлять выполненными.
- **Acceptance mapping:** A11Y checklist; UX state matrix; verification evidence фиксируется по каждой slice, полный ID закрывается после всех slices и release gate.

### GAP-012 — Setup матча и турнира требует обязательного player consent

- **Type:** product-gap
- **Priority:** P1
- **Status:** verified_prod
- **Requirements / acceptance:** MATCH-001/003/008/014; TOURNAMENT-001/005/007/012; AT-MATCH-013/017; AT-TRN-004/016/019/022/023; D35.
- **Evidence:** pre-change contracts required creator membership and blocked start on pending outsider consent; tournament policy/admin add/provenance and transactional post-bracket add were absent. Local acceptance is linked below; [public evidence](audit/evidence/gap012-public.json) records exact-SHA Render/Vercel convergence and hosted CI.
- **Expected:** table-side operator создаёт A-vs-B, не занимая слот; selection не означает invite, а voluntary invitations не блокируют start. Tournament consent policy выбирается при создании; organizer/active admin имеет отдельный подтверждённый registered-user add, включая атомарную post-bracket regeneration до старта.
- **Actual:** published3.0.0 реализует direct default, explicit invitation flag, nonplaying creator edit/start, immutable tournament policy, scoped minimal admin DTO, provenance/audit/fingerprinted idempotency и serialized add/invite/start/regeneration.
- **Repro:** создать manual A-vs-B от C и проверить creator membership/invite/start; затем создать required-consent tournament, попытаться organizer/admin add без confirmation, add к generated bracket и concurrent invite/add/start.
- **User-visible outcome:** один телефон у стола может сразу открыть scoring для реально выбранных игроков; более строгий consent и приглашения остаются сознательными опциями, а опасный override всегда называет игрока, турнир и последствия.
- **Non-goals:** изменение judge acquisition/scoring/stats, новые admin powers, typed-name confirmation, invitation-history UI для admin, release/version/deploy/production mutation.
- **Risk:** потеря roster identity/history, неатомарная сетка, race с invite/start или расширение admin authority.
- **Verification:** [`test-plans/GAP-012-game-setup.md`](test-plans/GAP-012-game-setup.md); focused PGlite/API/component/OpenAPI and PostgreSQL serialization gates green. Fresh full `verify:all`1257/1257 PASS: quality1123, PostgreSQL71, cleanup4, browser9 foundation+50 journeys (25desktop/25mobile390), zero failed/skipped/todo/interrupted. Final r6 source52 paths byte-identical before/after; Terra runtime review PASS. [Acceptance evidence](audit/evidence/gap012-local.json).
- **Public verification 2026-09-15:** commit `682c98066ad80e2373a7893cc71482003e9eee42`; GitHub CI34926424343 all4 jobs success; Vercel deployment6451307944 success; Render API and Vercel web/proxy exact-SHA smoke PASS after10 attempts/49062ms; direct `/ready` reported database `ok`. [Evidence](audit/evidence/gap012-public.json).
- **Dependencies:** D18, D35, DATA-004, GAP-008; forward migration `0006_gap_012_game_setup.sql`.
- **Open questions:** нет; exact replay уже успешного add после start возвращает прежний outcome без mutation, новый post-start add запрещён.



- **Wave F start:** exclusive web/test task dispatched after E functional acceptance and443-file frozen snapshot. Work order covers44px/contrast/keyboard/safe-area/judge/bracket and browser matrix; no F acceptance yet. Parent retains canonical docs, independent acceptance and release.

### OPS-001 — OpenAPI не описывает фактический API

- **Type:** documentation-contract
- **Priority:** P1
- **Status:** verified_local
- **Requirements / acceptance:** API Spec §1.1/§14; AT-OPS-API-001.
- **Evidence:** deterministic Red: 16/62 operations, version `0.1.0` vs root `1.10.1`, no security/schema components. Green after combined BUG-013 merge: current [`app.ts`](../apps/api/src/app.ts) and [`openapi.ts`](../apps/api/src/openapi.ts) are exactly 63/63 operations and 57/57 paths; contract test enforces unique IDs, version, auth/CSRF, parameters, bodies and response/error schemas. Exact machine snapshot: [`audit/evidence/route-openapi-inventory.json`](audit/evidence/route-openapi-inventory.json); historical live snapshot remains `0.1.0` and 12 paths.
- **Expected:** generated/validated OpenAPI покрывает все public routes, auth, payloads, errors и текущую release version.
- **Actual:** local runtime OpenAPI полностью покрывает current source и version `1.10.1`; reusable schemas/helpers описывают cookie+CSRF boundary и ключевые payload/results/errors. Target-only/naming routes явно отделены в API Spec. Production остаётся на старом release artifact.
- **Repro:** сравнить route inventory с OpenAPI paths и API spec.
- **User-visible outcome:** интеграторы получают из local/current release source полный as-built contract вместо выборочного списка; target gaps не маскируются под существующие endpoints.
- **Non-goals:** реализация или переименование target-only routes, автоматическое добавление runtime validation каждому cast-based handler, version bump, deploy и production mutation.
- **Permissions:** только local source/test/docs и generated inventory; production/external services не менялись.
- **Open questions:** нет; as-built OpenAPI и target spec намеренно остаются разными слоями.
- **Risk:** клиенты/тесты опираются на ложный контракт.
- **Verification:** [`test-plans/OPS-001-openapi-contract.md`](test-plans/OPS-001-openapi-contract.md); focused Node 24 contract 3/3, API typecheck и strict inventory green. Full combined CI evidence фиксируется после combined run.
- **Dependencies:** DATA-001 validation schemas.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### OPS-002 — Наблюдаемость и readiness отсутствуют

- **Type:** operations
- **Priority:** P1
- **Status:** verified_local
- **Requirements:** NFR Observability §8; API Spec §1/§1.1; AT-OPS-OBS-001/002.
- **Evidence:** deterministic Red 2/2: `/ready` был 404, `/health` не имел request ID. Green 2/2 использует fixed clock/IDs, disposable PGlite probe, injected DB/500 failures и synthetic canaries; `/health` независим, `/ready` fail-closed, log output коррелирован и не содержит canary values.
- **Expected:** `/health` остаётся process liveness, отдельный public `/ready` проверяет DB и fail-closed возвращает 503; каждый response получает request ID, runtime пишет JSON request completion/error signals с method/route/status/latency без credentials, cookies, auth/CSRF headers, query values или raw exception.
- **Actual:** local runtime включает JSON logger, `X-Request-Id`, общий error-body request ID, completion status/latency и safe error signals; `/ready` выполняет `SELECT 1`. `render.yaml` направляет будущий Blueprint health check на `/ready`, Vercel local config проксирует endpoint; production остаётся на прежнем artifact.
- **User-visible outcome:** оператор отличает живой процесс от недоступной DB и связывает безопасный 5xx response с одной structured-log цепочкой по request ID.
- **Non-goals:** production dashboard/alerts, retention/owner policy, aggregate judge/login/backup metrics, deploy/version bump.
- **Permissions:** local source/tests/docs и disposable PGlite; external services и persistent/production DB не меняются.
- **Open questions:** Q-OPS-002/003 остаются для release/retention/backup policy; local readiness contract от них не зависит.
- **Repro:** инъецировать DB probe failure в `/ready`; вызвать unexpected 500 с canaries в query/header/error и проверить response/log lines.
- **Risk:** длительное обнаружение и восстановление инцидентов.
- **Verification:** [`test-plans/OPS-002-readiness-observability.md`](test-plans/OPS-002-readiness-observability.md): Red 2/2 → Green 2/2; focused OPS/OpenAPI/Home 7/7, strict inventory 64/64 operations, 58/58 paths. Combined Node 24 `pnpm run ci` green: docs/routes/secret/ops audits, lint/typecheck, shared 522, test-utils 4, web 124, API 150 + 7 guarded PostgreSQL skipped, builds. Production dashboard/runbook smoke не выполнялся.
- **Dependencies:** Q-OPS-002/003 для владельца/retention, базовая readiness не блокируется.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### OPS-003 — Backup и seed scripts опасны для production данных

- **Type:** operations-safety
- **Priority:** P1
- **Status:** verified_local
- **Evidence:** Red OPS safety test отсутствовал вместе с `ops-safety.mjs`; прежний shell принимал remote URL/arbitrary restore identifier, interpolated DDL и predictable temp, а seed имел только comment guard. После integration review Green 7/7 проверяет config boundary, fake-tool shell flow, SQL через stdin, запрет pre-existing restore target, cleanup, secret-free output и seed fail-closed до network.
- **Expected:** явный allowlist test DB, случайный temp с cleanup trap, quoted identifiers, dry-run/confirmation и fail-closed seed.
- **Actual:** current integrated helper допускает только PostgreSQL loopback source с explicit test/local/dev/ci/rehearsal marker, confirmation `1` и bounded новый `tab10_restore_rehearsal_*` target; pre-existing restore DB отклоняется до `pg_dump`. Shell использует `mktemp`, cleanup trap и передаёт quoted identifier в `psql` через stdin без `-c` variable interpolation. Seed отклоняет production/non-loopback API до HTTP request. Production/real DB не вызывались.
- **Repro:** `pnpm test:ops-safety`; negative remote/malicious cases не запускают fake DB tools, valid disposable harness очищает temp artifact.
- **Risk:** удаление production данных.
- **User-visible outcome:** ошибочная production-like конфигурация локального rehearsal/seed прекращается до mutation; допустим только явный disposable target.
- **Non-goals:** production backup, реальный restore, schedule/retention/storage, avatar backup, RPO/RTO, deploy/version bump.
- **Permissions:** только local code/tests/docs и fake `pg_dump`/`psql`; production/external services и реальные databases не затронуты.
- **Open questions:** Q-OPS-003 по-прежнему определяет production backup policy, но не блокирует local fail-closed boundary.
- **Verification:** [`test-plans/OPS-003-safe-rehearsal-seed.md`](test-plans/OPS-003-safe-rehearsal-seed.md); Node 24 safety suite 7/7 и `bash -n` green; audit/CI integration проверяется общим gate.
- **Dependencies:** Q-OPS-003 только для целевого backup процесса.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### OPS-004 — Release/version drift

- **3.0.0 published (2026-09-13):** code commit165aecdaaa2eba6ffa5fd9d39926bca155016c95, local1249/1249, CI34746947853 all4 jobs success, Render live/Vercel READY and exact-SHA GET-only smoke PASS. [Evidence](audit/evidence/release-3.0.0-public.json). Prior pre-publication checkpoint below is historical.

- **3.0.0 pre-publication checkpoint (2026-09-13):** user-approved D+E+F/BUG-017 release; fresh1249/1249 local gate,449 source identities unchanged. [Evidence](audit/evidence/release-3.0.0-local.json). Hosted/public verification follows the main push.

- **Type:** release-management
- **Priority:** P0
- **Status:** verified_prod
- **Evidence:** package 1.10.1, live OpenAPI 0.1.0, docs называли unreleased
  endpoints, а production уже отдаёт некоторые из них; deployed commits не были
  связаны единым manifest. Baseline:
  [`production-http-baseline.json`](audit/evidence/production-http-baseline.json).
  Pre-PR1 aggregate fingerprint/manual snapshot/restore comparison:
  [`ops-004-pre-pr1-production-recovery.json`](audit/evidence/ops-004-pre-pr1-production-recovery.json).
- **Expected:** один воспроизводимый local → public-stand pipeline на Node
  `24.20.0`, pnpm `9.15.0`, PostgreSQL `16.15`; proportional local checks и
  parallel CI сохраняют quality/PostgreSQL/compiled-browser evidence, прямой push
  в `main` автоматически публикуется native Git integrations, а read-only smoke подтверждает один
  SHA/version у web и API.
- **Actual:** foundation и Neon-normalization находятся в `main`. Node/pnpm/PG
  toolchain, default local PostgreSQL, versioned `0000`, strict local/CI lanes,
  compiled E2E и ReleaseMetadata работают как единый контур. D31 заменил
  отдельный staging/provider orchestration на Render/Vercel native `main` Git
  deploy, D32 — PR-only этап прямой работой в `main`. Disposable public runtime
  и migrations временно используют `neondb_owner`; Render получает pooled
  runtime URL и выводит из него direct migration URL. Первый release SHA
  `6892d6e6fe79425eadf76c39bf052500bde5055a` подтверждён: GitHub CI green,
  Render `live`, Vercel `READY`, `pnpm smoke:public` прошёл с первой попытки,
  seed-admin создан и реальный browser login успешен. Redacted evidence:
  [`ops-004-public-release.json`](audit/evidence/ops-004-public-release.json).
  Frozen product/story delta и migrations `0001–0003` остаются следующей волной;
  исходный dirty worktree и внешний recovery snapshot не изменяются.
- **Repro:** выполнить fresh `pnpm ci`, затем после push проверить `/health`,
  `/ready`, `/release.json` и proxied OpenAPI на одинаковые SHA/version.
- **Risk:** временная частичная доступность, если Render и Vercel заканчивают
  deploy в разное время; deploy до повторного merge-SHA CI; повышенные права API;
  downtime при первой пересборке схемы; отсутствие production-grade backup до
  VPS. Ручной smoke делает рассинхронизацию видимой.
- **Permissions:** 2026-09-07 пользователь явно разрешил одноразово удалить и
  пересоздать текущую публичную Neon schema, поскольку ценных данных на стенде
  нет; также разрешил постоянные прямые commit/push в `main`, native deploy и
  включённый seed admin до явной смены режима. Последующие deploy используют apply-only. Mutating public E2E,
  down-migration и automatic restore не разрешены.
- **Non-goals:** version bump/tag, платные планы, отдельный staging,
  production-grade recovery/zero-downtime и продуктовые migrations `0001–0003`.
- **Verification:** AT-OPS-DELIVERY-001..009 и
  [`test-plans/OPS-004-delivery-parity.md`](test-plans/OPS-004-delivery-parity.md):
  clean checkout без `.env` → `pnpm run verify:all` с 0 failed/skipped/todo и полным
  cleanup; negative unit/migration/browser gates; fresh 17-table schema; один
  direct-main native-Git public release с exact-SHA smoke. Выполнено на SHA
  `6892d6e6fe79425eadf76c39bf052500bde5055a`: `820 passed`, CI run
  `34195797553`, Render deploy `dep-dafr5egn74is73b9lt0g`, Vercel deployment
  `dpl_ER2ekejpxQbRN7MfTvP5VyAkPWax`, public smoke `1/1`.
- **Completion plan:** Wave A–F sequencing and gates are tracked in
  [`test-plans/OPS-004-completion-waves.md`](test-plans/OPS-004-completion-waves.md).
- **Dependencies:** D32. Q-OPS-003
  переносится в обязательный VPS-readiness scope и не блокирует disposable stand.

### OPS-005 — Cold start не имеет явного UX состояния

- **Type:** resilience-ux
- **Priority:** P1
- **Status:** verified_local
- **Evidence:** live baseline 2026-09-06 подтвердил >25s wake-up; deterministic Red 2/3 показал только безымянный skeleton и отсутствие 60s timeout/Retry. Green fake-timer matrix 3/3 разделяет initial pending/waking/timeout от warm page request, а regressions auth/onboarding/API 6/6 сохраняют прежние journeys.
- **Expected:** до 60s только для Render cold start: явное «сервис просыпается/загрузка», timeout и Retry; после wake обычные SLO и ошибки не маскируются.
- **Actual:** initial auth bootstrap показывает «Подключаемся», после 1.5s — «Сервис просыпается» с объяснением, aborts ровно через 60s и предлагает Retry. Успешный/401 ответ открывает обычный flow; warm Home request не получает cold-start label. Production не менялась.
- **Repro:** `cold-start.test.tsx`; local Browser с delayed loopback fixture показывает waking → Login и offline error → Retry → Login на desktop/390×844.
- **Risk:** ложное ощущение поломки и бесконечное ожидание.
- **User-visible outcome:** пользователь понимает, что бесплатный сервис пробуждается, ожидание ограничено минутой и после отказа есть рабочий Retry.
- **Non-goals:** изменение Render plan/config, generic timeout всех API calls, server push, production deploy/version bump.
- **Permissions:** только local web/tests/docs и disposable loopback delay fixture; production/external services не изменялись.
- **Open questions:** нет — D21 и AT-OPS-COLD-001/002 задают локальный outcome; production smoke остаётся approval-gated.
- **Verification:** [`test-plans/OPS-005-cold-start-ux.md`](test-plans/OPS-005-cold-start-ux.md); fake timers 3/3, focused 9/9, web typecheck и local Browser desktop/mobile green. Full combined CI фиксируется после merge активной backlog-wave.
- **Dependencies:** ADR D21, OPS-002 для корректной классификации readiness.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### TECH-001 — Full test suite стабилизирован локально

- **Type:** test-reliability
- **Priority:** P0
- **Status:** verified_prod
- **Evidence:** baseline API failure остаётся immutable history в `docs/audits/2026-09-06-baseline.md:67`. После отделения deterministic acceptance seed (`apps/api/src/domain.integration.test.ts:1699`) от hermetic known-defect characterization (`apps/api/src/domain.integration.test.ts:1736`) команда `pnpm test` прошла green три раза подряд (confirmed 2026-09-06); текущий full suite на Node 24.20.0 также green: shared 517 passed + 1 todo, test-utils 4, web 70, API 83 passed + 3 PostgreSQL skipped. Initial hosted PostgreSQL job `101526650172` выполнил fresh-schema/date smoke, затем честно упал на двух неверных test expectations; corrected `AT-MATCH-007/011` и `AT-TRN-010` находятся в `apps/api/src/postgres-date.integration.test.ts:139` и `apps/api/src/postgres-date.integration.test.ts:220`. Follow-up GitHub run `34048623246` и оба job green; exact snapshot — `docs/audit/evidence/hosted-ci-foundation.json`. Passing BUG-015 characterization подтверждает воспроизводимость дефекта, а не его исправление.
- **Expected:** полный deterministic CI зелёный; flaky тест блокирует релиз согласно NFR.
- **Actual:** локальная repeatability подтверждена тремя полными прогонами; прежние acceptance failures были связаны со смешением seed-сценариев. Первый hosted PostgreSQL run выявил fixture drift (`pointsToWin=1` и пропущенный third-place match), исправленный без retry/skip; follow-up quality/PostgreSQL и опубликованный OPS-004 SHA прошли. BUG-015 остаётся отдельным детерминированным product defect, а не flaky test.
- **Repro:** выполнить `pnpm test` последовательно; `pnpm audit:reproduce-busy-bye` должен запускать только один отдельный characterization test.
- **Risk:** текущий configured gate воспроизводим локально/hosted, но не заменяет отсутствующие browser E2E и ещё не покрытые product races; product risk busy-bye отслеживается независимо в BUG-015.
- **Verification:** три последовательных full suites и final Node 24.20.0 `pnpm run ci` green локально; GitHub run `34048623246` green, включая PostgreSQL fresh schema/date + `200/409` race + one-time stats + final/third-place advancement.
- **Dependencies:** BUG-015; TECH-004 для final Node 24 CI evidence.

### TECH-002 — Критические флоу не покрыты browser E2E

- **Type:** test-gap
- **Priority:** P1
- **Status:** in_progress
- **Requirements:** AUTH-001/005; MATCH-001/005/008/013; JUDGE-001/003/006/007; AT-AUTH-009, AT-MATCH-001/005/008/013, AT-JUDGE-001/003/006/007; NFR accessibility/compatibility.
- **Evidence:** Current playwright.prodlike.config.ts and verify:e2e run compiled API/web with disposable PostgreSQL16.15 and managed Chromium; historical initial PGlite/system-Chrome evidence below is superseded.
- **Expected:** критические auth/match/judge/tournament/admin journeys и negative authz проверяются на real browser; coverage thresholds измеряются, но не заменяют сценарии.
- **Actual:** Fresh full verify:all1249/1249 includes48 desktop/mobile journeys across auth, history/profile/ranking, matches/judge/handover, teams/tournaments, consent/admin/onboarding/help and F. color-contrast exclusion removed. Separate Firefox7/7 passes; WebKit7 page-creation crashes leave cross-browser breadth incomplete.
- **User-visible outcome:** regressions в критическом standalone match/judge и runtime re-auth path ловятся реальным браузером до релиза на desktop и mobile widths.
- **Non-goals:** Public mutating tests, OS/security configuration changes, dependency/browser-version upgrades and release/version operations.
- **Permissions:** Loopback compiled browser/API/web, disposable PostgreSQL and isolated pinned browser cache; no production mutation.
- **Open questions:** WebKit native runtime failure, latest-two released browsers and real-device/AT breadth remain under GAP-011/TECH-002.
- **Repro:** на Node 24/pnpm 9 выполнить `pnpm test:e2e`.
- **Risk:** визуальные/интеграционные дефекты проходят CI.
- **Verification:** [Current browser plan](test-plans/TECH-002-browser-e2e.md), [full local gate](audit/evidence/wave-f-local.json) and [partial additional-engine lane](audit/evidence/wave-f-compatibility.json). No hosted CI for this uncommitted candidate; full ID remains in_progress.
- **Dependencies:** сначала стабилизировать TECH-001 и P0 API invariants.

- **Wave B build evidence:** `tests/e2e/wave-b.spec.ts` covers profile/ranking/history journeys at desktop and 390px; production-build mode regression passed 17/17 Node tests and artifact inspection found dev React 0, prod React 1, `jsxDEV` 0. Final aggregate gate remains pending.

### TECH-003 — Login rate limiter неверно считает и не масштабируется

- **Type:** technical-debt
- **Priority:** P1
- **Status:** verified_local
- **Requirements:** AUTH-005; NFR security; AT-AUTH-010.
- **User-visible outcome:** последовательные успешные входы не приводят к ложному `RATE_LIMITED`; 10 неуспешных попыток на один fingerprint допускаются в фиксированном 15-минутном окне, следующая получает прежний HTTP 429/code, а на границе expiry проверка credentials возобновляется.
- **Non-goals:** внешний/shared store, горизонтальное масштабирование, production config/deploy и изменение публичной ошибки.
- **Permissions:** только локальные code/tests/docs и disposable PGlite; production/external mutations запрещены.
- **Open questions:** none для текущей single-replica policy; shared limiter требует отдельного accepted need до multi-replica.
- **Evidence:** deterministic Node 24.19.0 Red 4/4: 11-й успешный вход получил 429, exact expiry всё ещё возвращал 429, 10 001 unique key раздули map до 10 001, после expiry 100 keys остались и новый дал size 101. Current integrated checkout Green 4/4 и полный auth file 15/15: successful/technical outcomes освобождают reservation, известные auth failures сохраняют её; SHA-256 fingerprint фиксирует размер key, ordered expiry cleanup удаляет stale state, cap 10 000 evict-ит oldest live entry.
- **Expected:** лимитирует неуспешные попытки по безопасному ключу/окну, очищает состояние и имеет понятную multi-instance policy.
- **Actual:** local process-local limiter выполняет expected policy. Он намеренно не является fleet-wide: каждая replica имеет независимый budget; documented deployment gate запрещает считать его достаточным после horizontal scale без отдельного shared-store решения.
- **Repro:** [`test-plans/TECH-003-login-rate-limiter.md`](test-plans/TECH-003-login-rate-limiter.md) — fake-clock success/failure/exact-expiry и white-box cardinality/cleanup matrix.
- **Risk:** ложные блокировки, memory growth и слабая защита brute force.
- **Verification:** focused TECH-003 4/4, полный auth integration 15/15 и API typecheck green на Node 24.19.0 в task worktree. Combined root CI фиксируется после интеграции всей wave; production topology отдельно документирует process-local/single-replica boundary.
- **Dependencies:** решение о shared store только при реальной multi-replica потребности; до такого решения текущая policy остаётся single-replica.


- **Wave A current evidence (2026-09-13):** integrated candidate 1.11.0 passed the aggregate 965 checks (quality 906, PostgreSQL 40, browser 15 including 6 journeys, cleanup 4), with 0 failures/skips/todo. Old source-worktree evidence above is historical. Final BUG-007 stale-alert correction also passed the fresh 965/965 aggregate and rendered review. Public release is not yet verified. [Redacted aggregate](audit/evidence/wave-a-local.json). See [wave plan](test-plans/OPS-004-completion-waves.md).

### TECH-004 — Node 24 alignment подтверждён локально, в CI и hosting

- **Type:** build-tooling
- **Priority:** P1
- **Status:** verified_prod
- **Evidence:** baseline configs расходились между Node 20/24; current pins согласованы в `.node-version:1`, `package.json:34`, `apps/api/package.json:7`, `render.yaml:16` и `.github/workflows/ci.yml:30`. На exact Node 24.20.0 + pnpm 9.15.0 выполнены frozen install и полный `pnpm run ci`: audit gates, lint, typecheck, tests и builds green 2026-09-06. GitHub run `34048623246` также green для Quality/PGlite и PostgreSQL 16; `docs/audit/evidence/hosted-ci-foundation.json` привязывает evidence к SHA.
- **Expected:** install/lint/typecheck/test/build и deployment проходят на одной явно поддерживаемой Node 24 version.
- **Actual:** repo-controlled config, локальный полный quality/build pipeline и GitHub Actions подтверждены exact Node 24.20.0/PostgreSQL 16; foundation SHA `6892d6e6fe79425eadf76c39bf052500bde5055a` также опубликован Render/Vercel и прошёл exact-SHA public smoke.
- **Repro:** clean checkout с Node 24 → frozen install → `pnpm run ci`; сравнить hosting runtime metadata.
- **Risk:** локально зелёная работа ломается в CI/hosting или наоборот.
- **Verification:** local quality/build gate, GitHub quality + PostgreSQL lanes, Vercel/Render release metadata и public smoke green на одном commit SHA; redacted release evidence ведётся в OPS-004.
- **Dependencies:** OPS-004 release evidence; Q-OPS-002.

### TECH-005 — Адаптивная оркестрация Codex

- **Type:** development-process
- **Priority:** P2
- **Status:** in_progress
- **Evidence:** project `.codex` profiles, `.agents` skill и
  [ORCHESTRATION.md](ORCHESTRATION.md) интегрированы в текущий checkout; frozen
  2026-09-13 static evidence остаётся историческим. Текущий runtime подтвердил
  bounded workers, exclusive writers и независимый route review, но лимит
  concurrency не позволил запустить дополнительного reviewer.
- **Expected:** ограниченное делегирование Luna/Sol/Terra с приёмкой главным
  агентом; минимальные накладные расходы, exclusive writers, evidence и
  существующие permissions/gates.
- **Actual:** protocol/config доступны; runtime model/effort matrix и измерение
  эффективности ещё не завершены.
- **Repro:** проверить native config/skill discovery и bounded read-only profile
  smoke без изменения project trust/permissions.
- **Risk:** context overhead, conflicting writes, stale evidence и неверное
  объявление завершения; экономия подписки пока не измерена.
- **Verification:** config loader, skill validation, docs audit и отдельный
  runtime profile smoke; product REQ/AT не применимы.
- **Dependencies:** capabilities текущего Codex; production scope отсутствует.

### Wave F independent review checkpoint — 2026-09-13

F15-path candidate delivered with web223/223, main browser21/21 and last
ButtonGroup/link correction11/11. The earlier21/21 is not an aggregate over the
last CSS bytes. Parent inspected auth360, admin1440, bracket360, judge640 and
text200, bootstrap and dialog text200 screenshots. Independent reviewer matched
all15 hashes and found two P2 Dialog focus gaps: a CSS-hidden ancestor is not
filtered and disable/remove of the focused control can send focus outside the
panel. Returned to the same F task for deterministic Red→Green and live browser
regression. No F acceptance or full aggregate yet. BUG-017 focused patch is
reviewed and remains pending that aggregate. Compatibility/device/actual screen
reader coverage remains open. No version/commit/push/deploy.

### F aggregate checkpoint — 2026-09-13

R1/R2 re-review PASS on corrected15-path F delta
(6a9ece081695589ab77a8b03bb4a91bffd3ba768633859b4d19e4b802e2d22a8).
First coordinator `verify:all` f-coordinator-final FAILED1247/1249:
quality1122, PostgreSQL66, cleanup4 pass; browser46/48+9foundation. Both
failures are the F rankings fixture waiting for the empty-team CreateTeam link
after Wave B gives the shared admin a team. RankingsPage correctly renders this
link only when availableTeams is empty. Same F task owns test-only deterministic
fixture correction. Product447-file pre-run snapshot matched after completion;
no product source regression inferred. Full browser lane must rerun after the
actual correction; do not call the original aggregate successful.
42 selected D/E synthetic screenshots retained and representative SE-finished
and DE-generated desktop images reviewed; full-page captures alone do not prove
fixed-navigation placement. Firefox/WebKit preparation ready, no engine test yet.
No version, commit, push or public release.

### F ranking integration correction — 2026-09-13

F now16 paths: a one-attribute RankingsPage decorative-avatar correction plus
the isolated real-user geometry fixture. Role-img-alt Red is retained in
f-membership-green-browser; no axe exclusion. Parent review verified named
links/visible names remain and at least4 real ranking entries force a rest-row.
RankingsPage5/5 and typecheck pass. WaveB mobile failure in f-avatar-green-browser
was traced to expecting1 month row without seeding a played match and accepting
stale all-time rendering. Parent changed only tests/e2e/wave-b.spec.ts: await
exact month/team response, settle loading and verify own-member/empty-or-rendered
state against that response. All-time single-member assertion retained.
Fresh f-period-green passes4/4 WaveB→F journeys (desktop/mobile) +9foundation.
No rankings response mocks, sleeps, retries or disabled assertions. Product/source
rollback snapshots remain outside Git. A fresh full verify:all is the next gate;
compatibility waits its frozen compiled output. Original failed aggregates remain
failed historical evidence. No version/commit/push/deploy.

### Final Wave F local checkpoint — 2026-09-13

Supersedes earlier pending/rework checkpoints for the current candidate. Fresh
`verify:all` passed1249/1249 (quality1122, PostgreSQL66, browser57 including48
journeys, cleanup4), no failed/skipped/todo/interrupted. F16 paths plus parent
WaveB period-test correction passed independent review;447 source hashes stayed
unchanged through the gate. BUG-017 is verified_local. GAP-011/TECH-002 retain
in_progress because additional engine lane is partial: Firefox7/7, WebKit7
native page-creation failures before app assertions, and device/AT/version breadth
remains unverified. See wave-f-local and wave-f-compatibility evidence.

Bounded next debt/QA slice: isolate WebKit runtime on a compatible pinned runner,
then actual mobile safe-area/keyboard and VoiceOver/TalkBack acceptance. Reconfirm
the failure before changing anything; do not change app assertions to hide it.
Existing Q-OPS-003 and SEC-001 negative credential probe remain separate. No new
backlog ID, version, commit, push or public deployment was created.


## UX/UI программа — 2026-09-13

### TECH-006 — UX/UI аудит и готовый бэклог улучшений

- **Type:** research-and-delivery-specification
- **Priority:** P2
- **Status:** in_progress
- **Evidence:** принятый план пользователя; [паспорт и процесс](audits/2026-09-13-ux-ui/README.md), [шаблоны](audits/2026-09-13-ux-ui/templates.md), [сценарии](audits/2026-09-13-ux-ui/scenarios.md).
- **Expected:** evidence-based Flow/CJM, полный capability/state coverage, схемы, deduplicated canonical backlog, эпики/истории/задачи/подзадачи и ready sprint queue без потери функций.
- **Actual:** GAP-012 принят locally1257/1257. Основной pilot390 и desktop mixed-input завершены в указанном объёме; [находки F-PILOT-001–007](audits/2026-09-13-ux-ui/pilot/report.md) входят в этот work item до синтеза, GAP-013 — эталон постановки. COMPONENTS recheck подтвердил старые7 и новые3 findings в уточнённых границах; [принятая коррекция](audits/2026-09-13-ux-ui/components-recheck-correction/report.md) обязательна при чтении исходного пакета. Visual coverage active-option1440/360 и точное пересечение fixed-nav NOT_TESTED; ошибочный derived occludedByNav boolean отозван. Raw IDREF и положение option ниже1440 viewport сохраняют силу. Интервью и полный backlog ещё не завершены.
- **Текущий синтез:** AUTH/core/TOURNAMENT/TEAM/RESULTS/ADMIN и component targets приняты:35 ready задач; coverage108 требований/72 scenario rows принят с ограничениями. BUG-029 P1 независимо воспроизведён координатором, recovery target принят. Ручная коррекция и reset-контракт приняты, BUG-038/039 ready; пользовательское прохождение ещё не проведено. Q-UX-001/002/003 открыты; гипотезы не получают ready автоматически.
- **Открытое техническое наблюдение:** [manual correction lost response](audits/2026-09-13-ux-ui/judge-additional-observations.md), source-only, runtime NOT_TESTED. Не переносить proof +1 на prefixed correction key; BUG-031 не исправляет этот recovery.
- **Repro:** последовательность и gates в [координации](audits/2026-09-13-ux-ui/coordination.md).
- **Risk:** смешение старой/новой базы, стилистические мнения вместо проблем, потеря второстепенных функций, неподтверждённые user insights.
- **Verification:** fresh source/runtime manifest, browser applicable states/roles/devices, evidence review, user tasks, task readiness, docs links and consistency. Research completion не равен UI implementation.
- **Dependencies:** GAP-012 acceptance для изменённых flow; COMPONENTS можно параллельно с адресным recheck. Остатки GAP-011/TECH-002 не объявлять закрытыми этим аудитом. Production scope отсутствует.

### BUG-018 — Выбор игрока с клавиатуры сохраняет доступную активную опцию и фокус

- **Type:** accessibility-interaction
- **Priority:** P1
- **Status:** ready
- **Scenario / Epic / Story / Sprint:** SC-C02, SC-M01/M02 → EP-UX-CORE «Управление игрой без лишних препятствий» → US-UX-SELECT «Оператор выбирает любого допустимого игрока с клавиатуры» → S1 candidate; готовность проверяется по принятому recheck ниже.
- **Requirements:** MATCH-001/003; AT-MATCH-013/016; [NFR §9–10](requirements/06_NFR_CONSTRAINTS.md#9-accessibility-и-ux). Новый продуктовый ADR не требуется: исправление существующего keyboard contract. GAP-012 определяет состав и приглашения, это изменение их не переопределяет.
- **Evidence:** F-CMP-001 и F-CMP-003 в [отчёте](audits/2026-09-13-ux-ui/components/report.md), raw states `light/autocomplete/open-keyboard-focus`, `light/autocomplete/keyboard-active-option`, `light/autocomplete/chosen-option-focus-lost-to-body`; baseline 9f71b9f, manifest3354f542; [Terra PASS](audits/2026-09-13-ux-ui/components-review.json). Confidence high; глобальная частота неизвестна.
- **User-visible outcome:** оператор слышит/видит текущий вариант и после Enter продолжает ввод с ожидаемой позиции.
- **Pilot recheck:** F-PILOT-004 на accepted r6 подтвердил IDREF/focus и новый Tab-related вариант: старые listbox остаются открыты и перекрывают следующий input. В этой же задаче закрывать popup при уходе фокуса вне owned composite (включая portal) без commit/clear; при Tab к другому combobox прежний popup закрыт. Сохранить click/touch selection до blur и клавиатурную доступность. [Source/evidence](audits/2026-09-13-ux-ui/pilot/source-review.md).
- **Expected:** каждый непустой aria-activedescendant указывает на существующую option внутри принадлежащего combobox listbox; Enter принимает вариант, закрывает список, сохраняет DOM focus в поле. Escape закрывает список без неожиданной замены выбранного значения. ArrowUp/Down синхронно обновляют активную опцию и ссылку.
- **Actual:** option id отсутствует; value-dependent key перемонтирует поле после Enter и отправляет focus в body. Технически подтверждено на исходной версии; фактическая spoken-фраза не проверена.
- **Repro:** `/matches/new` → ввести часть имени → ArrowDown → проверить IDREF → Enter → сопоставить выбранное значение, identity поля и activeElement.
- **Target:** [T-CMP-AUTO-001](audits/2026-09-13-ux-ui/components/target-spec.md#t-cmp-auto-001--autocomplete-клавиатура-и-видимость). В этой задаче DOM/фокус; геометрия списка — BUG-019. Selected, keyboard-active и focus различаются; внешняя рамка — BUG-020.
- **Roles / permissions:** все существующие consumers; выбор не расширяет доступный roster, не обходит busy/distinct/active-user guards. API/types/data: none.
- **Write scope / owner:** один frontend writer: vendored `packages/ic-kit/dist/ic-kit.js` и минимальные consumer seams `MatchCreatePage`, `MatchDetailPage`, judge selector; соответствующие тесты. Перед изменением vendored bundle проверить наличие исходного upstream и установленный порядок обновления; не делать массовую перегенерацию библиотеки.
- **Subtasks:** (1) на GAP-012 подтвердить три consumer seams и создать failing keyboard regression; (2) связать уникальные option IDs с combobox и индексом, очистить IDREF при закрытии/пустом списке; (3) заменить value-dependent keys стабильной identity слота, сохранив controlled label/value/clear; (4) пройти несколько combobox одновременно, фильтрацию активной опции, Enter/click/Escape/clear и disabled/read-only; (5) обновить evidence и traceability.
- **Acceptance:** Given два combobox на странице, When пользователь меняет активную опцию, Then ссылка разрешается только внутри своего listbox, дубли ID отсутствуют. Given выбранный игрок, When Enter завершает выбор, Then значение верно и focus остаётся в том же поле. Given очистка или фильтр без результатов, Then устаревший IDREF не остаётся. Given disabled/read-only, Then список не допускает запрещённого изменения.
- **Verification:** component regression IDREF/focus + web/package typecheck/tests; real browser desktop keyboard и mobile touch emulation, light/dark где компонент используется; accessibility tree и отдельный spoken-AT spot-check с явной отметкой ограничения при недоступности. Общий компонент требует проверки его consumers, build alone недостаточен.
- **Constraints / non-goals:** не выключать aria-activedescendant/focus ради зелёного теста; не менять разрешённые варианты, формат user/guest, серверные правила, навигацию или оформление всех экранов.
- **Risk:** исправление remount может выявить старую зависимость default label от key; контролируемое значение обязано обновляться при prefill/revenge/reset. Нужна адресная проверка этих ветвей.
- **Dependencies:** GAP012-r6 принят; [повторная проверка](audits/2026-09-13-ux-ui/components-recheck-review.json) и её обязательная коррекция приняты. P1 также воспроизведён координатором в пилоте; блокирующих продуктовых решений нет. Постановка принята independent Terra review; runtime будущего исправления ещё не выполнен.
- **Documentation / rollback:** BACKLOG, CHANGELOG_DEV, test traceability и component recheck evidence. Rollback только собственного bounded diff; сохранённая failing regression показывает возвращённое ограничение.

### BUG-019 — Поле выбора и активный вариант видимы над клавиатурой и safe area

- **Type:** layout-interaction
- **Priority:** P2
- **Status:** ready
- **Target overlay D36:** fixed bottom nav no longer exists; accepted outcome is active option and field visible above keyboard/safe area at 360/390px and desktop, with scroll/focus restored. Any older nav-occlusion wording below is superseded, not a directive to keep a bottom bar.
- **Current GWT / historical boundary:** Given picker opened on a narrow phone with software keyboard and safe area, When active option moves by keyboard/touch, Then field and option remain visible without occlusion or lost focus; desktop remains usable. AT-MATCH-016. The older fixed-bottom-nav Expected/Target/GWT below is historical evidence only.
- **Scenario / Epic / Story / Sprint:** SC-C02, SC-M01/M02 → EP-UX-CORE → US-UX-SELECT → S1 candidate после новой базы.
- **Requirements:** MATCH-001/003, AT-MATCH-013/016; [NFR §9–10](requirements/06_NFR_CONSTRAINTS.md#9-accessibility-и-ux); нового ADR/API/data change нет.
- **Evidence:** F-CMP-002, [runtime rects и screenshots](audits/2026-09-13-ux-ui/components/report.md#f-cmp-002--клавиатурная-active-option-скрывается-fixed-navigation), [Terra PASS](audits/2026-09-13-ux-ui/components-review.json), baseline9f71b9f. Наблюдение 1/1 при данной позиции, распространённость по всем экранам не измерена.
- **User-visible outcome:** можно найти и выбрать человека у нижнего края экрана, постоянно видя поле и текущую опцию.
- **Expected:** список выбирает доступную область выше/ниже поля, ограничивается её высотой и прокручивается внутри; активная option попадает в видимую часть. Focus target имеет scroll reserve под fixed nav и safe-area. Открытый список не перекрывается навигацией.
- **Actual:** input y870…914 перекрыт нижней nav при viewport900, active option начинается y939 за viewport.
- **Repro:** открыть длинную форму создания, сфокусировать selector у нижнего края, ввести запрос и ArrowDown; фиксировать viewport screenshot и getBoundingClientRect, не только full-page capture.
- **Target:** [T-CMP-AUTO-001](audits/2026-09-13-ux-ui/components/target-spec.md#t-cmp-auto-001--autocomplete-клавиатура-и-видимость). Если ниже не помещается минимальная строка — открыть вверх; иначе clamp по доступной области; длинный список скроллится. При resize/scroll geometry пересчитывается. Выбранное значение не меняется от автопрокрутки.
- **Write scope / owner:** один frontend writer: Autocomplete popup geometry, application layout scroll reserve, локальные styles/tests. Сохранить существующий fixed BottomNav, порядок разделов, safe-area и judge route без nav.
- **Subtasks:** (1) воспроизвести на GAP-012 при Tab-navigation без искусственного viewport-position override; (2) вычислить доступную область и реализовать flip/clamp/scroll-active; (3) добавить reserve у контейнера/targets с существующими tokens; (4) проверить длинные имена, 0/1/много результатов, последний option, увеличение масштаба, resize и virtual-keyboard уменьшение visualViewport; (5) сохранить before/after evidence.
- **Acceptance:** Given selector у нижнего края, When открыт список и меняется active option, Then поле и активная строка видимы и не пересекают nav. Given мало места с обеих сторон, Then есть прокрутка к активной строке без page overflow и потери focus. Given меню закрыто, Then основной layout не получает скачка размера. Given judge shell без nav, Then лишний нижний резерв не появляется.
- **Verification:** browser 360/390/768/1440, keyboard Tab/Arrows/Enter/Escape, pointer/touch emulation, длинный список и масштаб; viewport rects + screenshots. Physical virtual keyboard/safe-area проверять отдельно, не подменять CSS proxy фактом устройства.
- **Constraints / non-goals:** не прятать nav/варианты, не уменьшать hit targets ниже44px, не заставлять пользователя вручную искать список прокруткой; без серверных изменений и общего restyling.
- **Risk:** overflow ancestor, stacking context и virtual keyboard меняют доступную область; screenshot fullPage может скрыть перекрытие.
- **Dependencies:** GAP012-r6 принят; [повторная проверка](audits/2026-09-13-ux-ui/components-recheck-review.json) и её обязательная коррекция приняты. BUG-018 keyboard semantics. Exact nav intersection на1440/360 и визуальный active option там NOT_TESTED; подтверждён raw ниже viewport и390 tap. Эти ограничения не выдавать за полный geometry pass. Постановка принята independent Terra review; runtime будущего исправления ещё не выполнен.
- **Documentation / rollback:** BACKLOG/CHANGELOG_DEV, traceability новых tests и recheck matrix; rollback scoped styles/component delta.

### BUG-020 — Фокус и выбранное состояние имеют согласованные границы

- **Type:** component-state-consistency
- **Priority:** P2
- **Status:** ready
- **Scenario / Epic / Story / Sprint:** SC-C01/C03/C04 → EP-UX-SYSTEM «Предсказуемые общие компоненты» → US-UX-STATE «Пользователь различает ввод, выбор и ошибку» → S1/S2 candidate; P3 radio-card refinement внутри общего исправления, не отдельный спринт.
- **Requirements:** [NFR §9–10](requirements/06_NFR_CONSTRAINTS.md#9-accessibility-и-ux), существующие AUTH/MATCH/JUDGE acceptance сохраняются; AT сценарии состояний конкретизированы ниже. Product/API/data ADR не требуется.
- **Evidence:** F-CMP-004/005 в [отчёте](audits/2026-09-13-ux-ui/components/report.md), [Terra PASS](audits/2026-09-13-ux-ui/components-review.json), user observation focus/selected, baseline9f71b9f. Отделено от native select, где одна округлая рамка уже корректна.
- **User-visible outcome:** видно, какой компонент принимает ввод и что выбрано; рамка совпадает с геометрией поля и не выглядит вложенным случайным элементом.
- **Expected:** один внешний focus indicator на визуальной границе TextField/Autocomplete; selected cue radio-card сохраняется отдельно от focus. Ошибка остаётся видна вместе с focus, readonly допускает копирование/выделение, disabled сохраняет значение и не фокусируется.
- **Actual:** глобальный :focus-visible возвращает квадратную3px рамку внутреннему input поверх округлой wrapper-border; круглый radio получает квадратный ring. Selected radio-card дополнительно имеет same-color shadow и outer outline.
- **Repro:** login input pointer/keyboard focus; admin readonly field; judge selected radio; выбранная radio-card алгоритма сетки + Tab. Сравнить light/dark и native select контроль.
- **Target:** [T-CMP-FOCUS-001](audits/2026-09-13-ux-ui/components/target-spec.md#t-cmp-focus-001--единая-геометрия-focusselected). Ring3px/offset2px по существующей цветовой системе и radius wrapper; raw outline снимается только при равнозначном wrapper ring. Radio focus на44px label/control shape; selected border/tonal fill и один отдельный outer ring, без дублирующего selected shadow.
- **Write scope / owner:** один frontend writer: `apps/web/src/styles.css`, `ui` component adapters при необходимости и `BracketAlgorithmDialog.css`; source seam библиотеки предварительно сверить, глобально отключать outlines нельзя. Полномочия и видимость полей не меняются.
- **Subtasks:** (1) повторить focus/selected на новой базе и зафиксировать tokens/overrides; (2) исправить composite field indicator без изменения размеров; (3) согласовать native radio/selected-card, сохранить корректный native select; (4) проверить комбинации focus+error, selected+focus, readonly+selection, filled+disabled, open+keyboard; (5) записать state matrix и before/after.
- **Acceptance:** Given focused composite input, Then виден один ring по округлой внешней границе и отсутствует внутренний квадратный дубль. Given selected radio и keyboard focus, Then выбор и фокус различимы, размер не прыгает. Given error+focus, Then сохраняются error text и отдельный focus indicator. Given disabled, Then значение читаемо, control не фокусируется; readonly остаётся доступным для копирования.
- **Verification:** real browser light/dark, 390/1440 +360/zoom, pointer/keyboard, applicable state combinations, clipping/contrast/hit targets. Component/DOM tests только для изменённых semantics; визуальный результат подтверждают кадры и измерения, а не тест на CSS class name.
- **Constraints / non-goals:** не скрывать focus, не убирать keyboard access, не менять фирменную палитру/типографику, не навязывать новый компонент корректным native controls. Text selection не приравнивать к выбранной option.
- **Risk:** :has/focus-visible и specificity пересекаются с vendored component CSS; проверить поддерживаемые движки, не обещать Safari без прогона.
- **Dependencies:** GAP012-r6 принят; [повторная проверка](audits/2026-09-13-ux-ui/components-recheck-review.json) и её обязательная коррекция приняты. Сохранить state catalog и независимые GAP-011/TECH-002 device/AT остатки; продуктовых развилок нет. Постановка принята independent Terra review; runtime будущего исправления ещё не выполнен.
- **Documentation / rollback:** BACKLOG/CHANGELOG_DEV, state matrix, test traceability при добавлении регрессий; rollback своего scoped style delta.

### BUG-021 — Ошибка построения сетки видна в открытом диалоге

- **Type:** error-recovery
- **Priority:** P2
- **Status:** ready
- **Scenario / Epic / Story / Sprint:** SC-C04/SC-T05 → EP-UX-SYSTEM → US-UX-DIALOG «Пользователь понимает результат действия в окне» → S2 candidate; accepted GAP012-r6.
- **Requirements:** AT-TRN-001/004/005 сохраняют состав/генерацию/посев; NFR §9–10. Отдельная UI-приёмка ниже дополняет эти функциональные сценарии, не объявляется уже существующим AT.
- **Evidence:** F-CMP-SUP-001, [report](audits/2026-09-13-ux-ui/components-supplement/report.md), [Terra PASS](audits/2026-09-13-ux-ui/components-supplement-review.json). Controlled503,1440/390; alertInsideModal=false, activeInsideModal=true. High confidence, observed1/1; частота в эксплуатации неизвестна.
- **User-visible outcome:** после неудачного построения сетки пользователь видит причину и восстановление там, где сейчас работает.
- **Expected:** Dialog остаётся открыт с выбранным алгоритмом; error Alert внутри перед footer, видимый/объявляемый и достижимый. Для известного исправимого отказа доступен явный повтор; при неизвестном исходе сначала GET сверяет текущую сетку. Ошибка прав/изменившегося статуса предлагает выход/обновление, а не бесполезный повтор.
- **Actual:** runAction рендерит ошибку на странице за portal; Dialog остаётся поверх неё, особенно скрывая сообщение на390.
- **Repro:** открыть алгоритм на турнире с4 synthetic guests → confirm → controlled503 → проверить положение и доступность ошибки в открытом Dialog.
- **Inputs / target:** [T-DIALOG-ERROR-001](audits/2026-09-13-ux-ui/dialog-target.md#t-dialog-error-001--ошибка-в-активном-контексте), frozen baseline9f71b9f, source `TournamentDetailPage` runAction/page Alert, `BracketAlgorithmDialog`. После GAP-012 обновить строки и повторить repro.
- **Roles / API / data:** прежние organizer permissions; никаких новых endpoint, write retries, optimistic bracket или roster изменений. Использовать существующие GET/POST и ошибки.
- **Write scope:** один frontend writer, TournamentDetailPage + BracketAlgorithmDialog и их tests; общий Dialog adapter только если необходим для фокуса сообщения. BUG-022 пишет те же файлы позже/тем же writer.
- **Subtasks:** (1) fresh failing browser/component case503; (2) scope action error to modal, убрать только дублирующее объявление той же ошибки с подложки; (3) сохранить выбор и дать корректный recovery по типу ошибки; (4) проверить lost response через authoritative GET без автоматического POST; (5) narrow/mobile/keyboard evidence и docs.
- **Acceptance:** Given открытый Dialog, When действие отклонено, Then видны сообщение и следующий шаг внутри него, выбор сохранён. Given потерян ответ, When пользователь проверяет состояние, Then GET определяет актуальную сетку и повторная генерация не отправляется автоматически. Given турнир уже стартовал, Then UI объясняет невозможность действия и не предлагает бесполезный повтор. Given длинная ошибка на390/zoom, Then сообщение и footer достижимы без выхода из Dialog.
- **Verification:** controlled pending/failure/unknown outcome,390/1440, Tab/focus/announcement, network POST count и persisted bracket/version; web tests/typecheck, screenshots и no-horizontal-overflow. API/DB policy остаётся без изменений.
- **Constraints / non-goals:** не закрывать окно молча только чтобы сделать page Alert видимым; не обещать «ничего не изменилось» при неизвестном исходе; не добавлять автоматический повтор мутаций или менять алгоритмы.
- **Risk:** double live announcements, потеря выбора, повторная mutation при уже завершившейся первой операции.
- **Dependencies:** GAP012-r6 принят; [повторная проверка](audits/2026-09-13-ux-ui/components-recheck-review.json) и её обязательная коррекция приняты. BUG-022 отдельно решает pending dismissal. Known/unknown error target принят; failure placement не зависит от Q-UX-001. Постановка принята independent Terra review; runtime будущего исправления ещё не выполнен.
- **Documentation / rollback:** BACKLOG/CHANGELOG_DEV, traceability добавленных tests и новый evidence; rollback только task delta.

### BUG-022 — Действия диалога честно показывают доступность во время запроса

- **Type:** pending-interaction
- **Priority:** P2
- **Status:** blocked_decision
- **Scenario / Epic / Story / Sprint:** SC-C03/C04,SC-T05 → EP-UX-SYSTEM → US-UX-DIALOG → не включать в ready sprint до Q-UX-001.
- **Requirements:** AT-TRN-004/005; NFR §9–10. Серверная отмена построения не входит в scope.
- **Evidence:** F-CMP-SUP-002, [report](audits/2026-09-13-ux-ui/components-supplement/report.md), [Terra PASS](audits/2026-09-13-ux-ui/components-supplement-review.json): Close48px, disabled=false, tabIndex0, pointer/focus ring, guarded no-op; disabled radio-label class отсутствует.
- **Expected:** Close либо выполняет явно описанное закрытие с сохранённым фоновым процессом, либо честно недоступен с понятным ожиданием/выходом. Disabled radio-cards визуально различимы, selected сохраняется; фокус не попадает на доступное на вид, но бесполезное действие.
- **Actual:** в pending footer/radios native-disabled, Close выглядит активным, click/Escape молча игнорируются; cards не показывают disabled-оформление.
- **Repro:** keyboard confirm при heldPOST → focus на Close → click/Escape → реакции/объяснения нет.
- **Inputs / target:** [T-DIALOG-PENDING-001](audits/2026-09-13-ux-ui/dialog-target.md#t-dialog-pending-001--решение-пока-открыто), baseline9f71b9f; [Q-UX-001](OPEN_QUESTIONS.md#q-ux-001--закрытие-окна-во-время-построения-сетки). Предложен closable Dialog с process state на странице; решение не принято.
- **User-visible outcome:** пользователь понимает, что происходит и что сейчас действительно можно сделать.
- **Roles / contracts / scope:** прежние права и single-flight; TournamentDetailPage/BracketAlgorithmDialog/native disabled styles, один frontend writer. Другие Dialog не менять автоматически; API/data none.
- **Subtasks после решения:** (1) зафиксировать одну dismissal policy и убрать альтернативу из ready-постановки; (2) Red для этой политики, focus и disabled cards; (3) синхронизировать callback/native semantics/видимый state и progress; (4) pending→success/error/закрытие/возврат на390/1440; (5) обновить evidence/docs.
- **Acceptance, общая часть:** Given pending, Then selected algorithm неизменен и повторная mutation невозможна. Given visually operable Close, Then он выполняет заявленное действие. Given disabled card, Then native и визуальные состояния совпадают. Given completion/error, Then показан актуальный результат в текущем контексте; окно не открывается неожиданно повторно. Окончательный GWT для закрытия добавляется после Q-UX-001.
- **Verification:** heldPOST, click/Escape/Tab, state/focus последовательность, lost response,390 touch emulation/1440 keyboard, authoritative bracket и число POST. Full product correctness не заменять appearance test.
- **Constraints / non-goals:** не скрывать focus ради вида, не называть закрытие отменой серверной операции, не возвращать optimistic success и не менять все модальные окна одним глобальным правилом.
- **Risk:** ложное ощущение отмены, зависшее модальное окно, повторная запись или потерянное сообщение после закрытия.
- **Dependencies:** Q-UX-001 + GAP-012 recheck; общий error contract BUG-021; UI writer общий/последовательный.
- **Documentation / rollback:** Q-UX-001/DECISIONS при принятии политики, BACKLOG/CHANGELOG_DEV, traceability и target spec; rollback task delta. Нельзя начинать реализацию по этой записи со статусом blocked_decision.

### BUG-023 — Поиск игрока принимает имя и фамилию в любом порядке

- **Type:** search-consistency
- **Priority:** P2
- **Status:** ready
- **Scenario / Epic / Story / Sprint:** SC-C02, SC-T01/T03, SC-M01 → EP-UX-CORE → US-UX-SELECT → S1 candidate, после финальной GAP-012 базы и mobile recheck.
- **Requirements:** TOURNAMENT-003/004, MATCH-001/002; NFR §9–10. Существующие права и AT турнирного roster/матча сохраняются; отдельная приёмка поиска задана ниже.
- **Evidence:** [F-PREP-001](audits/2026-09-13-ux-ui/preparation-evidence/search-order-finding.md), source и runtime r3, Chromium1440×900, обычный organizer. Новые аккаунты уже active: отсутствие первого входа не объясняет результат поиска.
- **Expected:** одного и того же допустимого игрока можно найти по имени, фамилии, обоим словам в любом порядке и частичным фрагментам, без знания порядка label конкретного экрана. Нулевой результат понятен.
- **Actual:** в UserPicker «Поздний» находит «Синтетический Поздний», «Поздний Синтетический» не находит; MatchCreate по последнему запросу находит того же человека. Options0 не сопровождаются объяснением.
- **Repro:** открыть collecting-турнир как organizer; в «Добавить игрока» последовательно ввести одно имя и полное имя; сравнить те же запросы в MatchCreate. Fixture и точный DOM результат указаны в F-PREP-001.
- **Target:** нормализовать query и видимый label в Unicode NFC, lower-case; убрать крайние пробелы, разделить query по последовательностям whitespace. Для непустого query сохранить option, только если каждый непустой token входит подстрокой в нормализованный label. Порядок token не влияет. Пустой/пробельный запрос сохраняет текущий допустимый набор и его порядок. Fuzzy-поиск, транслитерация и новая серверная фильтрация не требуются. `ё` и `е` пока не приравниваются: это отдельная возможность, не скрытое обязательство задачи.
- **States:** при непустом query и0 options показывать в popup «Игроки не найдены» и «Проверьте написание имени». Сообщение — отдельный элемент `role=status`, `aria-live=polite`, `aria-atomic=true` в popup рядом с listbox, вне option. Оно не является selectable option; aria-activedescendant у combobox отсутствует, фокус остаётся в поле. Loading и ошибка загрузки не выдаются за0 результатов. При восстановлении списка введённый query сохраняется. Пустой допустимый directory показывает «Нет доступных игроков», не предлагает обойти права.
- **Write scope / owner:** один frontend writer для общего Autocomplete filter/empty-state seam и его adapters/consumers; перед изменением проверить актуальное расположение библиотеки. API/data/authorization changes: none. Связать с BUG-018/019, чтобы не было конкурирующих writers одного popup.
- **Subtasks:** (1) повторить на новой базе и записать query→IDs для обоих consumers; (2) реализовать общий token predicate без изменения labels/IDs/исходного порядка; (3) добавить empty-state с корректной status-семантикой, сохранив error/loading; (4) проверить полный/частичный/переставленный/разнорегистровый/пробельный запрос и несколько совпадений; (5) проверить keyboard/touch и обновить evidence/документы.
- **Acceptance:** Given active допустимый игрок с именем/фамилией, When запрос содержит оба фрагмента в любом порядке, Then возвращается тот же stable ID во всех применимых селекторах. Given два человека с одинаковыми именами, Then фильтр не объединяет их IDs и не выбирает первого автоматически. Given один token не совпадает, Then виден non-option `role=status` с polite/atomic announcement, aria-activedescendant отсутствует, фокус остаётся в combobox. Given excluded/blocked/roster member, Then улучшенный поиск не возвращает исключённого игрока. Given выбранная option и Enter, Then состав получает нужныйID один раз и фокус не теряется по BUG-018.
- **Verification:** focused predicate/компонентные проверки для независимых краёв; browser390/1440, оба порядка полного имени, partial/Cyrillic/case/whitespace, empty/loading/error, клавиатура/касание. Не считать исправление search выполненным по тому, что fixture использовал обходной запрос из одного слова.
- **Constraints / non-goals:** не менять публичные labels, палитру, форму имён во всём продукте, backend search, permissions/exclusions, правила согласий или auto-selection. Не искать по скрытым email/ID/служебным полям.
- **Risk:** общая библиотека может использовать predicate в других селекторах; проверить всех consumers и сохранить disabled/группы/стабильный порядок. Частота проблемы в аудитории unknown.
- **Dependencies:** GAP012-r6 принят; [повторная проверка](audits/2026-09-13-ux-ui/components-recheck-review.json) и её обязательная коррекция приняты. BUG-018/019 shared seams; имя/family order воспроизведено в preparation, app source bytes неизменны между r3/r6. Mobile order search остаётся будущей приёмкой, не подтверждённым run. Постановка принята independent Terra review; runtime будущего исправления ещё не выполнен.
- **Documentation / rollback:** BACKLOG/CHANGELOG_DEV, state/requirement coverage и traceability добавленных tests; rollback только своего scoped delta.


### GAP-013 — Состав матча предшествует редким настройкам

- **Type:** ux-layout
- **Priority:** P2
- **Status:** ready
- **Target overlay D36/D37:** direct Home → match setup, operator outside roster by default, composition before rare rules; invite controls/challenge prefill are unavailable. Remembered custom values and create/acquire/start depend on Q-UX-005/006; older invite steps below are superseded.
- **Executable readiness boundary:** `ready` относится только к перестановке существующих полей ручного матча, доступным сводкам/ошибкам, сохранению 1v1/2v2 и нынешней guest selection. Reusable guest identity, сохранение custom score между формами и объединённый create/acquire/start не исполнять до Q-UX-004/005/006; старые invite/challenge сценарии ниже не входят в этот work order по D37.
- **Current GWT / historical boundary:** Given C creates for A/B from Home, When C configures 1v1/2v2, Then roster comes before optional rules, C is not a player by default, registered selection sends no invite, and valid options remain reachable. AT-MATCH-016/017. Old invite and Start-hub instructions below are historical; Q-UX-004/005/006 gate new identity/memory/combined mutation.
- **Evidence:** F-PILOT-001, [пилот](audits/2026-09-13-ux-ui/pilot/report.md), [target T-PILOT-CREATE](audits/2026-09-13-ux-ui/pilot/target-spec.md#t-pilot-create--сначала-состав-затем-проверка-правил), [схемы390/1440](audits/2026-09-13-ux-ui/pilot/wireframes.html). Измерение390: первое игровое место y≈1060; частота проблем реальных пользователей неизвестна. Экспертная рекомендация, не доказанная потеря конверсии.
- **Expected:** человек выбирает стороны раньше дополнительных настроек, видит применяемые правила и разрешённые D37 настройки через подписанные раскрываемые блоки.
- **Actual:** название, правила, длинная справка, необязательный судья и приглашения предшествуют составу; пустой suggestions section сохраняет рамку при отсутствии вариантов.
- **Repro:** активный returning user, manual `/matches/new`, creator=false, без recent/frequent/team options; viewport390×844 → положение первого игрового места; сопоставить с p03/p04 pilot.
- **Risk:** потерять selected roster, ошибку в закрытом блоке или прежний контракт ручного создания; legacy challenge/revenge prefill не должен открывать скрытый D37 UI.
- **Verification:** acceptance-level DOM tests на порядок/сводки/disclosure/error focus; browser390/1440 и360 narrow, keyboard/touch, empty/nonempty suggestions, custom rules/2×2/guests/prefill. Полный повтор score engine не требуется для чистой перестановки формы; если изменятся shared contracts/critical mutation — repository-wide gate по AGENTS.
- **Dependencies:** GAP-012 verified_local; BUG-018/019/023 — согласованные контракты выбора. Pilotreview PASS. Общие pending/directory задачи BUG025/026 сформулированы; core target принят Terra; consumer025/026 уточнены после review.
- **Scenario / Epic / Story / Sprint:** SC-M01/M02 → EP-UX-CORE «Управление игрой без лишних препятствий» → US-UX-SETUP «Ведущий задаёт состав и понимает правила» → S3 candidate.
- **Inputs / REQ / AT / ADR:** accepted local GAP012r6 application manifest; MATCH-001–005, MATCH-008/014/015; AT-MATCH-013/015/016/017; D35; target T-PILOT-CREATE. Новый продуктовый режим не вводится. Конкретные JSX seams: MatchCreatePage.tsx slots63–100, form331+, rules382, suggestions389–422, judge423; стили match-create__suggestions в styles.css774+.
- **User outcome / non-goals:** выбор A/B первым; сохранение всех функций. Не менять бренд, правила, API, приглашения, доступность пользователей, право старта, не добавлять постоянные черновики/автостарт/clone. Сохранить существующее исключение AUTH-006 / AT-AUTH-009: при runtime401 безопасный in-memory draft остаётся hidden/inert; повторный вход тем же actor восстанавливает его без replay mutation, другой actor получает чистую форму. Обычный уход со страницы по MATCH-015 по-прежнему уничтожает draft.
- **Write scope / owner:** один frontend writer: `apps/web/src/pages/MatchCreatePage.tsx`, scoped existing styles и focused tests; общий Autocomplete исправляется в BUG-018/019, не форкать его ради этой формы. API/types/data: none.
- **Exact behavior:** порядок: heading/format/creator → side A/B slots и непустые quick choices → rules summary/disclosure → title/judge summary/disclosure → Create/Cancel. D37 скрывает invite summary/control. Старое поле «Судья» как приглашение судьи не возвращается в summary/disclosure; если показан current owner, это только read-only контекст в действующих правах. Сводки из текущего form state, не второй копии. Ошибки раскрывают нужную секцию. Inline buttons aria-expanded/controls, focus сохраняется на trigger; сворачивание активного region возвращает focus. Подробности — [core-target](audits/2026-09-13-ux-ui/core-target.md) и [схема](audits/2026-09-13-ux-ui/core-wireframes.html) только в части, согласованной с D36/D37. Shortcuts остаются у стороны B; заполненное B1 заменяется только после локального preview, команда всегда показывает preview B1/B2. Не вводить произвольное назначение shortcuts активному месту.
- **Roles / states / edges:** manual creator=false; challenge/revenge entry/prefill UI скрыты по D37; 1×1/2×2, registered/guest/team/recent/frequent; пустые группы без blank panel; выбранный недоступный user показывает исходную validation и не теряет остальные данные; длинные имена/названия переносятся; collapsed error открывается; directory loading/empty/error — единый контракт. Submit payload фиксируется на отправке, неизвестный результат не повторять автоматически.
- **Subtasks:** 1) Зафиксировать meaningful Red по порядку и доступности всех возможностей, используя реальный form state; результат — failing acceptance. 2) Переставить существующие slots/controls без изменения handlers/payload, устранить пустую suggestions рамку; результат — UI order и прежний create DTO. 3) Добавить сводки/disclosures с error-focus и prefill, явное назначение B1 и preview команды/замены; результат — видимое состояние даже при закрытом блоке. 4) Проверить desktop/mobile и крайние состояния, обновить docs и приложить viewport evidence; результат — ready review delta с измерениями, не только build.
- **Given / When / Then:** Given manual1×1 empty roster, When open390×844, Then первый slot виден до редких параметров, creator вне состава по умолчанию, invite controls отсутствуют. Given2×2, When switchformat, Then по2 места в каждой стороне и все прежние guest/user controls доступны. Given custom rules, When close regions, Then сводки показывают фактические значения. Given invalid field в закрытом блоке, When submit, Then region раскрыт, ошибка доступна, focus на нужном поле, mutation не отправлен. Given старый challenge/revenge deep link, Then скрытый prefill не применяется и новая game invitation не отправляется (GAP-029/AT-UI-INV-001). Given pending mutation, When менять payload-controls, Then принят единый pending contract, дубля POST нет.
- **Documentation / rollback:** UX_FLOWS/AT уточнить структуру без изменения domain правил, traceability для новых тестов, BACKLOG/CHANGELOG_DEV и source evidence; rollback только scoped UI/test diff, без DB rollback. Не редактировать историческую r6 acceptance.
- **Readiness:** для ограниченной перестановки формы контракты BUG025/026 и MATCH синтез приняты. Q-UX-004/005/006 остаются открытыми и блокируют только соответствующие новые механики; старые invite/challenge пункты ниже superseded D37. Исследование частоты/скорости с человеком ещё впереди; не обещать улучшение времени в процентах.


- **Readiness evidence:** [core-review](audits/2026-09-13-ux-ui/core-review.json); target принят, implementation и его обязательные проверки ещё не выполнены.

### BUG-024 — Ошибка и подписи полей счёта читаются в тёмном режиме

- **Type:** accessibility-contrast
- **Priority:** P2
- **Status:** ready
- **Evidence:** F-CMP-SUP-003 теперь runtime-confirmed: controlled point-write503, computed rgb(176,0,32) на rgb(15,17,21),14px,2.58:1. [Recheck](audits/2026-09-13-ux-ui/components-recheck/report.md), [Terra PASS и limits](audits/2026-09-13-ux-ui/components-recheck-review.json). Confidence high для пары; частота ошибок неизвестна.
- **Expected:** Текст `.judge-error` сохраняет минимум4.5:1 на фактическом тёмном фоне; сообщение и восстановление не скрываются и не меняют семантику ошибки.
- **Actual:** Общий `.error` задаёт тёмно-красный текст, не учитывающий immersive фон; runtime пара не достигает4.5:1.
- **Repro:** Открыть активное судейство в disposable fixture, контролируемо вернуть503 до обработки pointPOST, начислить очко, измерить computed `.judge-error` color/font/background и снять viewport.
- **Risk:** Случайно переопределить все светлые ошибки либо повысить контраст подложкой, закрывающей score/actions. Не подменять ошибку успехом и не replay POST.
- **Verification:** Browser реальные error states390/1440, computed contrast без округления до порога; visual проверка фокуса/счёта рядом. Узкий CSS consumer test только если уже есть meaningful contract, тест строкового совпадения цвета не нужен. Для CSS-only изменения не повторять все1257.
- **Dependencies:** COMPONENTS recheck accepted; постановка принята Terra, core-review.json.
- **Scenario / Epic / Story / Sprint:** SC-J03/SC-C03 → EP-UX-SYSTEM → US-UX-STATE «Состояния понятны в каждом shell» → S2 candidate.
- **Inputs / REQ / AT / ADR:** JUDGE-009; AT-MATCH-007 (ошибка конфликта), NFR§9–10; [W3C criteria](audits/2026-09-13-ux-ui/standards.md). New ADR не требуется. Target T-CMP-R-DARK-001.
- **Exact behavior / write scope:** Один frontend writer, scoped `.judge-error` в apps/web/src/styles.css. В `.app-shell--immersive:not(:has(.auth-layout))` задать локальный `--judge-error-text: #f58181` (значение существующей dark palette ic-kit) и использовать его только у `.judge-error`; итоговый computed contrast обязан пройти на всех фактических backgrounds этой ошибки. Не ссылаться вслепую на `--error-main`: immersive shell не включает весь library dark theme и может унаследовать светлое значение. Сохранить role=alert и текст. API/types/data: none. Не менять светлый `.error`.
- **Subtasks:** 1) Зафиксировать baseline computed pair и viewport. 2) Scoped token override. 3) Реальная ошибка в judge, повтор измерения/визуальная проверка и docs. Каждый шаг использует предыдущий artifact, не новый дизайн.
- **Acceptance:** Given dark judge with a real error, When render14px text, Then computed ratio≥4.5:1 и полный текст доступен. Given light form error, When revisit, Then её существующий стиль/роль сохранены. Given pending/readonly score, Then никакая CSS правка не меняет enabled state или повтор запросов.
- **Documentation / rollback:** BACKLOG/CHANGELOG_DEV, evidence; scoped CSS rollback, noDB. Решений продукта нет; runtime remedy ещё не реализован.


- **Readiness evidence:** [core-review](audits/2026-09-13-ux-ui/core-review.json); target принят, implementation и его обязательные проверки ещё не выполнены.

- **Дополнение финального visual review:** на [c01 ручной коррекции](audits/2026-09-13-ux-ui/judge-correction-probe/screenshots/c01-commit-then-lost-response.png) подписи «Счёт стороны A/B» тёмные на dark card, тогда как native «Текущий подающий» светлый. Это наблюдение rendered screenshot, не новое computed измерение ratio. Source: TextField=ic-kit Input, library labelText использует --color-text-secondary; color секции этого не переопределяет. Scope этой задачи дополняется двумя подписями в JudgePage, без расширения темы на весь Input.
- **Точный label target:** перед каждым из двух TextField вывести собственный native label с htmlFor на стабильный уникальный id соответствующего input; library label prop убрать, чтобы не было дубликата accessible name. Класс `.judge-correction__label` наследует #f5f5f5 секции. Не менять цвет значения/placeholder/границу белого input или переопределять глобальные library tokens. Current server label остаётся прежним. Это два текстовых label, не новая UI primitive.
- **Дополнительные subtasks/GWT:** до правки снять computed color/background/font подписи в действующей correction форме; после проверить label↔input association, click-label focus, Tab порядок BUG-031, minimum4.5:1 и отсутствие изменения белого input. Проверить normal/filled/focused/error/pending360/390/1440. При disabled поле остаётся явно подписанным. Один writer JudgePage+локальный styles, без API/data; будущий computed result не заявлять по PNG.

### BUG-025 — Селектор игроков различает загрузку, пустой результат и ошибку

- **Type:** async-feedback
- **Priority:** P2
- **Status:** ready
- **Evidence:** F-CMP-R-001, ADMIN-PICKER-PENDING/ERROR в [runtime recheck](audits/2026-09-13-ux-ui/components-recheck/report.md), controlled pending и503 по одному прогону; TerraPASS. UserPicker.tsx fetch effect и loadError. Confidence high по состоянию.
- **Expected:** До готовности каталога статус понятен; ошибка предлагает явный повтор GET; готовый пустой каталог/нулевой поиск не похож на незагруженный список.
- **Actual:** Pending picker enabled, options0 и нет role=status. После503 control остаётся enabled, retry отсутствует. Отдельный BUG023 покрывает порядок поиска и zero-query feedback.
- **Repro:** Scoped admin до старта турнира открывает ручное добавление registered user; удержать directoryGET, затем503; сопоставить control/status/error/retry. Повторить родственный UserPicker consumer.
- **Risk:** Потерять selected value/query, показать устаревший ответ после смены excludes или дать выбрать недоступного игрока. Не считать mustChangePassword признаком inactive.
- **Verification:** Meaningful component tests deferred GET/success/error/retry/out-of-order/excludes, keyboard/focus/aria; browser1440/390 on tournament and team consumers. Поскольку sharedUI меняется — web typecheck/relevant suite; backend/DB protocol неизменен.
- **Dependencies:** BUG018 keyboard identity; BUG023 shared empty/search wording, не второй status для той же причины. Frozen app current; consumer contract принят Terra, core-review.json.
- **Scenario / Epic / Story / Sprint:** SC-C02/SC-T02/SC-TE01 → EP-UX-SYSTEM → US-UX-SELECT-STATE «Понятно, готов ли выбор» → S1 candidate.
- **Inputs / REQ / AT / ADR:** MATCH-003/004, TOURNAMENT-005/007, TEAM-003/004; AT-TRN-004, AT-TEAM-001/002; NFR§9–10; D35. Current UserPicker.tsx, tournament/team consumer tests. API/types/data: none; только существующий directoryGET. JUDGE handover native select использует тот же контракт, evidence j08/j09 в принятом с correction пакете JUDGE.
- **Exact behavior / write scope:** Один frontend writer: UserPicker.tsx и native handover select в JudgePage.tsx + focused tests, минимальные consumer props. Ввести явные loading/ready/error. Loading: combobox и clear недоступны, рядом role=status «Загружаем игроков…», region aria-busy=true. Ready: существующие фильтры; при0available «Нет доступных игроков», при0querymatch BUG023. Error: связанный через describedby alert «Не удалось загрузить игроков» и enabled button «Повторить загрузку»; combobox disabled. Retry запускает один GET, disabled до ответа; ошибка не повторяется автоматически. Selected ID/label/query сохраняются, пока свежие данные не подтвердят необходимость обычной validation; никаких автоматических roster mutations.
- **Edge cases:** Последний актуальный request отвечает за UI; старые responses после unmount/exclude-change не возвращают запрещённые варианты. Exclude/self/source active сохраняются. Parent disabled сильнее ready. Успешныйretry стирает прежнюю error; focus от retry после завершения переводится на доступный combobox (или остаётся на error retry при неудаче), через явный запрос retry, не при каждой background hydration. Смена props не стирает ввод без необходимости.
- **Subtasks:** 1) Deferred Red для loading/error/retry и сохраненияquery. 2) State machine и один локальный retry. 3) Согласовать empty с BUG023, stale response guard и disabled clear. 4) Browser consumers/states и docs.
- **Acceptance:** Given held initialGET, When open picker, Then загрузка отличима и выбрать нельзя. Given503, Then alert+retry, entered state сохранён. Given retry success, Then свежие permitted options, olderror исчезла и focus возвращён к picker. Given obsolete response after changed excludes, Then excluded ID не появляется. Given ready empty/queryzero, Then соответствующий status из BUG023, без fictitious option/activeDesc.
- **JUDGE consumer:** loading/error отключают select и transfer; ready без preselection; empty «Некому передать»; retry только directory GET, сохраняет выбранный ID до authoritative validation. D7 eligibility и transfer protocol не меняются. После явного успешного retry focus возвращается в доступный select, при повторной ошибке остаётся у retry. Не менять score controls ради фоновой загрузки людей.
- **Documentation / rollback:** UX_FLOWS states, AT focused mapping/traceability если добавлены tests, BACKLOG/CHANGELOG_DEV. Scoped UI rollback; noDB. Нет новой продуктовой политики.


- **Readiness evidence:** [core-review](audits/2026-09-13-ux-ui/core-review.json); target принят, implementation и его обязательные проверки ещё не выполнены.

### BUG-026 — Отправленная конфигурация не расходится с редактируемой формой

- **Type:** async-interaction
- **Priority:** P2
- **Status:** ready
- **Evidence:** F-CMP-R-002 MC-PENDING-1440 и ADMIN-OVERRIDE-PENDING: action disabled, creator/invite checkbox или targetpicker enabled после отправки payload. [Recheck](audits/2026-09-13-ux-ui/components-recheck/report.md), TerraPASS. High confidence для state mismatch; не заявляется duplicate-write bug.
- **Expected:** Пока запрос создания/ручного включения выполняется, все controls, определяющие уже отправленный payload, недоступны для изменения и показывают отправленные значения.
- **Actual:** Пользователь может поменять видимые creator/invite или selected person, хотя выполняется запрос с прежним значением; UI не показывает этот разрыв.
- **Repro:** Controlled hold POST при manual create или tournament override после подтверждения; попытаться изменить зависимости submit, затем разрешить ответ и сверить UI/persisted actor/participants/policy.
- **Risk:** Отключить unrelated navigation либо решить pendingDialog QUX001 без решения; потерять formstate при ошибке; обойти существующую idempotency защиту.
- **Verification:** Deferred mutation tests и browser390/1440 на двух consumers; захват отправленного payload и authoritative readback success, explicit knownerror preservingvalues; проверка disabled через мышь/keyboard/clear. Shared domain/API не меняются; scoped web checks, а при изменении critical mutation contract — fullgate/PG по AGENTS.
- **Dependencies:** GAP012 accepted; BUG025 directory-state и BUG018 disabled/focus semantics. QUX001 close-policy остаётся отдельным BUG022: эта задача её не выбирает. Постановка принята после адресной correction, см. core-review.json.
- **Scenario / Epic / Story / Sprint:** SC-M01/SC-T02/SC-AD03/SC-C03 → EP-UX-SYSTEM → US-UX-SUBMIT «Вижу именно отправленные данные» → S2 candidate.
- **Inputs / REQ / AT / ADR:** MATCH-001/003/008, AT-MATCH-017; TOURNAMENT-005/007 и AT-TRN-004; D35 manual include acceptance; current MatchCreatePage and TournamentDetailPage. T-CMP-R-ASYNC-001/OVERRIDE-001 из recheck. API/types/data: none.
- **Exact behavior / write scope:** Один frontend writer: form mutation boundary MatchCreatePage + scoped manual-add controls TournamentDetailPage + pending start/setup controls JudgePage и tests. Выбрать конкретный вариант: disable всех payload-controls (format/creator/slots/guests/title/rules/judge/invites; manual-add targetpicker/clear/confirm; judge setup first-server/swapSides/Start/Cancel), а не второй editable snapshot UI. Сохранять значения в прежнем state. Не менять закрытиеDialog/route/cancel policy, не объявлять отменой уже отправленныйPOST. Existing saving indicator становится доступным status; дополнительный modal/spinner fullscreen не вводить.
- **Edge cases:** Success только после authoritative response, прежний navigation/clearing. Known failure разблокирует поля с теми же attemptedvalues; retry только явный. Unknown outcome не autoPOST, existing recovery/BUG021 contract. Быстрая последовательность до отправки фиксируется обычным обработчиком; после отправки событие не меняет отображаемый payload. Parent directory loading/error также блокирует выбор. JUDGE j02 воспроизвёл только удержанный первый шаг Start: radios и swapSides остаются enabled. Их участие во втором setup payload установлено по source, а не отдельным runtime hold второго шага. Target требует disabled до завершения обоих шагов; held/failure второго шага остаётся обязательной приёмкой реализации, не выполненным evidence.
- **Subtasks:** 1) Red: heldPOST, зависимое поле изменяемо. 2) Полный перечень payloadcontrols из сериализатора и единый pending disabled boundary. 3) Error/success recovery без сброса попытки. 4) Browser input methods, capturedpayload/readback, docs.
- **Acceptance:** Given submitted create with creator=false/invite=false, When try toggle/type whilePOSTheld, Then значения/roles не меняются и лишнегоPOSTнет. Given selected manual-addX, WhenPOSTheld and attemptY/clear, Then виденX, изменение невозможно. Given knownfailedrequest, When retryafterfix, Then прежниеданные доступны и отправка явная. Given success, Then UI/persisted совпадают; эта задача не расширяет admin/organizer rights.
- **JUDGE acceptance:** Given held first step start/setup, Then first-server и swapSides недоступны; captured start и следующий setup payload отражают исходные значения. При известном отказе сохраняются попытка и сообщение; повтор не выполняется автоматически. Проверить также второй шаг held/failure без повторного старта и смены владения.
- **Documentation / rollback:** UX_FLOWS pending/error, AT/traceability focusedregressions, BACKLOG/CHANGELOG_DEV. Только scoped UI rollback. Общий backend/release не затрагивается.


- **Readiness evidence:** [core-review](audits/2026-09-13-ux-ui/core-review.json); target принят, implementation и его обязательные проверки ещё не выполнены.

### BUG-027 — Выход при первом пароле завершает текущую сессию

- **Type:** bugfix
- **Priority:** P2
- **Status:** ready
- **Evidence:** F-AUTH-001; [Отчёт AUTH](audits/2026-09-13-ux-ui/auth/report.md), [находки](audits/2026-09-13-ux-ui/auth/findings.json), [точная спецификация](audits/2026-09-13-ux-ui/auth/target-spec.md), [схемы](audits/2026-09-13-ux-ui/auth/wireframes.html). Frozen45payloads проверены и приняты; [независимое review](audits/2026-09-13-ux-ui/auth-review.json). Частота в аудитории неизвестна.
- **Expected:** Кнопка «Выйти» завершает текущую ограниченную сессию, после чего вход действительно требуется заново.
- **Actual:** Кнопка выполняет только navigate: logout POST отсутствует, тот же browser context получает auth/me200; свежий context401. Ограничение mustChangePassword продолжает защищать продуктовые данные.
- **Repro:** Пакет AUTH, finding F-AUTH-001, runs/evidence; повторять на accepted local GAP012r6, synthetic users, desktop1440/mobile390 и narrow360 по применимости.
- **Scenario / Epic / Story / Sprint:** SC-A01 → EP-UX-ACCESS → US-UX-ENTRY → S2 candidate.
- **Inputs / REQ / AT / ADR:** AUTH-003/006; AT-AUTH-001/009; accepted323-path candidate-source; target T-AUTH-SESSION-EXIT из AUTH. Доказательства package scope, не production claim.
- **Write scope / contracts:** FirstPasswordPage.tsx, существующий auth context/API logout и focused tests. API/types/data: без изменений; ограничения текущих handlers и авторизации сохраняются.
- **Exact behavior:** Один POST logout; на время запроса обе операции формы заблокированы, подпись «Выход…». Успех или401 очищает auth state и поля, replace на /login; back не восстанавливает сессию. При ином отказе оставаться на форме, сохранить поля, показать доступную ошибку и разрешить явный повтор. Не отзывать другие сессии.
- **Given / When / Then:** Given first-password session, When «Выйти», Then ровно один POST, auth/me401 и login. Given другой действующий session, Then он сохраняется. Given503, Then форма и значения сохранены, сообщение сфокусировано, повтор только по действию.
- **Subtasks:** 1) Прочитать source/target и зафиксировать failing observable acceptance на изменяемое поведение. 2) Внести ограниченный delta в указанный consumer с existing primitives. 3) Пройти описанные state/edge cases, keyboard и viewport checks; сохранить before/after evidence. 4) Передать независимому reviewer точный diff и evidence, обновить связанную документацию.
- **Risk:** Регрессия restricted logout/guards; не расширять allowlist, не менять password policy и успешную смену пароля. Brand/navigation redesign вне задачи.
- **Verification:** Focused meaningful component tests и web typecheck; реальный Chromium1440/390,360 по layout, keyboard focus/long text/pending/known error/reauth где применимо. Для logout проверить response и server auth state, не только URL. Прочие задачи не требуют повторять1257tests без новых contract/critical-journey изменений; AGENTS risk gate остаётся обязательным.
- **Dependencies:** Независимое AUTH review PASS; продуктовых развилок нет.
- **Documentation / rollback:** BACKLOG/CHANGELOG_DEV, UX_FLOWS/AT уточнение наблюдаемого поведения и test traceability; сохранить исторические evidence. Rollback только своего UI/test/docs delta, без данных/деплоя.


### BUG-028 — Ошибки авторизации дают понятное исправление и сохраняют фокус

- **Type:** accessibility-ux
- **Priority:** P2
- **Status:** ready
- **Evidence:** F-AUTH-002; [Отчёт AUTH](audits/2026-09-13-ux-ui/auth/report.md), [находки](audits/2026-09-13-ux-ui/auth/findings.json), [точная спецификация](audits/2026-09-13-ux-ui/auth/target-spec.md), [схемы](audits/2026-09-13-ux-ui/auth/wireframes.html). Frozen45payloads проверены и приняты; [независимое review](audits/2026-09-13-ux-ui/auth-review.json). Частота в аудитории неизвестна.
- **Expected:** Человек понимает отказ формы и может исправить его с клавиатуры, не разбирая коды API.
- **Actual:** После отказа фокус BODY/submit; mismatch не связан с полями через invalid/description; политика пароля показывается TOO_SHORT/MISSING_* .
- **Repro:** Пакет AUTH, finding F-AUTH-002, runs/evidence; повторять на accepted local GAP012r6, synthetic users, desktop1440/mobile390 и narrow360 по применимости.
- **Scenario / Epic / Story / Sprint:** SC-A01/A02 → EP-UX-ACCESS → US-UX-RECOVERY → S2 candidate.
- **Inputs / REQ / AT / ADR:** AUTH-004/005; AT-AUTH-003/009; accepted323-path candidate-source; target T-AUTH-ERRORS из AUTH. Доказательства package scope, не production claim.
- **Write scope / contracts:** LoginPage.tsx, FirstPasswordPage.tsx, existing Alert/TextField и focused tests. API/types/data: без изменений; ограничения текущих handlers и авторизации сохраняются.
- **Exact behavior:** После submit error один раз фокусировать именованный Alert с tabIndex=-1; не перехватывать фокус при каждом вводе. Mismatch связывает оба поля с сообщением aria-describedby/invalid; изменение убирает устаревшую ошибку. Известные policy reasons переводятся в конкретные требования на русском, неизвестные — общий безопасный текст. Неверная пара email/пароль остаётся общим сообщением; blocked/rate-limit как в текущем контракте.
- **Given / When / Then:** Given mismatch, When submit, Then оба поля связаны с ошибкой и данные сохранены. Given policy refusal, Then нет внутренних кодов и видны необходимые действия. Given wrong credentials, Then ответ не раскрывает существование аккаунта. Given edit, Then нет повторного focus stealing.
- **Subtasks:** 1) Прочитать source/target и зафиксировать failing observable acceptance на изменяемое поведение. 2) Внести ограниченный delta в указанный consumer с existing primitives. 3) Пройти описанные state/edge cases, keyboard и viewport checks; сохранить before/after evidence. 4) Передать независимому reviewer точный diff и evidence, обновить связанную документацию.
- **Risk:** Не усилить account enumeration; не менять API errors/password policy и reauth isolation. Brand/navigation redesign вне задачи.
- **Verification:** Focused meaningful component tests и web typecheck; реальный Chromium1440/390,360 по layout, keyboard focus/long text/pending/known error/reauth где применимо. Для logout проверить response и server auth state, не только URL. Прочие задачи не требуют повторять1257tests без новых contract/critical-journey изменений; AGENTS risk gate остаётся обязательным.
- **Dependencies:** Согласовать визуальное кольцо с BUG-020; логика независима. AUTH evidence и постановка приняты независимым reviewer.
- **Documentation / rollback:** BACKLOG/CHANGELOG_DEV, UX_FLOWS/AT уточнение наблюдаемого поведения и test traceability; сохранить исторические evidence. Rollback только своего UI/test/docs delta, без данных/деплоя.


### GAP-014 — В обучении каждое действие имеет отдельный смысл

- **Type:** ux-copy
- **Priority:** P3
- **Status:** ready
- **Evidence:** F-AUTH-003; [Отчёт AUTH](audits/2026-09-13-ux-ui/auth/report.md), [находки](audits/2026-09-13-ux-ui/auth/findings.json), [точная спецификация](audits/2026-09-13-ux-ui/auth/target-spec.md), [схемы](audits/2026-09-13-ux-ui/auth/wireframes.html). Frozen45payloads проверены и приняты; [независимое review](audits/2026-09-13-ux-ui/auth-review.json). Частота в аудитории неизвестна.
- **Expected:** На информационном шаге нет двух разных кнопок с одинаковым результатом; обучение можно закрыть и повторить.
- **Actual:** На шагах1–6 «Далее» и «Пропустить шаг» вызывают одинаковый переход. Последствие для понимания — экспертная гипотеза, частота неизвестна.
- **Repro:** Пакет AUTH, finding F-AUTH-003, runs/evidence; повторять на accepted local GAP012r6, synthetic users, desktop1440/mobile390 и narrow360 по применимости.
- **Scenario / Epic / Story / Sprint:** SC-A01/A03 → EP-UX-ACCESS → US-UX-LEARN → S5 candidate.
- **Inputs / REQ / AT / ADR:** ONB-001/002/003/005; AT-ONB-003; D34; accepted323-path candidate-source; target T-AUTH-ONBOARDING из AUTH. Доказательства package scope, не production claim.
- **Write scope / contracts:** OnboardingPage.tsx и focused tests. API/types/data: без изменений; ограничения текущих handlers и авторизации сохраняются.
- **Exact behavior:** Шаги1–6: одно primary «Далее», вторичное «Закрыть онбординг», пояснение «Шаг ознакомительный: можно сразу перейти дальше». Шаг7 сохраняет tutorial и завершение без него. Close сначала сохраняет completion; ошибка остаётся на текущем шаге. Reload продолжает сохранённый шаг; restart из профиля сбрасывает его. Tutorial cancel/finish возвращает на7 без auto-complete D34.
- **Given / When / Then:** Given informational step, Then один advance и отдельный close; никакое упражнение не обязательно. Given tutorial return, Then шаг7 и отдельное завершение. Given pending/error, Then нет двух transitions/потери текущего шага.
- **Subtasks:** 1) Прочитать source/target и зафиксировать failing observable acceptance на изменяемое поведение. 2) Внести ограниченный delta в указанный consumer с existing primitives. 3) Пройти описанные state/edge cases, keyboard и viewport checks; сохранить before/after evidence. 4) Передать независимому reviewer точный diff и evidence, обновить связанную документацию.
- **Risk:** Не удалить observable skip optionality и не объявлять tutorial completion onboarding completion. Brand/navigation redesign вне задачи.
- **Verification:** Focused meaningful component tests и web typecheck; реальный Chromium1440/390,360 по layout, keyboard focus/long text/pending/known error/reauth где применимо. Для logout проверить response и server auth state, не только URL. Прочие задачи не требуют повторять1257tests без новых contract/critical-journey изменений; AGENTS risk gate остаётся обязательным.
- **Dependencies:** Независимое review подтвердило эквивалентность ONB-002/AT-ONB-003 и сохранение D34.
- **Documentation / rollback:** BACKLOG/CHANGELOG_DEV, UX_FLOWS/AT уточнение наблюдаемого поведения и test traceability; сохранить исторические evidence. Rollback только своего UI/test/docs delta, без данных/деплоя.


### GAP-015 — Главная сначала показывает действие у стола и текущий статус ведения

- **Type:** ux-hierarchy-and-state-presentation
- **Priority:** P2
- **Status:** verified_local (текущая часть D36 этапа 2; исторический exact-layout target ниже superseded)
- **Local acceptance (2026-09-18):** [stage 2 final receipt](audits/2026-09-13-ux-ui/implementation/stage2-final-evidence/stage2-final-receipt.json) связывает base `e3b22876`, frozen R2 v2, единый CI 1291/1291, Terra PASS и root acceptance. Фактические player/current judge/organizer дела, текущая подпись судьи и иерархия Home проверены локально. Публикация 4.1.0 и телефонная приёмка не проведены; исторический экспертный GAP-015 остаётся `superseded_target`.
- **Stage 2 implementation overlay (2026-09-18):** `currentTasks` включает все собственные дела по фактическим ролям player/current judge/organizer, с приоритетом идущей игры, первыми двумя карточками и раскрытием остальных. Активный судья берётся из `activeJudge`, terminal подпись остаётся исторической. Старые «exact layout/DTO shape» ниже — superseded этим overlay и D36: совместимый `activeEvents` сохранён, добавлены `currentTasks` и `recentRole`. Новые права, статистические формулы и миграции не вводятся.
- **Target overlay D36:** compact avatar/name/surname/rank/played/wins/losses, direct match/tournament CTAs, current player/judge/organizer task before history; secondary stats in profile. Five-tab/Start-hub/greeting target below is superseded. See GAP-030/031 and AT-HOME-003.
- **Current GWT / historical boundary:** Given Home for active player, judge or organizer, When current events load, Then compact header and direct match/tournament actions lead, role-scoped current task precedes history, secondary stats are in profile, all required entries remain discoverable. AT-HOME-001..003. Old five-tab/Start/greeting instructions below are historical only.
- **Evidence:** F-AUTH-004/F-PILOT-007 и F-PILOT-005/F-RESULTS-005; [AUTH](audits/2026-09-13-ux-ui/auth-review.json), [RESULTS](audits/2026-09-13-ux-ui/results/report.md), [populated Home](audits/2026-09-13-ux-ui/results/evidence/runtime/home-results-390.png). Layout benefit remains expert hypothesis; released judge mismatch observed, score permissions unchanged. RESULTS independent evidence/target review PASS.
- **Expected:** оператор видит текущую игру/вход к созданию раньше статистики, понимает актуальность ведения; все данные и входы сохранены.
- **Actual:** локальный кандидат ставит действия и все собственные текущие дела перед историей и рейтингом; активная подпись судьи соответствует текущей серверной сессии. [Финальная локальная приёмка](audits/2026-09-13-ux-ui/implementation/stage2-final-evidence/stage2-final-receipt.json).
- **Historical actual before D36 stage 2 (superseded):** statistics/rival block предшествует игре; active card после release использует последнее historical judge session и «Вы судили», хотя activeJudge=null.
- **Repro:** пустой и populated Home, active standalone/tournament/both; acquire→release→Home/detail compare; контроль active reservation, same-user another auth session и terminal card.
- **Scenario / Epic / Story / Sprint:** SC-A03/M01/J02/R01 → EP-UX-CORE → US-UX-ORIENT → S3 candidate.
- **Inputs / REQ / AT / ADR:** HOME-001–006, AT-HOME-001/002, AT-EMPTY-001, AT-VIS-001/002/004; D5/D17; accepted GAP012r6, core-target.md, [обязательный RESULTS target](audits/2026-09-13-ux-ui/results-correction.md). Исходная proposed DTO expansion заменена следующим минимальным контрактом.
- **Exact layout:** greeting/refresh → доступные active standalone/tournament cards либо «Начать» → уведомления/профиль → avatar/statistics со всеми5метриками и rival/revenge → ranking/top3 с выбранным периодом → последние5 и вся история. При active event cards основной переход ведёт в существующий detail; «Новая игра» отдельная secondary /start. При отсутствии active один primary «Начать». Сохранить max-width/5tabs, один порядок на390/360/1440, перенос длинных строк и controls≥44px. Metrics 2-column на узком экране, 5 values без скрытия; «Win rate» можно подписать «Доля побед» без изменения значения/формата процента. Не гарантировать все карточки above fold при произвольных длинных именах; первый игровой блок предшествует метрикам.
- **Exact active semantics / contracts:** existing Home matchCard для nonterminal использует judgeName=match.activeJudge?.displayName ?? null и userRole participant→activeJudge.userId account relation→organizer→viewer. Последняя historical session не подменяет active judge/role. При null текст «Сейчас счёт не ведут», не «слот свободен»: reservation может блокировать acquire. Terminal cards сохраняют historical attribution и HOME-003 metadata. Active роли показываются в настоящем времени, terminal в прошедшем. DTO shape не расширяется; semantics активной карточки документируется. Query visibility/list filters/API score guards остаются неизменными.
- **Два устройства / точная подпись:** Home userRole обозначает аккаунт, не auth-session. При active userRole=judge отдельную self-role подпись не показывать: уже есть «Судья: {judgeName}». Home не говорит «Вы ведёте матч» на любом устройстве и не требует передачи authSessionId. Given один аккаунт в двух сессиях, Then обе карточки нейтральны, а JudgePage разрешает изменение только фактической owning session.
- **Write scope / owner:** один bounded writer HomePage.tsx/styles, home-service.ts matchCard presentation, API contract/as-built descriptions и tests. Права, статистика, ranking/rival алгоритмы, данные и migrations не меняются.
- **Constraints / edges:** current judge displayName/userId не доказывает auth-session ownership; Home никогда не даёт score/autoacquire из роли. Reservation/refused/expired/free различаются в detail. Current+historical users, participant+judge actor priority, nojudge terminal, guest/blocked names, zero/one/both active, empty/skeleton/background error/period race. Фоновый refresh не крадёт focus. Непоказываемые поля terminal не исчезают из истории.
- **Subtasks:** 1) Red для порядка/полного набора функций и active/released/reserved/historical card semantics. 2) Минимально разделить active/terminal presentation и сохранить DTO shape. 3) Переставить blocks/labels без новых навигационных обработчиков. 4) Browser/contracts/PG visibility gate, before/after и docs.
- **Given / When / Then:** Given newcomer, Then игра до метрик и один primary. Given populated, Then все5метрик/rival/revenge/period/recent5/profile/notifications доступны. Given released or reserved with activeJudge=null, Then Home не называет исторического пользователя текущим и не обещает свободное acquire. Given other auth session of same account, Then card не выдаёт mutation permission. Given terminal, Then historical attribution сохранена. Given hidden active event, Then оно не появляется через новый formatter. Given period race/error, Then прежние guards и данные сохраняются.
- **Risk:** потерять второстепенные входы, неверно переименовать historical роль в current owner, изменить disclosure/visibility вместо presentation.
- **Verification:** Home frontend/service/contract tests и web/API typecheck; disposablePG active visibility/released/reserved fixtures, browser360/390/1440 keyboard/long text/loading/empty/error/populated. Repository-wide gate требуется из-за cross-package response semantics, старый1257 не переобъявлять acceptance нового UI.
- **Dependencies:** MATCH/JUDGE core target принят; RESULTS populated evidence и этот уточнённый target требуют independent review. Не обещать сокращение времени без user research.
- **Documentation / rollback:** API_SPEC/API_AS_BUILT active presentation, UX_FLOWS/AT-HOME/test traceability/BACKLOG/CHANGELOG_DEV; откат своих code/tests/docs без данных и выпуска.


### GAP-016 — Описание проблемы в помощи поддерживает несколько строк

- **Type:** ux-control
- **Priority:** P3
- **Status:** ready
- **Evidence:** F-AUTH-005; [Отчёт AUTH](audits/2026-09-13-ux-ui/auth/report.md), [находки](audits/2026-09-13-ux-ui/auth/findings.json), [точная спецификация](audits/2026-09-13-ux-ui/auth/target-spec.md), [схемы](audits/2026-09-13-ux-ui/auth/wireframes.html). Frozen45payloads проверены и приняты; [независимое review](audits/2026-09-13-ux-ui/auth-review.json). Частота в аудитории неизвестна.
- **Expected:** Человек видит и редактирует длинное описание проблемы со ссылкой прямо в поле сообщения.
- **Actual:** Контрол сообщения — однострочный input при maxlength4000. Неудобство длинного ввода — экспертная гипотеза; отправка/503retry работают.
- **Repro:** Пакет AUTH, finding F-AUTH-005, runs/evidence; повторять на accepted local GAP012r6, synthetic users, desktop1440/mobile390 и narrow360 по применимости.
- **Scenario / Epic / Story / Sprint:** SC-A03 → EP-UX-ACCESS → US-UX-HELP → S5 candidate.
- **Inputs / REQ / AT / ADR:** HELP-003; AT-AUTH-009; accepted323-path candidate-source; target T-AUTH-HELP из AUTH. Доказательства package scope, не production claim.
- **Write scope / contracts:** HelpPage.tsx, scoped field styles при необходимости и Help tests. API/types/data: без изменений; ограничения текущих handlers и авторизации сохраняются.
- **Exact behavior:** Использовать native textarea с текущими field tokens (отдельного компонента ради страницы не создавать). Label/required/maxlength4000/materials description сохраняются. Начальная высота5строк mobile иdesktop; только вертикальный resize, max-height40vh с внутренней прокруткой. Категории/FAQ/submit payload неизменны.503 сохраняет текст, явный повтор один; успех очищает сообщение и объявляется status без перехвата фокуса во время ввода.
- **Given / When / Then:** Given многострочный текст со ссылкой, Then переносы видны и уходят тем же message payload. Given503/401, Then текущие draft/reauth guards сохранены без auto replay. Given pending, Then повтор заблокирован. Given resize360/1440, Then нет горизонтального overflow.
- **Subtasks:** 1) Прочитать source/target и зафиксировать failing observable acceptance на изменяемое поведение. 2) Внести ограниченный delta в указанный consumer с existing primitives. 3) Пройти описанные state/edge cases, keyboard и viewport checks; сохранить before/after evidence. 4) Передать независимому reviewer точный diff и evidence, обновить связанную документацию.
- **Risk:** Не добавить richtext/attachments/новый API и не обрезать сохранённый текст стилем или контролом. Brand/navigation redesign вне задачи.
- **Verification:** Focused meaningful component tests и web typecheck; реальный Chromium1440/390,360 по layout, keyboard focus/long text/pending/known error/reauth где применимо. Для logout проверить response и server auth state, не только URL. Прочие задачи не требуют повторять1257tests без новых contract/critical-journey изменений; AGENTS risk gate остаётся обязательным.
- **Dependencies:** Пакет AUTH/постановка приняты Terra; существующий компонентный каталог не содержит продуктового textarea consumer.
- **Documentation / rollback:** BACKLOG/CHANGELOG_DEV, UX_FLOWS/AT уточнение наблюдаемого поведения и test traceability; сохранить исторические evidence. Rollback только своего UI/test/docs delta, без данных/деплоя.


### BUG-029 — Не предлагать повтор уже сохранённого очка после потери ответа

- **Type:** critical-journey-recovery
- **Priority:** P1
- **Status:** ready
- **Evidence:** ROOT-JUDGE-OUTCOME-01, [личное воспроизведение](audits/2026-09-13-ux-ui/coordinator-rechecks/judge-outcome/README.md), [receipt](audits/2026-09-13-ux-ui/coordinator-rechecks/judge-outcome/receipt.json), исходное F-JUDGE-001. Собственный disposable stand, exact323 source hashes, Chromium390, два контролируемых POST и authoritative readback.
- **Expected:** Система различает сохранённый запрос, окончательный отказ и неизвестный исход; повторное очко не предлагается, когда exact intent уже применён. Неотправленные быстрые нажатия видимы и восстанавливаются только явно.
- **Actual:** Commit первого запроса → потеря ответа → GET и UI1:0 с exact key, но текст «проверьте счёт и повторите». Следование инструкции создаёт новый key и2:0. Автоматического двойного POST не наблюдалось; частота естественных сбоев неизвестна.
- **Repro:** replay.mjs в linked evidence: новое обычное лицо создаёт/ведёт synthetic матч, route.fetch пропускает успешный points POST, затем route.abort теряет ответ; проверить UI/API, затем отдельно выполнить предлагаемый повтор.
- **Scenario / Epic / Story / Sprint:** SC-J01/J04 → EP-UX-CORE → US-UX-SCORE-RECOVERY «После сбоя ведущий понимает точный счёт» → S1 candidate, приоритет раньше перестановки экранов.
- **Inputs / REQ / AT / ADR:** JUDGE-001/004/008/009, AT-JUDGE-007, D27; accepted GAP012r6; [точный алгоритм и UI](audits/2026-09-13-ux-ui/score-recovery-target.md). JudgePage drainPointQueue438–508/point511+, MatchService getMatch511+ и awardPoint1184+; текущие idempotencyKeys/version используются без нового endpoint.
- **Write scope / contracts:** один владелец JudgePage/state helpers и focused tests; API/PG regression fixtures для доказательства ordering. Не менять reducer/score rules/permissions/stats. Если требуется изменение контрактов — отдельный явно определённый delta до реализации, а не скрытая эвристика.
- **Exact behavior:** сохранять key/side/sentVersion и отдельно unsent intents. Сверять GET; exact key подтверждает применение, отсутствие ключа в раннем GET оставляет unknown. Не повторять POST автоматически. Явное начисление после проверки неизвестного исхода использует новую key и именно просмотренную expectedVersion, без silent rebase на background state. Остаток очереди показывается и отправляется/отбрасывается только явным решением. Все сообщения/ветви/ограничения — score-recovery-target.
- **Subtasks:** 1) Зафиксировать meaningful failing UI acceptance lost-response/applied и unknown/late-write cases. 2) Ввести ограниченное состояние восстановления без потери intent/unsent count. 3) Добавить GET/safe explicit version-bound recovery и интерфейс решений; сохранить rapid-input порядок. 4) Проверить оба порядка задержанных транзакций в realPG, terminal/reauth/ownership и UI состояния. 5) Пройти repository-wide gate и независимое ревью; документировать фактический контракт.
- **Given / When / Then:** Given первый points POST commit и потерянный ответ, When GET содержит его key, Then точный счёт и сообщение о сохранении, нет повторного POST/предложения повторить. Given oldPOST ещё выполняется и key отсутствует, Then unknown; при явном новом начислении old/new в обоих порядках не дают два очка благодаря проверенной version, конфликт не повторяется автоматически. Given unsent queue, Then количество/стороны видимы; до явного решения новые writes не уходят. Given lost ownership/401/terminal, Then recovery не обходит guards.
- **Risk:** Повторное ручное начисление, скрытая потеря rapid taps, вечная блокировка восстановления, неправильное доказательство по aggregate score, late commit race. Ошибку видимости не исправлять только сменой текста без безопасного конечного пути.
- **Verification:** Детерминированные component/state tests; controlled transport failure, offline/GET error, same-user other-session, pending boundary; disposable PostgreSQL ordering/rollback; repository-wide pnpm ci/принятый verify:all equivalent и desktop/mobile browser. Не использовать sleeps/retry-to-pass; сравнивать response и authoritative event/key/score.
- **Dependencies:** BUG-024 для читаемой ошибки. Личный repro завершён; алгоритм/постановка приняты Terra на exact source version/key contract; статус ready означает готовность к реализации, не исправление. Продолжение иных UX пакетов не блокируется.
- **Documentation / rollback:** PRD/UX/AT по наблюдаемому recovery, API_AS_BUILT уточнение доступных outcome данных если необходимо, traceability, BACKLOG/CHANGELOG_DEV. Rollback только scoped UI/tests/docs; DB/production mutation вне этой задачи.


- **Readiness evidence:** [core-review](audits/2026-09-13-ux-ui/core-review.json); target принят, implementation и его обязательные проверки ещё не выполнены.

### GAP-017 — Следующее действие матча соответствует состоянию и правам

- **Type:** ux-hierarchy
- **Priority:** P2
- **Status:** ready
- **Target overlay D37:** next actions preserve actor/state rights but do not expose game invitations or revenge. Old invitation/CTA target below is superseded; judge handover and safe exit remain. See GAP-029 and AT-UI-INV-001.
- **Executable readiness boundary:** `ready` относится к иерархии существующих разрешённых действий, current judge session и безопасному переходу; не включает совмещённый create/acquire/start (Q-UX-006), replay (Q-UX-007), ten-second Undo/archive (Q-UX-008) или историю держателей общего телефона (Q-UX-009). Старые строки об invitation/revenge ниже сохранены как исторический target и не исполняются при D37. Семантику status chips для всех экранов задаёт GAP-034 в этапе 3; этот match consumer проверяется в этапе 6.
- **Current GWT / historical boundary:** Given match in waiting/active/terminal state for each actor, When detail opens, Then only the authorized next action leads, game invite/revenge is absent, handover remains, and judge exit uses authoritative state. AT-UI-INV-001/AT-HOME-003. Old invitation actions below are historical only.
- **Scenario / Epic / Story / Sprint:** SC-M04/SC-J01/J02/J03 → EP-UX-CORE → US-UX-NEXT «Ведущий понимает, как продолжить и начать следующую игру» → S3 candidate.
- **Evidence:** F-PILOT-002/003 и MATCH M06; [пилот](audits/2026-09-13-ux-ui/pilot/report.md), [role matrix](audits/2026-09-13-ux-ui/match/evidence/m06-role-action-matrix.json), [review](audits/2026-09-13-ux-ui/match-review.json). Равный акцент действий — экспертное наблюдение, частота ошибок неизвестна.
- **Expected:** одно основное следующее действие рядом со счётом; все дополнительные разрешённые операции и новые игры доступны.
- **Actual:** несколько равных кнопок, пустой журнал перед решением, после результата нет прямой пустой следующей игры. Историческая роль не доказывает текущего владения устройством.
- **Repro:** waiting creator/nonparticipant → detail; затем creator+participant/current judge/reserved/free роли и finished former operator из пилота. Сравнить доступные действия и их порядок с матрицей.
- **Inputs / REQ / AT / ADR:** GAP-012 r6 и323 source hashes; MATCH-008/010–014/017, JUDGE-001/002, D4/D7/D17/D18/D23/D24/D35; [единый контракт](audits/2026-09-13-ux-ui/core-target.md), [схемы](audits/2026-09-13-ux-ui/core-wireframes.html), AT-MATCH-013/017 и существующие проверки judge session/start/cancel.
- **Exact behavior:** heading/status → score/roster/rules → judge state и primary по приоритету terminal → reservation → active judge → free slot → остальные разрешённые действия → журнал → исключительные операции → назад. Game invitation и revenge entry не показываются по D37; постоянный Home Refresh не добавляется. Таблица [core-target](audits/2026-09-13-ux-ui/core-target.md) применяется только после D36/D37 overlay. Creator waiting/free: существующий judge setup и start остаются отдельными до Q-UX-006. Другой допустимый субъект при free slot получает judge entry, но не право начать. Совпадение userId показывает «Открыть ведение», auth session проверяет существующая JudgePage. Terminal допускает пустую /matches/new без автоматического переноса roster/rules или revengeOf.
- **Write scope / owner:** один frontend writer MatchDetailPage.tsx, локальные существующие стили и focused tests; shared buttons не форкать. Home — GAP-015, JudgePage — отдельные задачи, API/data/contracts не менять.
- **Constraints / edges:** все комбинации creator/player/judge и reservation; stale owner/session, expiry, waiting/in_progress/pending_confirmation/finished/stopped/cancelled, standalone/tournament. Видимость D17 первична. Start creator-only; stop/no-show/cancel/void отдельно по guards; новый admin access не добавлять. Одна колонка, без sticky; удалённый BottomNav не заменяется локальным перекрытием. Длинные имена/пустой журнал/error/loading сохраняют доступность.
- **Subtasks:** 1) Табличные acceptance cases на каждый primary и пересечения ролей. 2) Перестановка существующих элементов и единый вычисляемый primary без изменения handler/contracts. 3) Добавить пустую следующую ручную игру без replay/revenge. 4) Browser390/1440/360, клавиатура/фокус, auth-session negatives, документация и evidence; применить принятый GAP-034 target к status chips.
- **Given / When / Then:** Given creator+player/free/waiting, Then одна primary и доступен существующий judge setup. Given другой participant/free, Then он может занять место, но start запрещён. Given тот же user на другом устройстве, Then userId не включает score controls и нет скрытого takeover. Given reservation, Then адресат видит принятие, остальные просмотр. Given finished former operator, Then новая игра открывает пустую manual форму без скрытого replay/revenge. Given403, Then roster/title не раскрыты.
- **Risk:** потерять разрешённое действие из-за приоритетов, предоставить start не-создателю или считать исторического судью владельцем auth session.
- **Verification:** component actor/state matrix, browser keyboard/touch/desktop/mobile и реальные session negatives; critical journey repository-wide по AGENTS при реализации, без повторного тестирования reducer ради схемы.
- **Dependencies:** GAP-013 и общий core-target приняты Terra; BUG-018/019/025/026 сохраняют свои seams. Admin discovery исследует ADMIN отдельно. Target принят Terra, см. core-review.json.
- **Documentation / rollback:** UX_FLOWS/AT/traceability, BACKLOG/CHANGELOG_DEV; rollback своего UI/test/docs delta, no DB/release.

- **Readiness evidence:** [core-review](audits/2026-09-13-ux-ui/core-review.json); target принят, implementation и его обязательные проверки ещё не выполнены.

### GAP-018 — Повторно открыть игровые приглашения только по отдельному решению

- **Type:** decision-gated-availability
- **Priority:** P2
- **Status:** blocked_decision
- **Evidence:** F-MATCH-002, M04 persisted replacement lifecycle и исходный экспертный target сохранены в immutable package; D37 временно скрывает game/tournament invitation UI.
- **Expected:** прежний target «создатель явно приглашает из деталей» superseded. Реактивация возможна только после отдельного решения о scope, роли, старых pending rows и acceptance.
- **Actual:** текущий runtime ещё показывает UI invitations; его временное скрытие — GAP-029. Старые API/data rows сохраняются.
- **Repro:** сверить D35/D37 и legacy `/matches/:id` invitation action; не реализовывать старое описание как готовую задачу.
- **Risk:** восстановить скрытую функцию преждевременно или автоматически принять старые приглашения.
- **Verification:** после решения — новый AT, role/expiry/notification/browser/PG checks; на этапе 0 только consistency review.
- **Dependencies:** Q-UX-011 о возвращении UI; GAP-029 и D37 действуют до него.

### BUG-030 — Отмена матча имеет правильное название и необязательную причину

- **Type:** ux-state-copy-contract
- **Priority:** P2
- **Status:** ready
- **Scenario / Epic / Story / Sprint:** SC-M04 → EP-UX-CORE → US-UX-CANCEL «Я понимаю последствия отмены и могу указать причину» → S2 candidate.
- **Evidence:** F-MATCH-003, M04 cancel UI390 и persisted cancelled; [report](audits/2026-09-13-ux-ui/match/report.md). Source api.cancelMatch уже принимает reasonText, shared schema trim/max500.
- **Expected:** «Отменить матч?» и «Отменён» обозначают cancel, optional reason передаётся без изменения прав/версии/idempotency.
- **Actual:** текст сообщает «аннулирован», textarea причины отсутствует, хотя endpoint её поддерживает; persisted cancelled корректен.
- **Repro:** creator waiting standalone → «Отменить матч» → проверить текст/поля → закрыть без запроса → подтвердить и сверить persisted cancelled.
- **Inputs / REQ / AT / ADR:** MATCH-017, AT-MATCH-CANCEL-001/004, D23; отличие void по D24; MatchDetailPage.tsx onCancelConfirm, api.cancelMatch(id,expectedVersion,idempotencyKey,reasonText?), CancelMatchRequestSchema.
- **Exact behavior:** заголовок «Отменить матч?», текст «Матч будет отменён без победителя и влияния на статистику. Ведение счёта завершится, игроки освободятся для других матчей». Текущее название матча рядом. Native textarea «Причина (необязательно)», maxlength500, trimmed empty → undefined; cancel reason не обязателен. «Не отменять»/X/Escape до отправки — no request и возврат focus. Подтверждение — существующие version/key, причина четвёртым аргументом. Pending фиксирует payload и блокирует повтор, поле и Close с явным disabled/progress. Успех: cancelled. Известный отказ оставляет значения и контекстную ошибку; unknown сначала GET-сверка, не автоматический POST. Не выдавать старую версию за новый retry без отдельного решения пользователя.
- **Write scope / owner:** один frontend writer MatchDetailPage.tsx и focused tests; shared Dialog/error BUG-021, native textarea current tokens; API/schema/data не меняются.
- **Constraints / edges:** 0/500/501 chars, whitespace, multiline, long title, keyboardfocus; creator/admin существующие guards, active standalone states, tournament/terminal denied. Admin discovery не решать расширением D17. Void по-прежнему отдельная операция, её copy не переименовывать.
- **Subtasks:** 1) Red на copy/optional reason payload. 2) Добавить textarea и trim/current API argument. 3) Применить согласованный контекстный error/pending контракт. 4) Проверить no-op close, success, conflict/unknown, actor negatives и responsive.
- **Given / When / Then:** Given empty reason, Then cancel допустим и reason omitted. Given meaningful multiline≤500, Then persisted audit reason соответствует trim. Given Close до отправки, Then POST=0. Given pending, Then повтор/изменение payload невозможны. Given known rejection, Then reason сохранена и error находится в dialog. Givenunknown, Then retry не записывает автоматически; состояние сначала прочитано. Given denied actor/kind/state, Then операция отклонена без изменений.
- **Risk:** смешать cancel/void, скрыть ошибку закрытием окна, повторить неизвестную mutation или расширить admin видимость.
- **Verification:** meaningful component payload/focus tests и browser390/1440+keyboard, persisted reason/cancel состояние в disposable environment; действующий API actor/version/idempotency gate сохранить.
- **Dependencies:** BUG-021/026 общие состояния, GAP-012 accepted; постановка принята Terra и координатором. Это отдельный small dialog, решение pending bracket Q-UX-001 на него не переносится.
- **Documentation / rollback:** UX_FLOWS/AT/traceability/BACKLOG/CHANGELOG_DEV; rollback своего UI/test/docs delta, no DB/release.


- **Readiness evidence:** [core-review](audits/2026-09-13-ux-ui/core-review.json); target принят, implementation и его обязательные проверки ещё не выполнены.

### BUG-031 — Ручная коррекция счёта сохраняет управляемый фокус

- **Type:** accessibility-interaction
- **Priority:** P2
- **Status:** ready
- **Scenario / Epic / Story / Sprint:** SC-J01 → EP-UX-SYSTEM → US-UX-CORRECTION «Исправляю счёт с клавиатуры и возвращаюсь к игре» → S2 candidate.
- **Evidence:** F-JUDGE-002, J-RUN-CORRECTION; [snapshot1440](audits/2026-09-13-ux-ui/judge/evidence/j07-correction-open-focus-1440.json), [screenshot](audits/2026-09-13-ux-ui/judge/evidence/screenshots/j07-correction-open-focus-1440.png). Runtime focus BODY при открытии и cancel, correction persistence прошла.
- **Expected:** открытие переводит фокус в коррекцию, закрытие возвращает к понятному действию; сохранение и ошибки доступны клавиатуре.
- **Actual:** после открытия и отмены focus теряется на BODY; клавиатурному пользователю приходится искать текущую область.
- **Repro:** current judge in_progress,1440; keyboard открыть Действия→коррекцию, проверить activeElement, отменить и проверить возврат.
- **Inputs / REQ / AT / ADR:** JUDGE-011, AT-JUDGE-010, D4/D7; [T-JUDGE-FOCUS](audits/2026-09-13-ux-ui/judge/target-spec.md#t-judge-focus-001--вход-и-возврат-фокуса-в-коррекции), current JudgePage correction branch, accepted GAP012r6.
- **Exact behavior:** при обычном открытии focus всегда на заголовок «Ручная коррекция» с tabIndex=-1; не выбирать между heading и первым input по усмотрению исполнителя. Tab далее A→B→подающий→Сохранить→Отмена. Ошибка валидации переводит на первый invalid input и связывает сообщение. Request error сохраняет значения и фокусирует error summary. Эта задача меняет только управление фокусом: GET-first восстановления при неизвестном исходе ручной коррекции сейчас нет, и BUG-031 его не реализует и не объявляет безопасным. Отдельное непроверенное recovery наблюдение зафиксировано в TECH-006 и judge-additional-observations.md; никаких новых retry controls или автоматических mutations здесь не добавлять. Cancel/допустимый Escape возвращают focus на trigger коррекции; success — на «Действия» и polite announcement authoritative счёта/подачи. Если trigger размонтирован из-за terminal/lost-lock, focus на существующий heading текущего состояния.
- **Write scope / owner:** один frontend writer JudgePage.tsx и focused tests. Inline correction не превращается в новый modal, нет нового focus trap. API/reducer/правила и аппаратное поведение не меняются.
- **Constraints / edges:** mouse/touch opening тоже имеет устойчивый focus; pending payload/Close по BUG-026, score/Undo/finish во время коррекции сохраняют нынешние guards; ошибка не сбрасывает значения, потеря auth/lock не включает controls. Не перехватывать focus на каждом poll/score refresh.
- **Subtasks:** 1) Keyboard Red open/cancel focus. 2) Named refs и focus transitions открытия/выхода без таймерных sleeps. 3) Validation/request/lost-lock targets без повторной mutation. 4) Browser1440/390+keyboard, docs/evidence.
- **Given / When / Then:** Given correction closed, When keyboard activate, Then heading focused и следующий Tab ведёт к A. Givencancel, Then trigger focused, POST=0. Givensuccess, Then Действия focused и текущий счёт объявлен. Giveninvalid, Then первый invalid field focused с описанием. Givenbackgroundrefresh, Then focus остаётся у пользователя. Givenlostlock/terminal, Then текущий heading и недоступны мутации.
- **Risk:** focus stealing при polling, фокус в скрытом поле после смены состояния или включение счёта до закрытия correction.
- **Verification:** meaningful component focus transition tests и реальный Chromium keyboard/mobile/desktop; authoritative correction API unchanged, существующие regression tests сохранить. Spoken AT отдельно либо явно NOT_TESTED.
- **Dependencies:** BUG-026 pending; BUG-029 относится к очку, не доказывает recovery ручной коррекции. Один последовательный writer JudgePage. Terra приняла focus target условно после удаления ложного recovery claim; coordinator устранил его и явно ограничил scope.
- **Documentation / rollback:** UX_FLOWS/AT/traceability/BACKLOG/CHANGELOG_DEV; rollback своего UI/test/docs delta, без данных и release.

- **Readiness evidence:** [core-review](audits/2026-09-13-ux-ui/core-review.json); target принят, implementation и его обязательные проверки ещё не выполнены.


### BUG-032 — Подтверждать последствия отмены турнира, роспуска и выхода из готовой сетки

- **Type:** ux-safety-confirmation
- **Priority:** P2
- **Status:** ready
- **Scenario / Epic / Story / Sprint:** SC-T05 → EP-UX-TOURNAMENT → US-UX-TOURNAMENT-CONTROL → S4 candidate.
- **Evidence:** F-TOURNAMENT-001/002; T-RUN-007; [пакет](audits/2026-09-13-ux-ui/tournament/report.md), [обязательная коррекция и точный target](audits/2026-09-13-ux-ui/tournament-correction.md). Независимое [ревью принято](audits/2026-09-13-ux-ui/social-review.json); частота у реальных пользователей неизвестна.
- **Expected:** Организатор и участник видят конкретное последствие до mutation и могут отказаться без изменений.
- **Actual:** Три действия немедленно меняют состояние; participant generated exit делает needs_regeneration без предупреждения.
- **Repro:** named runs в [runs.csv](audits/2026-09-13-ux-ui/tournament/runs.csv), syntheticactors и status как вfinding; authoritative state из runtime-observations.
- **Inputs / REQ / AT / ADR:** TOURNAMENT-010/011/018, AT-TRN-007/008/014, UX§9; acceptedGAP012r6,323sourcehashes; exactseams TournamentDetailPage.tsx, существующий Dialog usage, focused tests.
- **Exact behavior:** Отмена доступна только организатору в collecting / bracket_generated / needs_regeneration. Диалог называет турнир и сообщает, что продолжить его будет нельзя. Роспуск предупреждает: состав сохранится, текущая сетка и расстановка будут удалены. Выход участника из bracket_generated требует предупреждения о новой генерации; в collecting остаётся нынешний быстрый выход, после старта действует запрет. Первоначальный фокус — на безопасной вторичной кнопке. Запрос, права и итоговые статусы не меняются. Ожидание и восстановление определены в tournament-correction.md и BUG-021/026.
- **Write scope / owner:** TournamentDetailPage.tsx, существующий Dialog usage, focused tests; один frontendwriter на общийTournamentDetailPage, последовательные taskdelta.
- **Constraints / edges:** Закрытие и Escape до запроса, двойное нажатие, гонка со стартом, 401/403, устаревший ответ, длинное название и размонтированный инициатор. Не менять остановку турнира: она сохраняет спортивные результаты. Администратор не получает права организатора.
- **Subtasks:** 1) Зафиксировать meaningful acceptance Red для описанного разрыва. 2) Выполнить ограниченное изменение UI, сохранив обработчики, payload и права. 3) Проверить каждый GWT, отрицательные случаи, ожидание и ошибки; для мутаций сверить авторитетные данные. 4) Снять desktop/mobile evidence, обновить документы и передать на ревью.
- **Given / When / Then:** Given первое нажатие опасного действия, Then запросов нет и показан именованный диалог. Given отказ, Then состояние не изменено, фокус возвращён инициатору. Given подтверждение, Then отправлен один запрос и GET подтверждает cancelled / collecting / withdrawn + needs_regeneration. Given ожидание, Then повтор и закрытие честно недоступны, прогресс объявлен. Given запрещённые роль или статус, Then изменений нет.
- **Risk:** Скрыть возможность, расширить роль или обещать другой исход. Изменение не должно менять серверные данные и топологию сетки.
- **Verification:** Relevantwebtests/typecheck + browser390/1440/narrow360/keyboard/focus/pending/error; дляmutationпроверитьresponseиGETвdisposablePG. Приизмененииcriticaljourney/contract repository-widegateпоAGENTS; чистаякомпоновканепереобъявляет1257acceptance.
- **Dependencies:** BUG-021/026. Q-UX-001 относится к другому окну. У трёх действий разные последствия и условия доступности; не объединять их в неопределённую универсальную операцию. Независимое ревью принято: [social-review](audits/2026-09-13-ux-ui/social-review.json).
- **Documentation / rollback:** UX_FLOWS, AT и traceability при уточнении наблюдаемых условий; BACKLOG и CHANGELOG_DEV. Откат только своего UI/test/docs изменения, без базы данных и выпуска.


### BUG-033 — Показывать итог турнира только после возникновения результата

- **Type:** ux-state-hierarchy
- **Priority:** P2
- **Status:** ready
- **Target overlay D36:** show compact top-3 only after actual result, preserve secondary access to full TOURNAMENT-015/017 stats; stopped has no champion. Old all-results-in-primary-block target below is superseded.
- **Current GWT / historical boundary:** Given tournament collecting/generated/active/stopped/finished, When summary opens, Then zero results and false champion are absent, finished top-3 is primary and full TOURNAMENT-015/017 stats remain available secondarily. AT-TRN-012/013. Old primary all-results layout below is historical only.
- **Scenario / Epic / Story / Sprint:** SC-T02/T04/T05 → EP-UX-TOURNAMENT → US-UX-TOURNAMENT-RESULT → S4 candidate.
- **Evidence:** F-TOURNAMENT-003; T-RUN-004/006/007; [пакет](audits/2026-09-13-ux-ui/tournament/report.md), [обязательная коррекция и точный target](audits/2026-09-13-ux-ui/tournament-correction.md). Независимое [ревью принято](audits/2026-09-13-ux-ui/social-review.json); частота у реальных пользователей неизвестна.
- **Expected:** Текущая работа отделена от итогов, все реальные результаты доступны после завершения.
- **Actual:** Нулевая таблица выглядит как «Итоги» уже при сборе состава и может включать вышедшего участника.
- **Repro:** named runs в [runs.csv](audits/2026-09-13-ux-ui/tournament/runs.csv), syntheticactors и status как вfinding; authoritative state из runtime-observations.
- **Inputs / REQ / AT / ADR:** TOURNAMENT-015/016/017/018, AT-TRN-013/014, D35; acceptedGAP012r6,323sourcehashes; exactseams TournamentDetailPage.tsx summary branch и focused tests.
- **Exact behavior:** В collecting / needs_regeneration / bracket_generated / in_progress блок «Итоги» не отображается. В finished / stopped сохраняются все значения серверного summary: места, очки, матчи, top3 согласно статусу; причина остановки остаётся видимой. В cancelled показать статус и существующие данные отмены без нулевой таблицы рейтинга. Не пересчитывать итог на клиенте и не возвращать вышедших игроков в активный состав. Ссылки на текущие, следующие и сыгранные матчи сохраняются. Вне контекста турнира admin не получает новые поля summary.
- **Write scope / owner:** TournamentDetailPage.tsx summary branch и focused tests; один frontendwriter на общийTournamentDetailPage, последовательные taskdelta.
- **Constraints / edges:** Пустые результаты, остановка после сыгранных матчей, нулевая длительность, гости, вышедшие участники, длинные имена, обновление active → finished и DTO без summary.
- **Subtasks:** 1) Зафиксировать meaningful acceptance Red для описанного разрыва. 2) Выполнить ограниченное изменение UI, сохранив обработчики, payload и права. 3) Проверить каждый GWT, отрицательные случаи, ожидание и ошибки; для мутаций сверить авторитетные данные. 4) Снять desktop/mobile evidence, обновить документы и передать на ревью.
- **Given / When / Then:** Given collecting или in_progress, Then нулевых «Итогов» нет, оперативные действия доступны. Given finished, Then все серверные места, очки, матчи и top3 сохранены. Given stopped, Then нет выдуманного победителя, сыгранные результаты доступны. Given cancelled, Then видна отмена без фиктивного рейтинга. Given ограниченный admin DTO, Then новых полей не появляется.
- **Risk:** Скрыть возможность, расширить роль или обещать другой исход. Изменение не должно менять серверные данные и топологию сетки.
- **Verification:** Relevantwebtests/typecheck + browser390/1440/narrow360/keyboard/focus/pending/error; дляmutationпроверитьresponseиGETвdisposablePG. Приизмененииcriticaljourney/contract repository-widegateпоAGENTS; чистаякомпоновканепереобъявляет1257acceptance.
- **Dependencies:** GAP-012 принят. RESULTS дополнит проверку частичных результатов. Для реализации нужна fixture остановки после сыгранного матча: TOURNAMENT проверял stopped с нулём сыгранных матчей. Независимое ревью принято: [social-review](audits/2026-09-13-ux-ui/social-review.json).
- **Documentation / rollback:** UX_FLOWS, AT и traceability при уточнении наблюдаемых условий; BACKLOG и CHANGELOG_DEV. Откат только своего UI/test/docs изменения, без базы данных и выпуска.


### GAP-019 — Собрать экран турнира вокруг состава и ближайшей игровой задачи

- **Type:** ux-layout
- **Priority:** P2
- **Status:** ready
- **Target overlay D36/D37:** rules and roster precede bracket; state prioritizes current match/bracket, with no new global nav or consent/invite UI. Preserve pre-start edit, regeneration, organizer/admin rights and existing read-only summaries. Older invite/navigation target below is superseded.
- **Executable readiness boundary / staged ownership:** один canonical GAP-019 и один frontend writer на `TournamentDetailPage.tsx` в каждый момент. Этап 7 меняет только collecting/needs_regeneration и authoritative rules/roster/pre-generation: порядок, существующее редактирование, права, guest selection без новой identity. Этап 8 после принятого delta этапа 7 меняет bracket_generated/in_progress/terminal composition: сетка и рабочий матч впереди повторных summary, read-only сводки вторичны. Это последовательные subscopes одной задачи, не два параллельных writers; `ready` не открывает future scheduling (Q-UX-010), reusable guest (Q-UX-004), invitations (D37) или неизвестные mutation semantics. BUG-032/033 и GAP-020 координируются в этапе 8 на том же общем файле последовательно.
- **Stage acceptance:** этап 7 — Given organizer в collecting/needs_regeneration, Then правила и состав до построения, prestart edit/regeneration и guards сохранены (AT-TRN-024 scope A, AT-TRN-022/023 для mutation). Этап 8 — Given generated/active/terminal, Then сетка/текущий матч либо действительный результат имеют первенство, полный read-only summary достижим вторично, stopped не получает чемпиона (AT-TRN-024 scope B и AT-TRN-012/013 для результата). Для каждого состояния отдельно проверить organizer/participant/scoped admin, empty/loading/error/pending, keyboard 360/390 и desktop, response + authoritative GET после mutation. Полный GAP-019 не `verified_local`, пока оба subscopes не приняты.
- **Current GWT / historical boundary:** Given organizer/admin/participant opens tournament at each lifecycle state, When they act, Then rules and roster are authoritative before bracket, current match/bracket lead during play, rights and prestart regeneration persist, and no global nav or game invite UI appears. AT-TRN-024/AT-UI-INV-001. Conflicting older navigation/consent target below is historical only.
- **Scenario / Epic / Story / Sprint:** SC-T01/T02/T04 → EP-UX-TOURNAMENT → US-UX-TOURNAMENT-ORIENT → S4 candidate.
- **Evidence:** TOURNAMENT report/annotated-before-after; F003-related hierarchy; expert proposal; [пакет](audits/2026-09-13-ux-ui/tournament/report.md), [обязательная коррекция и точный target](audits/2026-09-13-ux-ui/tournament-correction.md). Независимое [ревью принято](audits/2026-09-13-ux-ui/social-review.json); частота у реальных пользователей неизвестна.
- **Expected:** Организатор видит готовность состава и следующее действие, участник — свой текущий/следующий матч.
- **Actual:** Управление и ранние итоги конкурируют с составом, сеткой и ближайшим матчем.
- **Repro:** named runs в [runs.csv](audits/2026-09-13-ux-ui/tournament/runs.csv), syntheticactors и status как вfinding; authoritative state из runtime-observations.
- **Inputs / REQ / AT / ADR:** TOURNAMENT-001/005/006/007/017/020, AT-TRN-004/009/024, D35/D36/D37; accepted GAP012-r6 source; exact seams TournamentDetailPage.tsx, scoped existing styles и focused tests.
- **Exact behavior:** Сохранить текущий shell шириной до 560px и одну колонку. Этап 7 — collecting/needs_regeneration: заголовок/status → authoritative rules с существующим prestart edit → режим участия → активный состав и прямое добавление → построение/перестроение сетки → исключительные операции. D37 скрывает приглашения и согласие в UI, но не удаляет старые rows/API. Этап 8 — bracket_generated: готовность, сетка и свой следующий матч перед повторным read-only summary; старт только организатору. In_progress: текущий/следующий матч → сетка → вторичные операции. Terminal: действительный серверный результат, сетка и сыгранные матчи, полный summary доступен вторично; stopped без выдуманного чемпиона. Все данные и входы сохраняются в пределах текущих прав; scoped admin получает только минимальную projection. Новая закреплённая панель, мини-карта и навигация не вводятся.
- **Write scope / owner:** TournamentDetailPage.tsx, scoped existingstyles и focused tests; один frontendwriter на общийTournamentDetailPage, последовательные taskdelta.
- **Constraints / edges:** Пересечение ролей, pending / declined приглашения, гости и сокомандники, пустое состояние, загрузка и ошибка, длинные имена, устаревшая сессия и причина needs_regeneration. Перестановка сама по себе не меняет политику подтверждений.
- **Subtasks:** 1) Зафиксировать meaningful acceptance Red для описанного разрыва. 2) Выполнить ограниченное изменение UI, сохранив обработчики, payload и права. 3) Проверить каждый GWT, отрицательные случаи, ожидание и ошибки; для мутаций сверить авторитетные данные. 4) Снять desktop/mobile evidence, обновить документы и передать на ревью.
- **Given / When / Then:** Given организатор в collecting/needs_regeneration, Then действующие правила и активный состав с добавлением стоят до опасных операций, построение доступно по прежним условиям. Given participant в bracket_generated/in_progress, Then сетка и текущий/следующий матч стоят до вторичного read-only summary. Given terminal, Then действительный результат доступен без ложного чемпиона; полная статистика сохранена. Given скрытые D37 приглашения, Then их controls и badges отсутствуют, team/judge paths не теряются. Given минимальный admin DTO, Then полного экрана организатора нет. Given клавиатура на 360/1440, Then порядок DOM логичен и фокус не закрыт.
- **Risk:** Скрыть возможность, расширить роль или обещать другой исход. Изменение не должно менять серверные данные и топологию сетки.
- **Verification:** Relevantwebtests/typecheck + browser390/1440/narrow360/keyboard/focus/pending/error; дляmutationпроверитьresponseиGETвdisposablePG. Приизмененииcriticaljourney/contract repository-widegateпоAGENTS; чистаякомпоновканепереобъявляет1257acceptance.
- **Dependencies:** этап 7 — GAP-029/D37, BUG-018/019/025/026 и действующие D35 guards; Q-UX-004/010 блокируют только новую guest identity/future scheduling. Этап 8 — принятый delta этапа 7, GAP-020, BUG-032/033 и D24/D35, один последовательный writer на общем файле. Использовать принятые правила выбора основного действия, не расширяя права. Независимое ревью исходного экспертного target принято: [social-review](audits/2026-09-13-ux-ui/social-review.json); новое stage split ещё требует приёмки.
- **Documentation / rollback:** UX_FLOWS, AT и traceability при уточнении наблюдаемых условий; BACKLOG и CHANGELOG_DEV. Откат только своего UI/test/docs изменения, без базы данных и выпуска.


### GAP-020 — Дать более компактный обзор сетки без уменьшения читаемости

- **Type:** ux-navigation
- **Priority:** P2
- **Status:** ready
- **2026-09-18 boundary:** accepted 75% overview below относится к основной
  сетке SE/DE. Отдельный матч за третье место сохраняется, но предложение
  убрать его собственные zoom/arrow controls выделено в GAP-033; не
  переносить туда обязательное масштабирование основной сетки.
- **Scenario / Epic / Story / Sprint:** SC-T04 → EP-UX-TOURNAMENT → US-UX-BRACKET-OVERVIEW → S4 candidate.
- **Evidence:** F-TOURNAMENT-004; T-RUN-002/003, экспертнаягипотеза, неusabilityблокер; [пакет](audits/2026-09-13-ux-ui/tournament/report.md), [обязательная коррекция и точный target](audits/2026-09-13-ux-ui/tournament-correction.md). Независимое [ревью принято](audits/2026-09-13-ux-ui/social-review.json); частота у реальных пользователей неизвестна.
- **Expected:** Режим 75% даёт более компактный горизонтальный обзор, сохраняя читаемость и доступность действий.
- **Actual:** Сетка не уменьшается ниже 100%; DE5/8 требует последовательной горизонтальной прокрутки.
- **Repro:** named runs в [runs.csv](audits/2026-09-13-ux-ui/tournament/runs.csv), syntheticactors и status как вfinding; authoritative state из runtime-observations.
- **Inputs / REQ / AT / ADR:** TOURNAMENT-009/017, AT-TRN-009, NFRaccessibility; acceptedGAP012r6,323sourcehashes; exactseams TournamentBracket.tsx, его текущиеstyles.cssправила, focused tests.
- **Exact behavior:** Значения: 75%, 100%, 125%, 150%; исходное — 100%, границы честно отключают кнопки. На 75% колонка имеет ширину 165px, промежуток — прежние 48px, шаг перехода — 213px. Имена не меньше 13px, счёт не меньше 14px, строки и цели нажатия не меньше 44px; длинные имена переносятся. Существующий ResizeObserver пересчитывает связи между карточками. На 100/125/150 геометрия остаётся прежней. Процент виден и доступен вспомогательным технологиям; Arrow/Home/End и ссылки на матч сохраняются. Не масштабировать весь DOM через transform и не создавать новый renderer.
- **Write scope / owner:** TournamentBracket.tsx, его текущиеstyles.cssправила, focused tests; один frontendwriter на общийTournamentDetailPage, последовательные taskdelta.
- **Constraints / edges:** SE/DE на 3/5/8 участников, BYE, третье место, Winners/Losers/GrandFinal, длинные имена и гости, 360/390/844 landscape/1440, изменение размера при фокусе, связи после переноса текста и конечные состояния карточек.
- **Subtasks:** 1) Зафиксировать meaningful acceptance Red для описанного разрыва. 2) Выполнить ограниченное изменение UI, сохранив обработчики, payload и права. 3) Проверить каждый GWT, отрицательные случаи, ожидание и ошибки; для мутаций сверить авторитетные данные. 4) Снять desktop/mobile evidence, обновить документы и передать на ревью.
- **Given / When / Then:** Given 100%, When уменьшить, Then видны 75%, кнопка уменьшения недоступна, имя ≥13px, счёт ≥14px, цели ≥44px. Given длинное имя на 75%, Then оно переносится полностью, связь ведёт к правильной карточке. Given Home/End, Then границы полосы достижимы. Given 100/125/150, Then прежняя геометрия не ухудшена. Given любая полоса, Then нет горизонтального переполнения всей страницы, допустимый переход к матчу доступен.
- **Risk:** Скрыть возможность, расширить роль или обещать другой исход. Изменение не должно менять серверные данные и топологию сетки.
- **Verification:** Relevantwebtests/typecheck + browser390/1440/narrow360/keyboard/focus/pending/error; дляmutationпроверитьresponseиGETвdisposablePG. Приизмененииcriticaljourney/contract repository-widegateпоAGENTS; чистаякомпоновканепереобъявляет1257acceptance.
- **Dependencies:** Нужна визуальная приёмка 75%, а не только добавление числа в массив состояния. Не обещать вместить всю DE8 без прокрутки. Данные и топология сетки не меняются. Независимое ревью принято: [social-review](audits/2026-09-13-ux-ui/social-review.json).
- **Documentation / rollback:** UX_FLOWS, AT и traceability при уточнении наблюдаемых условий; BACKLOG и CHANGELOG_DEV. Откат только своего UI/test/docs изменения, без базы данных и выпуска.


### GAP-021 — Убрать лишнее подтверждение обычного прямого добавления в состав

- **Type:** ux-flow-friction
- **Priority:** P2
- **Status:** ready
- **Scenario / Epic / Story / Sprint:** SC-T01/T02/T03 → EP-UX-TOURNAMENT → US-UX-TOURNAMENT-ROSTER → S4 candidate.
- **Evidence:** F-TOURNAMENT-005; T-RUN-001; expert hypothesis; [пакет](audits/2026-09-13-ux-ui/tournament/report.md), [обязательная коррекция и точный target](audits/2026-09-13-ux-ui/tournament-correction.md). Независимое [ревью принято](audits/2026-09-13-ux-ui/social-review.json); частота у реальных пользователей неизвестна.
- **Expected:** Обычный прямой выбор добавляется явной кнопкой, а предупреждения об обходе согласия и изменении сетки сохраняются.
- **Actual:** Организатор в прямом режиме collecting подтверждает дополнительное окно для каждого игрока, хотя обхода согласия и готовой сетки ещё нет.
- **Repro:** named runs в [runs.csv](audits/2026-09-13-ux-ui/tournament/runs.csv), syntheticactors и status как вfinding; authoritative state из runtime-observations.
- **Inputs / REQ / AT / ADR:** TOURNAMENT-005/007, AT-TRN-022/023, D35; acceptedGAP012r6,323sourcehashes; exactseams TournamentDetailPage.tsx addRegistered handler и focused tests.
- **Exact behavior:** Без дополнительного окна работает только isOrganizer && requireParticipantConsent=false && status=collecting. Остальные допустимые ветви сохраняют именованное подтверждение с конкретным выбранным игроком и турниром. requiresOverride = consent || !isOrganizer; bracket_generated требует confirmBracketRegeneration. В needs_regeneration текст сообщает о необходимости новой генерации перед стартом, не обещая её автоматически. Существующие POST, ключи, actor/source, аудит и eligibility не меняются. Добавление гостя остаётся прежним.
- **Write scope / owner:** TournamentDetailPage.tsx addRegistered handler и focused tests; один frontendwriter на общийTournamentDetailPage, последовательные taskdelta.
- **Constraints / edges:** Admin, который сам является организатором, следует ветви организатора по PRD005; scoped admin вне контекста всегда подтверждает. Двойное нажатие, изменение picker во время запроса, ранее declined / left / expired, уже включённый игрок, blocked / busy, 401, гонка со стартом и неизвестный исход.
- **Subtasks:** 1) Зафиксировать meaningful acceptance Red для описанного разрыва. 2) Выполнить ограниченное изменение UI, сохранив обработчики, payload и права. 3) Проверить каждый GWT, отрицательные случаи, ожидание и ошибки; для мутаций сверить авторитетные данные. 4) Снять desktop/mobile evidence, обновить документы и передать на ревью.
- **Given / When / Then:** Given прямой режим collecting у организатора, When явно добавить выбранный ID, Then дополнительного окна нет и отправлен один POST. Given consent / scoped admin / готовая сетка, Then до именованного подтверждения POST=0, нужные флаги переданы по контракту. Given needs_regeneration, Then автоматическая перестройка не обещается. Given удержанный POST, Then выбранный ID не подменяется. Given отказ или неизвестный исход, Then автоматического повторного POST нет.
- **Risk:** Скрыть возможность, расширить роль или обещать другой исход. Изменение не должно менять серверные данные и топологию сетки.
- **Verification:** Relevantwebtests/typecheck + browser390/1440/narrow360/keyboard/focus/pending/error; дляmutationпроверитьresponseиGETвdisposablePG. Приизмененииcriticaljourney/contract repository-widegateпоAGENTS; чистаякомпоновканепереобъявляет1257acceptance.
- **Dependencies:** BUG-025/026. Формулировка AT-TRN-022 согласована с PRD/D35. Серверные требования confirmation-флагов сохраняются. Независимое ревью принято: [social-review](audits/2026-09-13-ux-ui/social-review.json).
- **Documentation / rollback:** UX_FLOWS, AT и traceability при уточнении наблюдаемых условий; BACKLOG и CHANGELOG_DEV. Откат только своего UI/test/docs изменения, без базы данных и выпуска.


### GAP-023 — Называть действия ведения игры понятными словами

- **Type:** ux-copy-and-discoverability
- **Priority:** P2
- **Status:** ready
- **Scenario / Epic / Story / Sprint:** SC-J01/02/04 → EP-UX-CORE → US-UX-SCORE-LANGUAGE «Человек у телефона понимает управление счётом и передачу» → S3 candidate.
- **Evidence:** F-JUDGE-003 и F-PILOT-006, [JUDGE report](audits/2026-09-13-ux-ui/judge/report.md), [pilot](audits/2026-09-13-ux-ui/pilot/report.md). Экспертная гипотеза непонимания; слова наблюдались в runtime, ошибки реального человека не измерены. Иерархия MatchDetail уже принадлежит GAP-017, здесь только JudgePage copy.
- **Expected:** названия объясняют действие без терминов «слот», TTL и названия внутреннего события; передача одного телефона явно отличается от передачи ведения на другом устройстве.
- **Actual:** Undo, «Передать слот», «Освободить слот и выйти», техническое объяснение сессии; сообщение после failed release ссылается на TTL и raw error.
- **Repro:** открыть рабочий JudgePage, панель «Действия», подготовить передачу, затем release success/failure; состояния lost-lock и readonly проверить отдельно.
- **Inputs / REQ / AT / ADR:** JUDGE-001/004/006/007/010, AT-JUDGE-002/003/004/008/009/010, D7/D18; JudgePage.tsx, core-target.md и BUG-029 recovery. Все handlers/guards остаются прежними.
- **Exact labels:** Undo → «Отменить очко» с accessible description «Отменяет последнее действующее очко. Ручную коррекцию не отменяет»; «Передать судейство» → «Передать ведение на другое устройство»; «Передать слот» → «Передать ведение»; «Освободить слот и выйти» → «Выйти из ведения», pending → «Выходим…»; lost-lock heading → «Ведение недоступно».
- **Exact supporting copy:** в существующем handover блоке перед select: «Передаёте этот телефон? Можно продолжить без смены аккаунта. Записи останутся от текущего аккаунта. Для другого устройства выберите получателя». Не добавлять обязательный шаг идентификации. Основной context-tip: «Счёт меняет тот, кто сейчас ведёт игру на этом устройстве. Отмена снимает последнее действующее очко». Существующая подсказка ручной коррекции: «Коррекция меняет счёт и подачу. Она сохраняется отдельно от игровых очков».
- **Release messages:** confirmed success «Вы вышли из ведения. Другой пользователь может продолжить»; already inactive «Ведение на этом устройстве уже не активно. Проверьте текущее состояние матча»; unknown «Не удалось проверить выход из ведения. Проверьте текущее состояние матча». Не обещать истечение в определённый срок, освобождение или синхронизацию без подтверждения; существующий переход к detail сохраняется, новых автоматических запросов/повторов нет. Handover success сообщает «Передача подготовлена для {имя}. Получатель должен принять её и открыть ведение на своём устройстве» — не утверждает, что получатель уже стал активным судьёй.
- **Write scope / owner:** один frontend writer JudgePage.tsx, focused copy/semantics tests. Без нового словаря всего сервиса, редизайна или изменения API; label tests обновлять только когда они выражают доступное действие.
- **Constraints / edges:** длинное имя,360/390/1440/landscape, screen-reader names соответствуют видимым; readonly/lost-lock не должны сообщать, что текущий человек может менять счёт; не переименовывать pending_confirmation в уже сохранённый результат. BUG-029 имеет отдельный exact recovery текст; его не заменять общей ошибкой. No-show/cancel/stop/void различаются и остаются на прежних местах.
- **Subtasks:** 1) Зафиксировать исходные подписи и actor/state consumers. 2) Применить перечисленные строки и disclosure-level hint, сохранив handlers и guards. 3) Проверить переносы, доступные имена и честность success/unknown сообщений. 4) Сверить пользовательское понимание нейтральным заданием и обновить документы.
- **Given / When / Then:** Given общий телефон передан другому человеку, Then текст не требует смены аккаунта. Given другая auth session, Then подсказка ведёт к существующей передаче и не обещает два активных владельца. Given только reservation создана, Then сообщение требует принятия, не объявляет передачу завершённой. Given failed release, Then нет утверждения об освобождении или auto retry. Given Undo, Then handler и граница после коррекции сохранены. Given readonly/lost-lock, Then изменение счёта по-прежнему недоступно.
- **Risk:** упростить формулировку ценой ложного обещания владения или результата. Слова не меняют серверное состояние.
- **Verification:** relevant web tests/typecheck, browser390/1440/landscape и360, keyboard/focus, release/handover success/unknown controlled responses; UI text сверить с authoritative state. Проверка понимания человеком остаётся отдельным исследовательским gate.
- **Dependencies:** GAP-017/BUG-029 target contracts приняты; независимое review copy target принято после уточнения точных AT ссылок. Переименование не исправляет manual correction recovery из TECH-006.
- **Documentation / rollback:** UX_FLOWS observable copy, BACKLOG/CHANGELOG_DEV, traceability изменённых tests; откат своих строк/tests/docs без данных и выпуска.

### GAP-022 — Открывать команды через список, сохранив одну встроенную форму создания

- **Type:** ux-layout
- **Priority:** P2
- **Status:** ready
- **Scenario / Epic / Story / Sprint:** SC-TE01/TE02 → EP-UX-TEAM → US-UX-TEAM-ORIENT «Участник быстро открывает нужную команду» → S4 candidate.
- **Evidence:** F-TEAM-002, [пакет](audits/2026-09-13-ux-ui/team/report.md), TS-TEAM-01, [обязательная коррекция](audits/2026-09-13-ux-ui/team-correction.md). Экспертная гипотеза, частота и выигрыш времени не измерены.
- **Expected:** возвращающийся участник видит свои команды, а создание остаётся явным и полным.
- **Actual:** постоянно открытая форма из трёх полей предшествует списку при каждом посещении.
- **Repro:** /profile → /teams с пустым и непустым списком, 390 и1440; создать команду и вернуться в список.
- **Inputs / REQ / AT / ADR:** TEAM-001/002/003, AT-TEAM-001, D5; [точный target](audits/2026-09-13-ux-ui/team/target-spec.md#ts-team-01--список-сначала-и-одна-встроенная-форма), TeamsPage.tsx, existing create/list API; accepted GAP012r6.
- **Exact behavior:** заголовок → «Мои команды» → одна «Создать команду» → существующая форма непосредственно под ней при раскрытии → текущая навигация. Inline disclosure, новый маршрут/диалог не вводится. В пустом состоянии используется та же кнопка и обработчик. При раскрытии фокус на название; до отправки «Скрыть форму» сворачивает и возвращает фокус. Pending блокирует поля и сворачивание. Успех добавляет команду в список, сворачивает форму и фокусирует её ссылку. Ошибка и данные остаются внутри формы. Возврат с detail сохраняет позицию списка; несохранённая форма не становится постоянным черновиком.
- **Write scope / owner:** один frontend writer TeamsPage.tsx, локальные существующие стили и focused tests. Дополнительные поля/история/аватар/API не входят.
- **Constraints / edges:** ноль/одна/несколько команд, длинное название без обрезания личности команды, роли текстом, list error с повтором GET, create known/unknown error без autoPOST, 401/403, клавиатура/касание, 360/390/1440. Один список и один экземпляр формы.
- **Subtasks:** 1) Red для порядка, единственного create и сохранения всех полей. 2) Перенести существующую форму в inline disclosure. 3) Добавить переходы фокуса и contextual states без новых запросов по фоновому событию. 4) Browser/документы/evidence.
- **Given / When / Then:** Given текущие команды, Then список — первый содержательный блок и все ссылки доступны. Given пустой список, When создать, Then раскрыта одна форма с прежней валидацией. Given pending, Then повтор и изменение payload невозможны. Given известный отказ, Then значения и ошибка сохранены внутри формы. Given успех, Then новая команда видна и фокус на её ссылке.
- **Risk:** скрыть создание или нужную команду, завести второй черновик/обработчик, потерять focus после сворачивания.
- **Verification:** web tests/typecheck, browser360/390/1440, keyboard/focus, loading/empty/error/pending/long names; create response + persisted GET.
- **Dependencies:** BUG-026 для Teams create consumer; BUG-034 локальные ошибки. Независимое TEAM target review принято; реализация не выполнена.
- **Documentation / rollback:** UX_FLOWS/AT/traceability при новых проверках, BACKLOG/CHANGELOG_DEV. Откат своего UI/test/docs изменения; без данных и выпуска.

### BUG-034 — Ошибка настройки команды видна рядом с сохранением

- **Type:** async-feedback
- **Priority:** P2
- **Status:** ready
- **Scenario / Epic / Story / Sprint:** SC-TE01 → EP-UX-SYSTEM → US-UX-CONTEXT-ERROR «Капитан понимает результат изменения» → S2 candidate.
- **Evidence:** F-TEAM-003, PATCH500 на360, alertTop863.53 при viewport800; [origin screenshot](audits/2026-09-13-ux-ui/team/evidence/screenshots/te01-edit-error-origin-360.png), [runtime](audits/2026-09-13-ux-ui/team/evidence/runtime-states.json). Это page-card consumer принципа BUG-021; BUG-024 к нему не относится.
- **Expected:** результат запроса и путь проверки находятся в карточке изменения, данные попытки не пропадают.
- **Actual:** общий alert после нескольких блоков находится за пределами текущего viewport; исходное действие выглядит без результата.
- **Repro:** капитан меняет слоган на360, PATCH получает controlled500; проверить положение alert до последующей прокрутки. Controlled500 в harness не даёт приложению права считать любой500 доказанным отказом.
- **Inputs / REQ / AT / ADR:** TEAM-003, AT-TEAM-001, D26; TeamDetailPage.tsx settings action/error, existing PATCH/GET и BUG-021; [TEAM correction](audits/2026-09-13-ux-ui/team-correction.md).
- **Exact behavior:** у сохранения настроек отдельное состояние ошибки внутри его карточки непосредственно перед кнопками. Введённые имя/слоган/приветствие сохранены, остальные допустимые разделы доступны. Known rejection объясняется локально. Network/5xx называется «Не удалось проверить сохранение» и даёт «Обновить данные» — только GET, без автоматического POST. Не сообщать «не сохранено» без доказательства. После чтения показать текущие серверные значения отдельно от попытки; новый Save остаётся явным действием действующего капитана, подтверждающим отправку его значений. Не вводить optimistic успех или новую серверную версию.
- **Write scope / owner:** один frontend writer TeamDetailPage.tsx + focused tests; общий Alert/Dialog не форкать. API/data/права неизменны.
- **Constraints / edges:** local draft и server values не подменяют друг друга молча; stale GET не меняет другую открытую команду; утрата капитанства/архив/401 скрывают недопустимые действия. При начале запроса не пытаться удержать фокус на native disabled кнопке: если он потерян, programmatic focus на локальный status; при ответе один раз на локальный error/success. Фоновое обновление не крадёт focus.
- **Subtasks:** 1) Red: ошибка вне текущего действия. 2) Локализовать состояние операции и Alert. 3) Различить known/unknown copy и GET-only проверку, сохранить черновик. 4) Browser360/1440, focus, role loss, docs.
- **Given / When / Then:** Given rejected PATCH, Then ошибка и попытка видны в settings. Given unknown outcome, Then нет утверждения об отказе и автоматического повторного POST; GET доступен. Given новый ответ, Then данные текущей команды показаны без потери попытки. Given role revoked, Then запись недоступна. Given background refresh, Then focus не меняется.
- **Risk:** слепой повтор неизвестной операции, ложное сообщение о сохранении, перезапись попытки фоновым GET.
- **Verification:** deferred request/component tests; browser360/390/1440 с известной ошибкой и потерянным ответом, focus и role guards; GET сравнение. Исторический run500 подтверждает placement, не все новые recovery branches.
- **Dependencies:** BUG-021 общий принцип, BUG-026 pending. Это отдельный page-card implementation, не решение pending Dialog Q-UX-001. Точный recovery target принят independent Terra review.
- **Documentation / rollback:** UX_FLOWS states, AT/traceability, BACKLOG/CHANGELOG_DEV; откат своего UI/test/docs изменения.

### BUG-035 — Подтверждать исключение участника и передачу капитанства

- **Type:** ux-safety-confirmation
- **Priority:** P2
- **Status:** ready
- **Scenario / Epic / Story / Sprint:** SC-TE02 → EP-UX-TEAM → US-UX-CAPTAIN-CONTROL «Капитан понимает изменение состава и полномочий» → S4 candidate.
- **Evidence:** F-TEAM-004, прямые onClick и persisted remove/transfer без промежуточного шага; [report](audits/2026-09-13-ux-ui/team/report.md), [source](audits/2026-09-13-ux-ui/team/evidence/source-review.md). P2 safety-gap; необратимая потеря данных не доказана.
- **Expected:** конкретный человек и последствия названы до изменения; отмена безопасна.
- **Actual:** одно нажатие сразу прекращает membership или передаёт полномочия; немедленной отмены нет.
- **Repro:** капитан активной команды выбирает remove, затем transfer другому участнику; проверить отсутствие промежуточного подтверждения и authoritative membership/captain.
- **Inputs / REQ / AT / ADR:** TEAM-002/003/006/007, AT-TEAM-001/004/005; existing TeamDetailPage.tsx actions и Dialog, [target TS-TEAM-02](audits/2026-09-13-ux-ui/team/target-spec.md#ts-team-02--контекстные-ошибки-и-безопасные-действия), [correction](audits/2026-09-13-ux-ui/team-correction.md).
- **Exact behavior:** доступные капитану действия строки сгруппированы под «Действия с {имя}». Это inline disclosure внутри строки: обычная Button с aria-expanded/aria-controls раскрывает две допустимые кнопки в потоке документа; Enter/Space активируют её, Tab последовательно проходит действия, Escape сворачивает и возвращает focus на раскрывающую кнопку. Role menu и стрелочную навигацию не вводить. Одновременно раскрыта одна строка; пустое раскрытие не показывается. Исключение открывает именованный Dialog с объяснением окончания активного участия и сохранения истории. Передача называет нового капитана и сообщает: прежний останется участником и потеряет управление составом. Первый focus на «Отмена», mutation только отдельным подтверждением. Pending честно блокирует повтор/Close; known failure остаётся локальным, unknown требует GET до нового явного решения. Успех обновляет права по серверу и фокусирует заголовок состава.
- **Write scope / owner:** один frontend writer TeamDetailPage.tsx, существующие Button/Dialog из ui.tsx, локальный inline disclosure и focused tests. ui.tsx не экспортирует Menu; новая библиотека или общий компонент не нужны.
- **Constraints / edges:** self/captain/ordinary member/outsider/archived роли по серверу; blocked/left target после открытия; transfer из другой сессии; длинное имя; cancel/escape/no-op; узкий экран, перенос кнопок внутри строки без горизонтального переполнения. Выход капитана без передачи остаётся запрещённым. Не менять автоматическую передачу при блокировке или архивирование.
- **Subtasks:** 1) Red: один исходный click не должен писать. 2) Группировка допустимых действий и named confirmations. 3) Pending/error/authoritative refresh/focus. 4) Browser и role negatives, docs/evidence.
- **Given / When / Then:** Given первая активация remove/transfer, Then persisted state не меняется и виден конкретный target. Given отмена, Then POST=0 и focus возвращён. Given подтверждение, Then один запрос; после transfer прежний капитан видит member права. Given stale/forbidden target, Then отказ без ложного успеха и без auto retry. Given архив, Then mutation controls отсутствуют.
- **Risk:** скрыть разрешённое действие, сохранить старые права после передачи или направить запрос другому участнику.
- **Verification:** component actor/status/menu/focus tests, browser390/1440/narrow360, persisted membership/captain и known/unknown failure. Изменение критического role journey требует gate по AGENTS.
- **Dependencies:** BUG-021/026, TEAM independent target review принят. Не зависит от модели аватара, отзыва приглашений или нового исторического списка.
- **Documentation / rollback:** UX_FLOWS/AT/traceability/BACKLOG/CHANGELOG_DEV; откат своего UI/test/docs изменения, без данных и выпуска.

### GAP-024 — История показывает участников и контекст найденного события

- **Type:** ux-result-discoverability
- **Priority:** P2
- **Status:** ready
- **Primary-text addition 2026-09-18:** U01-FORM-001 относится также к поиску
  уже сыгранных матчей по фамилиям участников, не к BUG-023 picker. Given C
  создал/судил A-vs-B, When поиск по фамилии A/B, Then запись находится и
  обе стороны объясняют совпадение; AT-VIS-003, stage 10.
- **Scenario / Epic / Story / Sprint:** SC-R01 → EP-UX-RESULTS → US-UX-HISTORY-FIND «Оператор узнаёт нужную игру в списке» → S4 candidate.
- **Evidence:** F-RESULTS-001 expert hypothesis; [report](audits/2026-09-13-ux-ui/results/report.md), [search screenshot](audits/2026-09-13-ux-ui/results/evidence/runtime/history-search-390.png). Строки поиска не называют найденных игроков; человеческое время/ошибки не измерены.
- **Expected:** матч различим по обеим сторонам, дате, формату, роли и результату; игра для других не требует считать оператора игроком.
- **Actual:** title и «Матч · счёт · результат» не объясняют совпадение поиска по имени; часть имеющейся metadata не показана.
- **Repro:** history с22+ synthetic событиями, поиск по имени игрока, открыть строку и вернуться; включить actor judge/organizer без участия, обычного участника и viewer.
- **Inputs / REQ / AT / ADR:** HISTORY-001–004, PROFILE-006; AT-VIS-001/002/003/004; D17; HistoryService/HistoryPage, current HistoryItem/API/OpenAPI. [Обязательный root target](audits/2026-09-13-ux-ui/results-correction.md) заменяет counterpartyLabel исходной спецификации.
- **Exact behavior:** header/Фильтры → поиск/Найти → существующие применённые условия и reset → список → Показать ещё. Match row: title → sideA — sideB → дата/время Europe/Moscow,1×1/2×2, все возвращённые роли → score/result/status. Tournament: title/date/format/roles/existing result/status, без выдуманного place. Ниже480px search и Найти идут двумя строками; все controls≥44px, row height auto, полные имена переносятся. Existing navigation/status chips/scroll order сохраняются.
- **Contract delta:** HistoryItem получает sideA:string|null и sideB:string|null. Match values вычисляются в существующем authorized history query по сторонам/slots; tournament оба null. Отображаемые current names/guest snapshot следуют PROFILE-006 и существующему detail formatter. Без IDs/email/новых разрешений; не делать N+1 detail fetch. Для старого ответа без новых полей fallback к прежним title/metadata без фальшивых имён. Stable cursor/timestamp ordering и search predicate не меняются.
- **Write scope / owner:** один bounded cross-package writer history-service.ts, API response/OpenAPI, web api HistoryItem/HistoryPage, existing ListRow styling and focused contracts/tests. Миграции не нужны; новую shared schema вводить только если существующая граница требует синхронизации, не ради общего рефакторинга.
- **Constraints / edges:** operator не имеет opponent side;2v2, guest/blocked/current names, одинаковые имена, title/custom title, unknown fields in old response, empty search, no history, next-page error, same timestamp, actor switch, role player+judge. Данные не удалять из-за длинной строки. URL persistence F-RESULTS-002 отложен; существующий actor-scoped detail→Back сохраняется.
- **Subtasks:** 1) Red for match identities for player/nonplaying operator, null tournament fields and unchanged pagination/visibility. 2) Добавить display fields в одном authorized query и контракте. 3) Вывести metadata и адаптивный порядок без второго обработчика списка. 4) Browser/PG/contract gate, schemas/документы/evidence.
- **Given / When / Then:** Given C судил A/B, Then row показывает A иB, не «соперника C». Given2v2, Then обе стороны и все имена доступны. Given blocked historical player, Then имя сохранено по текущей политике, новая eligibility не выдана. Given unauthorized active event, Then оно по-прежнему отсутствует. Given pagination failure, Then прежние строки и cursor сохранены. Given detail→Back, Then фильтры/страницы/позиция и focus строки восстановлены; другой actor не получает snapshot.
- **Risk:** расширить видимость, спутать стороны/счёт, замедлить pagination новыми запросами, потерять фильтры.
- **Verification:** API/OpenAPI/typechecks/visibility+cursor PostgreSQL integration, focused HistoryPage, browser360/390/1440 keyboard/long text/pagination/error; repository-wide gate из-за API contract change. Схемы предложения не заменяют runtime after evidence.
- **Dependencies:** RESULTS independent evidence/target review PASS; existing BUG-020 focus. Сохранение URL не блокирует эту задачу.
- **Documentation / rollback:** API_SPEC/API_AS_BUILT, UX_FLOWS/AT-VIS-003 и traceability, BACKLOG/CHANGELOG_DEV; откат собственных code/contract/docs changes без данных/выпуска.

### BUG-036 — Ошибка редактирования профиля привязана к полю и сохраняет попытку

- **Type:** validation-and-recovery
- **Priority:** P2
- **Status:** ready
- **Scenario / Epic / Story / Sprint:** SC-R03 → EP-UX-SYSTEM → US-UX-PROFILE-EDIT «Пользователь исправляет конкретную ошибку» → S2 candidate.
- **Evidence:** F-RESULTS-003;201 symbols organization→400, draft сохранён, generic page error и focus body; [screenshot](audits/2026-09-13-ux-ui/results/evidence/runtime/profile-validation-error-390.png), [report](audits/2026-09-13-ux-ui/results/report.md).
- **Expected:** понятно, какое правило нарушено, где исправить и подтверждено ли сохранение.
- **Actual:** error summary вне edit card сообщает только «Некорректные данные запроса», invalid/describedby отсутствуют.
- **Repro:** на своём профиле ввести organization длиной201 и отправить; проверить response/field association/focus/draft.
- **Inputs / REQ / AT / ADR:** PROFILE-001/003/004, AUTH-008, AT-PROFILE-001/004/005, D10; server ProfileUpdateSchema в apps/api/src/app.ts, ProfilePage.tsx, [точный target](audits/2026-09-13-ux-ui/results-correction.md).
- **Exact behavior:** локальный validator повторяет server trim/limits: имя/фамилия1–100; organization/position≤200 илиnull; дата null либо точная валидная YYYY-MM-DD, year>0. Значение не обрезать. Failed client validation не делает PATCH; aria-invalid/describedby и error text находятся у поля, focus один раз в первое invalid по порядку формы. General response без field info остаётся локальным summary, не угадывать виновное поле. Pending замораживает отправленные поля/Save/Cancel, draft сохраняется. Success принимает authoritative response/profile; ошибка оставляет форму открытой.
- **Unknown outcome:** network/5xx «Не удалось проверить сохранение», GET-only «Обновить данные», текущие данные показаны отдельно от введённых. Не обещать отказ/успех и не повторять PATCH автоматически. Новый Save явный, только того же actor и при действующей сессии. Same-actor reauth сохраняет in-memory draft, другой actor получает чистую форму; API/session-revoke/logout contracts не меняются.
- **Write scope / owner:** один frontend writer ProfilePage.tsx и локальный validator, focused tests. Не переносить весь серверный schema layer между пакетами. Existing UI primitives и session Dialog сохраняются.
- **Constraints / edges:** trimmed boundary values, whitespace-only names, leap day/invalid date, пустые optional fields/null, длинные raw spaces допустимые послеtrim, stale server read, role/account change, public/blocked profile. D10 avatar/email read-only; validation не вводит возрастные/бизнес ограничения. Background GET не крадёт focus и не стирает draft.
- **Subtasks:** 1) Red meaningful boundary/errors+focus. 2) Клиентская проверка и field associations. 3) Локальный operation state и known/unknown copy/GET review. 4) Browser390/1440/narrow360, reauth/permission negatives, docs.
- **Given / When / Then:** Given invalid length/date, Then0PATCH, конкретное поле и правило, focus в первом invalid. Given generic server400, Then локальная ошибка без ложного field blame, draft сохранён. Given response lost, Then нет autoPATCH и доступен GET-only review. Given same actor reauth, Then сохранена попытка без replay; other actor не видит её. Given public profile, Then edit не появляется.
- **Risk:** frontend/server validation drift, потеря draft или ложная уверенность после неизвестного результата.
- **Verification:** focused validator/ProfilePage/auth-recovery tests и web typecheck; browser360/390/1440 keyboard/focus/pending/known400/lost-response; сохраняемый результат сверить API GET на disposable stand. Revoke successful UI evidence остаётся отдельной проверкой, не proof всех reauth вариантов.
- **Dependencies:** BUG-020/026 и agreed recovery principle BUG-034; RESULTS target review PASS. Не требует Q-UX-002 team avatar.
- **Documentation / rollback:** UX_FLOWS/AT-PROFILE-004/traceability, BACKLOG/CHANGELOG_DEV; откат своих UI/tests/docs без данных и выпуска.

### BUG-037 — Прочитанное уведомление сразу покидает фильтр «Актуальные»

- **Type:** local-state-consistency
- **Priority:** P3
- **Status:** ready
- **Target overlay D37:** actionable/read changes preserve team invitations, judge_handover/offered and reservations while suppressing hidden game/tournament invitations consistently in list, popup, first-five and unreadCount. A row-only filter is insufficient.
- **Current GWT / historical boundary:** Given hidden game invitations mixed with team and judge-handover notices, When unread/actionable list or first-five loads, Then visible rows, badge/count and pagination agree, team/handover actions remain, and old pending rows are unchanged. AT-UI-INV-002. Conflicting old all-invite counter target below is historical only.
- **Scenario / Epic / Story / Sprint:** SC-R04 → EP-UX-RESULTS → US-UX-NOTIFICATION-TRIAGE «Пользователь видит только требующие внимания события» → S4 candidate.
- **Evidence:** F-RESULTS-004 runtime, readAt обновлён, lifecycle=new оставляет non-actionable row до refresh; [report](audits/2026-09-13-ux-ui/results/report.md), [screenshot](audits/2026-09-13-ux-ui/results/evidence/runtime/notifications-actual-after-read-390.png).
- **Expected:** successful read немедленно согласует список и badge, приглашение с доступным ответом остаётся видимым.
- **Actual:** local batch handler обновляет readAt, но фильтрует только actionable/lifecycle; прочитанная обычная строка всё ещё «Актуальная».
- **Repro:** checked Актуальные, unread non-actionable row, successful read-visible; до refresh сравнить visible rows/readAt/lifecycle. Контроль: pending invitation послеread должна остаться.
- **Inputs / REQ / AT / ADR:** NOTIF-001/003/004/005/006, AT-NOTIF-001/003/004/005; NotificationsPage ActorNotificationsPage/visible/read-visible, [root target](audits/2026-09-13-ux-ui/results-correction.md). API unchanged.
- **Exact behavior:** название «Актуальные» сохраняется, note «Непрочитанные уведомления и приглашения, на которые можно ответить». Effective current row: actionable OR(new/absent lifecycle AND readAt=null), terminal lifecycle не перезаписывать read ответом. Successful batch updates only returned IDs/readAt; non-actionable read row выходит сразу. Pending invitation остаётся actionable с «Прочитано» и прежними accept/decline. История содержит terminal reason/time без actions/popup.
- **Write scope / owner:** один frontend writer NotificationsPage.tsx и focused tests; existing actor-key/remount, mounted/sequence guards и single-flight сохраняются. Не создавать новый API/lifecycle enum.
- **Constraints / edges:** repeated read, partial response/omitted ID, read и decline/expiry одновременно, actor switch/unmount, failure response, empty filtered list, focus внутри удаляемой строки. Если focus удаляется: следующая строка → предыдущая → заголовок списка. Без background focus jump. Не обещать, что чтение означает согласие или отмену приглашения.
- **Subtasks:** 1) Red local batch non-actionable vs pending-actionable. 2) Согласовать effective predicate и returned-ID update без terminal downgrade. 3) Focus fallback только при удалении focused row. 4) Browser/regression/docs.
- **Given / When / Then:** Given non-actionable new, When successful read, Then row исчезла из Актуальные без refresh и есть в истории. Given pending invitation, Then read убирает unread badge, но не actions/row. Given terminal update выиграл гонку, Then stale read не возвращает new/actions. Given failure, Then отсутствует ложное локальное read. Given actor switch, Then прежний ответ не обновляет новый экран.
- **Risk:** потерять доступный invitation action, воскресить terminal row или украсть keyboard focus.
- **Verification:** NotificationsPage state tests including racing read/terminal, web typecheck, browser390/1440/360 and keyboard focus; API GET подтверждает сохранённое read состояние. Existing popup suppression/TTL behavior сохраняется; новые real-time TTL прогоны не требуются для локальной причины.
- **Dependencies:** RESULTS independent review PASS; не зависит от нового имени фильтра или URL persistence.
- **Documentation / rollback:** UX_FLOWS/AT-NOTIF-004/traceability, BACKLOG/CHANGELOG_DEV; откат своих UI/tests/docs без данных/выпуска.

### GAP-025 — Определить и реализовать предусмотренный аватар команды

- **Type:** functional-gap-pending-product-decision
- **Priority:** P2
- **Status:** blocked_decision
- **Scenario / Epic / Story / Sprint:** SC-TE01 → EP-UX-TEAM → US-UX-TEAM-IDENTITY «Капитан задаёт необязательное изображение команды» → не включать в ready sprint до Q-UX-002.
- **Evidence:** F-TEAM-001: PRD TEAM-001/003 предусматривает avatar, но field отсутствует в current UI/API/data; [TEAM report](audits/2026-09-13-ux-ui/team/report.md), [коррекция](audits/2026-09-13-ux-ui/team-correction.md), [review](audits/2026-09-13-ux-ui/social-review.json). Ранее наблюдение учитывал TECH-006, теперь один canonical owner — GAP-025.
- **Expected:** необязательный аватар доступен капитану по принятой модели, команда остаётся узнаваемой без него и при ошибке изображения.
- **Actual:** существующий create/edit поддерживает name/slogan/welcome без avatar.
- **Repro:** создать и открыть active team, сверить формы и разрешённый team DTO; avatar отсутствует. Это functional gap текущего PRD, не запрос на ребрендинг.
- **Inputs / REQ / AT / ADR:** TEAM-001/003, AT-TEAM-001, Q-UX-002; existing team data/API и D10 (только user/guest). D10 не распространять автоматически на team.
- **Required decision:** выбрать модель из Q-UX-002. Координатор рекомендует существующий каталог готовых изображений без upload/storage. До решения не определять миграцию/контракт и не начинать реализацию; альтернативы не выдавать исполнителю как ready target.
- **Scope after decision:** один bounded writer team schema/contracts/create/edit/render and tests; captain-only edits, membership/archive/history rules сохраняются. Реализация image upload или новых хранилищ отдельно требует полного scope/прав/ограничений и не выводится из этого аудита.
- **Constraints / edges:** avatar omitted/default, существующие команды, fallback для missing asset, archived read-only, blocked/removed captain, длинное name, keyboard selection, unknown submit outcome, same-actor recovery. Функция не становится обязательным шагом создания команды.
- **Subtasks:** 1) Закрыть Q-UX-002 принятым решением и одной точной моделью. 2) Определить nullable/default/legacy/API и точные limits, миграцию только если нужна. 3) Заполнить финальные GWT и write scope; independent readiness review. 4) Только затем implementation и gate по риску.
- **Given / When / Then — обязательный каркас, не финальная приёмка:** Given нет выбранного avatar, Then создать команду можно. Given капитан изменяет допустимый avatar, Then server/UI согласованы. Given обычный участник/архив, Then изменение запрещено. После решения добавить конкретные допустимые значения, ошибки и совместимость; до этого задача не ready.
- **Risk:** превратить локальный выбор изображения в непрошенный upload/storage проект, изменить D10 без решения или блокировать существующее создание.
- **Verification:** при подготовке только source/PRD consistency и link checks; future checks определяются после решения. Runtime реализации не проводился.
- **Dependencies:** Q-UX-002. Независимые GAP-022/BUG-034/035 не блокируются.
- **Documentation / rollback:** DECISIONS/OPEN_QUESTIONS после ответа, requirements/AT/contracts/data as-built по фактическому scope, BACKLOG/CHANGELOG_DEV. Текущая запись не меняет приложение или базу.

### GAP-026 — Карточка аккаунта с безопасной историей действий

- **Type:** existing-requirement-gap
- **Priority:** P2
- **Status:** ready
- **Scenario / Epic / Story / Sprint:** SC-AD05 → EP-UX-ADMIN → US-UX-ACCOUNT-CONTEXT «Администратор проверяет аккаунт и видит, кто менял доступ» → S4 candidate.
- **Evidence:** F-ADMIN-002, [отчёт](audits/2026-09-13-ux-ui/admin/report.md), A-RUN-002/003/005/006 и source-review: audit rows сохраняются, read endpoint/UI отсутствуют. Постоянный URL — предлагаемое решение, не существующее требование. GAP-010 исторически принимал slice без viewer; его статус не переносится на эту работу.
- **Expected:** открываемая по ссылке карточка показывает разрешённые данные аккаунта и краткую историю, без секретов и неподтверждённых сведений.
- **Actual:** профиль редактируется в modal, audit rows доступны только backend/DB; истории в интерфейсе нет.
- **Repro:** active admin открывает каталог и профиль пользователя после block/unblock; проверить отсутствие timeline и наличие двух audit rows в disposable DB.
- **Inputs / REQ / AT / ADR:** ADM-001/002/004/008; 09_LOCAL_AUTH_AND_TENNIS_ADMIN §7; AT-ADM-003/006, D6/D10; AdminPage, toAdminUser, auth-service/auditLogs; [точный обязательный контракт](audits/2026-09-13-ux-ui/admin-correction.md).
- **Exact behavior:** `/admin/users/:id`: back → identity/status → existing edit → lifecycle actions → history. GET account использует существующий AdminUser allowlist. GET audit отдаёт только точного target, разрешённые action/changed-field names и actor/time; фиксированные20, cursor `(createdAt,id)` DESC. Нет raw meta, значений изменённых полей, секретов, выдуманного outcome или исторического имени автора. 401/403 скрывают данные, 404 локален; ошибки GET имеют Retry. После mutation success перечитать account/первую страницу, не повторять mutation.
- **Write scope / owner:** один cross-package writer bounded AdminUser detail/audit GET routes/service/shared DTO/web route/tests; existing edit и mutation controls переиспользуются без копирования guard логики. Схема audit не меняется; индекс только при доказанной необходимости.
- **Constraints / edges:** self/blocked target, смена actor/role во время запроса, null/missing author, unknown action/meta, одинаковое время событий, insert между страницами, empty/error, refresh/deep link, one-time secret только в существующем successful mutation response. Email read-only. Не читать чужие матчи.
- **Subtasks:** 1) Red contract/authorization/allowlist/pagination. 2) Минимальные GET/service/DTO. 3) Карточка и история, существующая edit форма. 4) Browser/PG/full gate, документы.
- **Given / When / Then:** Given admin и записи target, When detail/история открыты, Then видны только разрешённые поля и действия target в стабильном порядке. Given unknown secret-bearing meta, Then ничего из него не возвращается. Given nonadmin/blocked actor, Then нет данных. Given новая запись между страницами, Then старые не дублируются из-за offset. Given stale response после actor switch, Then данные прежнего actor не появляются. Given reload, Then тот же ID либо явный404.
- **Risk:** утечка meta, смешение target/cursor, расширение прав, ложная история, двойная логика lifecycle guards.
- **Verification:** API contract/authorization/service tests, disposable PostgreSQL pagination/ties/concurrent insert; repository-wide pnpm ci из-за контракта; browser360/390/1440 keyboard/focus/pending/known-error/stale-session. Проверять response и сохранённые факты, не только текст.
- **Dependencies:** независимая приёмка ADMIN correction PASS, admin-review.json. GAP-027 использует этот route. BUG-038 не разрешает новый reset recovery автоматически.
- **Documentation / rollback:** API_SPEC/API_AS_BUILT, UX_FLOWS, AT/traceability для нового read поведения, BACKLOG/CHANGELOG_DEV; scoped rollback собственных code/tests/docs, без удаления audit records и выпуска.

### GAP-027 — Каталог администрирования начинается с поиска пользователей

- **Type:** structural-ux-hypothesis
- **Priority:** P2
- **Status:** ready
- **Scenario / Epic / Story / Sprint:** SC-AD04 → EP-UX-ADMIN → US-UX-ADMIN-DIRECTORY «Найти аккаунт и нужное действие» → S4 candidate.
- **Evidence:** F-ADMIN-001: createTop63.5, users583.5, search617.5 на390×844; до четырёх равных row actions. Поиск уже виден, его полная недоступность не заявляется. [Отчёт](audits/2026-09-13-ux-ui/admin/report.md), [обязательная коррекция](audits/2026-09-13-ux-ui/admin-correction.md).
- **Expected:** список/поиск основной, создание и изменения доступа обнаружимы вторым уровнем, каждая функция сохранена.
- **Actual:** полная форма создания стоит перед поиском, row actions равного визуального веса повторяются в каждой строке.
- **Repro:** открыть `/admin` с несколькими synthetic users на390×844; сопоставить порядок блоков и row actions с A-RUN-001.
- **Inputs / REQ / AT / ADR:** ADM-001–007; AT-ADM-001/002/003/006; D6/D10; AdminPage current fields/actor guards, GAP-026 route, BUG-035 inline disclosure pattern.
- **Exact behavior:** профиль-back → заголовок → search/status/count → rows; «Добавить пользователя» раскрывает единственную inline форму перед rows, default closed. Dirty close подтверждается, pending не закрывается. Row name открывает GAP-026, «Действия» раскрывает inline обычные кнопки, один row открыт; aria-expanded/controls, normal Tab, Escape→trigger. Именованные lifecycle confirmations и role/self/status guards сохраняются. Loading/error/retry/empty рядом со списком. Существующий responsive shell сохраняется, новый table/menu dependency не вводится.
- **Write scope / owner:** один frontend writer AdminPage и focused tests; не менять API/роли и не строить глобальный desktop shell.
- **Constraints / edges:** 0/1/many users, длинные email/имена, null lastLogin, active/blocked/self/admin, lost session/pending mutation/list-load race, narrow360/focus/BottomNav. Одноразовый пароль после create не пропадает от автоматического закрытия формы; success показывает существующий secret dialog, затем очищает draft. BUG-038 state machine не заменять generic retry.
- **Subtasks:** 1) Переместить каталог с сохранением состояния поиска. 2) Inline create/disclosure и focus. 3) Row actions/entry route, существующие dialogs. 4) Browser/state regressions/docs.
- **Given / When / Then:** Given390 initial, Then search/status/Add предшествуют create fields. Given открыта row A и открывается B, Then A закрыта, focus остаётся на намеренном действии. Given cancel confirmation, Then0mutation. Given pending create, Then payload неизменен и форма не закрывается. Given success, Then secret показан один раз, user доступен в каталоге. Given keyboard360, Then все разрешённые действия достижимы и focus не скрыт.
- **Risk:** скрыть частую команду, потерять draft/secret, добавить ложные права через отображение.
- **Verification:** AdminPage state/interaction tests, web typecheck, browser360/390/1440/keyboard/error/loading/empty/pending, source capability comparison и authoritative GET после synthetic mutation. Full gate только если реализация расширит исходный UI scope.
- **Dependencies:** GAP-026 route, BUG-020/021/026 применимые shared consumers; independent ADMIN readiness review PASS, admin-review.json.
- **Documentation / rollback:** UX_FLOWS/AT/traceability, BACKLOG/CHANGELOG_DEV; вернуть только собственную UI компоновку/tests/docs без данных.

### BUG-038 — Неопределённый результат сброса пароля выдаётся за обычную ошибку

- **Type:** recovery-defect
- **Priority:** P2
- **Status:** ready
- **Scenario / Epic / Story / Sprint:** SC-AD06 → EP-UX-ADMIN → US-UX-RESET-RECOVERY → S4d candidate с отдельным contract/migration gate.
- **Evidence:** F-ADMIN-003, A-RUN-004: reset применён200, ответ abort, старые session/password401,1POST,0recoveryGET, Confirm снова enabled рядом с Failed to fetch. Повтор не выполнялся. [Коррекция](audits/2026-09-13-ux-ui/admin-correction.md) отзывает автоматическую приёмку P1 и небезопасный unchanged-marker retry.
- **Expected:** UI честно показывает неизвестный результат; не повторяет reset автоматически и не обещает получить уже утраченный one-time secret.
- **Actual:** после применённого reset и потери ответа Confirm доступен рядом с общей сетевой ошибкой; конкретный исход не согласуется.
- **Repro:** в disposable stand выполнить reset через route.fetch, после server200 abort client response; проверить1POST, старую session401 и enabled Confirm; не выполнять второй reset как часть исходного evidence.
- **Inputs / REQ / AT / ADR:** ADM-007/008, AUTH-007, AT-AUTH-007; AuthService.resetPassword, temporaryPasswordIssues, AdminPage.runConfirm; existing actor locks/session revocation.
- **Constraints / edges:** before/after commit response loss, delayed first request, другое reset/first-password между попытками, self-reset с отзывом собственной сессии, blocked/demoted actor, transactional rollback; прежний секрет не журналировать/не хранить для повторного получения.
- **Risk:** повторная выдача с неизвестным итоговым порядком, утрата ещё одного пароля, необоснованная блокировка всей админки.

- **Accepted target sources:** принято независимым Terra/root review, reset-review.json; эта спецификация является текущей постановкой. [Единый request receipt/CAS contract](audits/2026-09-13-ux-ui/admin-reset-spec/contract.md), [statechart](audits/2026-09-13-ux-ui/admin-reset-spec/statechart.md), [точные ordering tests](audits/2026-09-13-ux-ui/admin-reset-spec/tests.md) читать только с [обязательной коррекцией](audits/2026-09-13-ux-ui/admin-reset-correction.md). Исходные шесть файлов сохранены неизменными.
- **Exact target:** existing reset POST требует UUID Idempotency-Key и expectedLastAppliedRequestId; preflight GET показывает только last admin-reset pointer, exact receipt GET — applied/rejected_state_changed/unknown без plaintext. Отдельный явно подтверждённый replacement с новым UUID/supersedes предшественника использует CAS. Сначала existing deterministic user locks/transaction auth, затем receipt и pointer CAS; все password/session/issue/audit/notification/receipt записи атомарны. Exact replay не выдаёт секрет второй раз. Early absence и5xx остаются unknown. Pointer не доказывает действительность временного пароля.
- **Implementation scope / owner:** один bounded cross-package writer AuthService/reset routes/shared API DTO/OpenAPI, одна receipt table и nullable last_admin_password_reset_request_id, AdminPage flow и App-level one-time self-reset presentation, tests/docs. Login/first-change/change-password получают согласованный user→session lock/recheck для сохранения порядка, без нового auth framework/прав или изменения password policy.
- **Self-reset and recovery:** полученный secret хранится только in-memory вне Protected boundary; local auth очищен, private UI и authenticated requests закрыты, Copy сохраняет показ, Close/reload уничтожают secret. Lost self-reset не имеет unauth recovery; другой active admin может помочь. Единственный admin требует отдельного сопровождения, готовая bootstrap-rotation процедура не заявляется. Несекретная request correlation привязана к actor+target и очищается по mandatory overlay.
- **Subtasks:** 1) Red contract + migration compatibility + PG ordering/races. 2) Receipt/CAS/allowlists and deterministic locks. 3) Client single-flight GET/explicit replacement/one-time display. 4) Full repository/PG/browser acceptance and source docs. Сначала server, безопасно отклоняющий missing key, затем web; старый cached client получает понятное обновление страницы, не unsafe legacy reset.
- **Given / When / Then:** Given A applied response lost, Then exact receipt confirms A without secret or POST. Given no receipt, Then unknown. Given B explicitly supersedes A, Then B remains last reset in A→B and B→A; receipt/key fingerprints prevent different payload replay. Given A→C→B chain conflict, Then C may safely reject without writes and needs fresh confirmation. Given login/change races, Then revoked/pre-reset credentials cannot create or overwrite a later reset; verify both orders. Given reset × block/demote, Then no deadlock from FK-before-user-lock. Given self received/lost, Then one-time display/auth boundary and no unauth bypass as above.
- **Verification:** repository-wide pnpm ci, migration/schema checks and disposable PostgreSQL all RST/PG-RST cases with corrected010, browser360/390/1440/error/focus/pending/auth/storage-disabled; response AND persisted state, no secrets in artifacts. Update PRD/AT, API_SPEC/API_AS_BUILT, DATA_MODEL/AS_BUILT, UX_FLOWS, traceability/BACKLOG/CHANGELOG_DEV. Runtime новой реализации не проводился. Rollback перед применением данных отдельно проверяется: не удалять receipts/audit и не возвращать unsafe uncorrelated reset; старый UI может временно показывать refresh-required.
- **Dependencies:** Independent Terra/root target review PASS; mandatory admin-reset-correction.md supersedes the original frozen proposal. Existing active-admin/session invariants remain required. No pending product decision for this bounded contract.
- **Documentation / rollback:** Apply the documentation and safe compatibility rollback requirements stated above; no deployment or data mutation is authorized by target readiness.

### GAP-028 — Минимальный доступ администратора к аварийному завершению по ID

- **Type:** permission-boundary-decision
- **Priority:** P2
- **Status:** blocked_decision
- **Scenario / Epic / Story / Sprint:** SC-AD07 → EP-UX-ADMIN → US-UX-MATCH-INCIDENT → вне ready sprint до Q-UX-003.
- **Evidence:** F-ADMIN-004, A-RUN-007; exact ordinary detail403, нет row в list/history и UI entry, direct authorized force-close cancelled version0→1. [ADMIN correction](audits/2026-09-13-ux-ui/admin-correction.md). Исходный P1 — severity предложения автора, root P2: обход API существует, runtime отказ D17 корректен.
- **Expected:** после принятого решения active admin может выполнить уже разрешённое D23 действие через ограниченный интерфейс; чужой live detail не раскрывается.
- **Actual:** обычные list/detail/history скрывают active match корректно, отдельного admin recovery entry нет; direct authorized API работает.
- **Repro:** пользователь создаёт/начинает standalone, outsider admin получает ordinary detail403, не находит ID entry в `/admin`; direct force-close в disposable fixture даёт cancelled.
- **Inputs / REQ / AT / ADR:** D17/D23, MATCH-017, AT-ADM-MATCH-001/002 и остальные state tests как future matrix; current force-close API/guards. Не путать cancel с stop/void/purge.
- **Required decision:** Q-UX-003: exact-ID read только id/kind/status/version/allowed action; без title, участников, счёта, судьи или событий. Поиск всех активных матчей не предлагается. До ответа не утверждать исключение из D17.
- **Constraints / edges:** malformed/nonexistent ID, tutorial/tournament, active/terminal, stale version/concurrent finish, auth loss, optional reason; confirmed soft cancel без winner/stats. Доступ к необходимым DTO не даёт organizer powers.
- **Subtasks:** 1) Решение/ADR и согласование D17. 2) Точный минимальный DTO/error/idempotency/unknown target и схема. 3) Independent review. 4) Implementation только после ready.
- **Given / When / Then — обязательный каркас:** Given принят exact-ID seam и eligible standalone, Then admin видит только разрешённые поля и именованное подтверждение эффекта по ID. Given ordinary live route, Then прежний D17 сохраняется. Given invalid actor/state, Then0writes. До решения не считать это действующим требованием.
- **Risk:** расширить наблюдаемость активных игр или скрыто разрешить другие операции.
- **Verification:** подтверждён только один direct API force-close и D17 отказ; остальные состояния/акторы не повторялись. Future repository-wide/API/PG races/browser gate после принятия target.
- **Dependencies:** Q-UX-003, agreed minimal read contract; не блокирует остальные admin задачи.
- **Documentation / rollback:** после решения DECISIONS/OPEN_QUESTIONS, PRD/AT/API/UX_FLOWS и as-built; сейчас только backlog finding.

### BUG-039 — Сверка ручной коррекции после потери ответа

- **Type:** recovery-and-copy-defect
- **Priority:** P2
- **Status:** ready
- **Scenario / Epic / Story / Sprint:** SC-J01/04 → EP-UX-CORE → US-UX-CORRECTION-RECOVERY «Ведущий понимает, сохранён ли исправленный счёт» → S2 candidate после BUG-029 state seam.
- **Evidence:** OBS-JUDGE-001 теперь runtime, [дополнительный probe](audits/2026-09-13-ux-ui/judge-correction-probe/README.md): commit200 score4:2/version2, lost response board1:0; deliberate stale resend409 не создаёт второй event/key; early absence сменяется late commit. Desktop1440, mobile этой ветки не проверен.
- **Expected:** коррекция сверяется по точному prefixed key, состояние/подпись честны, повтор не нужен для получения актуального счёта.
- **Actual:** generic Failed to fetch, старое табло, enabled Save; после409 текст ошибочно приписывает собственную операцию другому устройству.
- **Repro:** disposable owned judge, correction1:0→4:2, route.fetch200→abort; сравнить exact `manual-correction:<key>`/version/score/event с UI. Явный повтор staleversion409 оставить как negative control без утверждения двойных очков.
- **Inputs / REQ / AT / ADR:** JUDGE-004/009/010/011, AT-JUDGE-010 technical correction baseline, AT-JUDGE-009 lost-lock/live sync, AT-JUDGE-002 one-device, AT-JUDGE-004 handover; D4/D7/D27; JudgePage correction, MatchService.manualCorrection rowlock/version/prefix; [точный target](audits/2026-09-13-ux-ui/correction-recovery-target.md), BUG-029 и BUG-031.
- **Exact behavior:** сохранить submitted key/version/absolute values отдельно от draft; network/5xx→single-flight GET и временная блокировка новых writes. Exact prefixed key presence подтверждает именно попытку, UI принимает текущий GET (включая позднейшие события), не перезаписывает submitted snapshot. Absence остаётся unknown; GET-only Retry. После успешного GET явные подтверждения «Принять показанный счёт» без mutation либо «Задать другой счёт» с новой явно заполненной absolute form/UUID/точной прочитанной version. Ни autoPOST, ни hidden rebase. Conflict нейтрален относительно источника изменения. Lost lock/terminal/actor change не дают прав обратно.
- **Write scope / owner:** один frontend writer JudgePage recovery state и focused tests, переиспользующий BUG-029 seam. API/reducer/data/eventLog semantics не меняются. BUG-031 focus-only остаётся отдельной небольшой задачей.
- **Constraints / edges:** absolute correction не +1; serve participant ID, pending_confirmation→in_progress по текущим rules, duplicate/stale request, later score after key present, early GET/no key, failed GET, lost session/handover/terminal, sameactor draft/differentactor clean. Неотправленные score taps не проигрываются через correction recovery.
- **Subtasks:** 1) Red lost-response/key/prefix and false other-device copy. 2) immutable submitted intent + shared recovery gate. 3) GET reconciliation/explicit review/new form/focus. 4) PG ordering controls/browser/full gate/docs.
- **Given / When / Then:** Given exact key present after lost response, Then GET state accepted without POST and correction acknowledged. Given key absent in early GET, Then outcome unknown. Given original/new explicit correction compete at same reviewed version, Then one succeeds and other409, no automatic rebase. Given applied correction followed by point, Then current score not overwritten by old draft. Given another actor/terminal, Then no residual write access.
- **Risk:** false failure, unnoticed draft overwrite or unintended absolute replacement; current negative probe proves CAS protection only in tested order.
- **Verification:** focused JudgePage/state tests and web typecheck; disposable PG both original/new orders, competing point/finish; repository-wide pnpm ci for critical journey; browser360/390/1440/keyboard/focus/network. Current probe is evidence of existing issue, not future target acceptance.
- **Dependencies:** BUG-029 recovery contract, BUG-031 focus mapping; independent target review PASS, correction-review.json.
- **Documentation / rollback:** UX_FLOWS/AT/traceability, BACKLOG/CHANGELOG_DEV and evidence; rollback own UI/tests/docs only, no event/data rewrite or release.

## Программа интерфейса 2026-09-18 — current decision overlay

[D36/D37](DECISIONS.md) и [TECH-008 plan](test-plans/TECH-008-interface-programme.md)
заменяют противоречащие navigation/invitation targets экспертного пакета. Старый
пакет и его 38 ID остаются evidence, но его прежние 35 ready / 3 blocked не
являются счётом готовности новых targets. Новые задачи ниже и обновлённые
старые headings составляют **один** canonical backlog. Эпизоды и подпункты:
[coverage](audits/2026-09-13-ux-ui/implementation/coverage.csv).

### TECH-007 — Обязательное SemVer-повышение при разрешённом выпуске

- **Type:** delivery-process
- **Priority:** P2
- **Status:** verified_local
- **Evidence:** принятие пользователем SemVer 2026-09-15; прежние D4/VERSIONING считали любой новый flow MAJOR, а 3.0.0 сохранялась после нового поведения.
- **Expected:** разрешённый выпуск продукта включает правильный PATCH/MINOR/MAJOR и exact version/SHA без отдельного согласования номера.
- **Actual:** правило SemVer и release/version parity принято и проверено документально в stage 0; runtime версия 3.0.0 не меняется. Следующий разрешённый выпуск проверяет применение правила отдельно.
- **Repro:** сопоставить D4, VERSIONING и WORKFLOW на одном новом совместимом flow и docs-only commit.
- **Risk:** старый номер для изменённого продукта или ошибочный MAJOR; несоответствие web/API/proxy.
- **Verification:** stage 0 docs audit 161 файл, 0 broken links/anchors/incomplete items, consistency review и independent Terra PASS; runtime release gate проверяется при следующем разрешённом выпуске.
- **Dependencies:** D4 clarification, текущий WORKFLOW §7; не разрешает самостоятельный push/tag/reset.

### TECH-008 — Единая программа и покрытие 82 эпизодов / 38 экспертных задач

- **Type:** research-and-delivery-specification
- **Priority:** P1
- **Status:** in_progress
- **Evidence:** два качественных user packages, экспертный checkpoint, принятые D36/D37 и [frozen source universe](audits/2026-09-13-ux-ui/implementation/source-universe.json).
- **Expected:** один атомарный реестр episode/subpoint→evidence→decision/gate→canonical task→stage→AT→result; полная route/state карта и проверяемые work orders этапов 1–14.
- **Actual:** stage 0 принят локально после независимого Terra PASS и coordinator checks; 236 атомарных строк покрывают 82 эпизода и 38 экспертных ID. Полная программа этапов 1–14 остаётся `in_progress`; пользовательские сеансы не были количественным тестом.
- **Repro:** сравнить 39+43 CSV IDs и 38 экспертных IDs с реестром; проверить составные комментарии по full reports и watchlist.
- **Risk:** потерять подпункт, принять самоотчёт за runtime, продублировать backlog или объявить decision-gated механику ready.
- **Verification:** [stage 0 acceptance receipt](audits/2026-09-13-ux-ui/implementation/stage0-acceptance.json), coverage checker, docs links/anchors, manual semantic atom review, independent frozen-delta review и проверка rollback. Runtime acceptance следующих этапов отдельно.
- **Dependencies:** [programme](test-plans/TECH-008-interface-programme.md), D36/D37; нет runtime/deploy в этапе 0.

### GAP-029 — Временно скрыть игровые и турнирные приглашения и вызовы во всём UI

- **Type:** product-availability
- **Priority:** P1
- **Status:** verified_prod
- **Evidence:** D37, U01-FORM-007, T01-06, T05-02; прежний GAP-018 target superseded.
- **Expected:** UI не создаёт/не предлагает game/tournament invites, challenge/revenge; старые записи и API сохраняются, team invite и judge handover доступны.
- **Actual:** stage 1 версии 4.0.0 опубликован на тестовом проде Vercel + Render + Neon: invitation/challenge/revenge UI и старые prefill query скрыты. Новый web использует `notificationView=available` для list/Home/read-visible; legacy API/data остаются доступны. Terra PASS и coordinator visual acceptance получены; пользовательская приёмка на телефоне ещё не проведена.
- **Repro:** пройти Home/profile/ranking/match/tournament/notification и старые URL с pending invitation на исходном SHA.
- **Risk:** ложный badge/пустые первые пять, утрата handover или самопроизвольное принятие старого invite.
- **Verification:** AT-UI-INV-001/002, mixed-type API/PGlite/PG fixture, legacy и opt-in read-visible, desktop/390 browser. Fresh `pnpm run ci` 1264/1264 (quality1129, PG72, browser59, cleanup4), 0 failed/skipped/todo/interrupted; [final local receipt](audit/evidence/gap029-stage1-final.json). Read-only [public receipt](audit/evidence/gap029-stage1-public.json): exact SHA/4.0.0 на web/API/proxy, Render database ready, GitHub CI all four jobs success. Pending invitation/readAt сохранены. Шесть stage-1 atom results детерминированно `verified_local` как локальные атомарные проверки; серверной пагинации пока нет, future-page часть AT-UI-INV-002 остаётся непроверенной.
- **Dependencies:** D37, NOTIF-005, GAP-017/018/BUG-037 overlay; один writer для shared notification/filter seam.

### GAP-030 — Главная как единственный глобальный вход и контекстный возврат

- **Type:** navigation
- **Priority:** P1
- **Status:** in_progress (навигация этапа 2 verified_local; Browser Back из Judge остаётся в безопасной навигации этапа 6)
- **Local acceptance (2026-09-18):** [stage 2 final receipt](audits/2026-09-13-ux-ui/implementation/stage2-final-evidence/stage2-final-receipt.json): CI 1291/1291, desktop/390, Terra и root PASS. Все разрешённые входы доступны также при первом pending/error Home; история и сетка восстанавливают контекст после серверного чтения; явный Home из Judge освобождает слот и подтверждается GET. Browser Back оставляет слот занятым, поэтому автоматический release для этого способа ухода не принят. Публичный стенд остаётся на 4.0.0.
- **Implementation delta:** tabs удалены; `/` ведёт к прямым действиям, `/start` перенаправляет к ним с фокусом, `/tournaments/new` открывает создание, `/tournaments` остаётся списком. Контекст истории и сетки хранится по аккаунту в пределах вкладки и перепроверяется сервером; явный Home из Judge проходит через existing release guard. Deep-link fallback и 404 ведут к доступному разделу/Home.
- **Evidence:** D36, HOME-006, U01-START-001, T01-01/07; final local receipt выше. Пять tabs относятся к исходной базе до этапа 2.
- **Expected:** без bottom tabs/menu доступны все разрешённые routes; Back возвращает в ту же сетку/историю, Home безопасен при deep link/auth/404/judge.
- **Actual:** локальный кандидат использует Home и контекстный возврат; native Browser Back из Judge не освобождает серверный слот.
- **Repro:** `App.tsx` route inventory, `/start`, bracket→match, history filter→detail, direct detail reload.
- **Risk:** потеря редких функций, контекста, judge slot или доступности при удалении shell.
- **Verification:** AT-HOME-003, AT-ONB-004, browser 390/desktop/keyboard/reauth/403/404/safe-area; judge release по серверу.
- **Stage 2 browser residual (2026-09-18):** compiled Chromium desktop/390 подтвердил явный Home → release и серверный `activeJudge=null`; Browser Back из Judge оставил слот активным. Это отдельный способ ухода, который текущий release guard не перехватывает. Автоматическое освобождение для browser Back не заявлять; согласовать его с отдельной работой над judge navigation/recovery до закрытия этого края.
- **R2 verified local:** при pending/ошибке первого GET Home история и рейтинг остаются доступны именованными ссылками без вымышленных метрик; component Red→Green, compiled desktop/390 и полный gate прошли. Browser Back остаток передан этапу 6.
- **Dependencies:** D36, GAP-029 UI availability; один shell writer, onboarding в том же delta.

### GAP-031 — Компактная Home и текущие задачи по роли

- **Type:** product-hierarchy
- **Priority:** P2
- **Status:** in_progress (принятая реализация этапа 2 verified_local; HOME-003 Maps/iPhone остаётся гипотезой до воспроизведения)
- **Local acceptance (2026-09-18):** [stage 2 final receipt](audits/2026-09-13-ux-ui/implementation/stage2-final-evidence/stage2-final-receipt.json): Home component 10/10, API Home 9/9, полный CI 1291/1291, Terra и root PASS. Ровно 23 принятых пользовательских атома этапа 2 имеют evidence-bound `verified_local`; HOME-003 main/a01 не закрыты. Это локальная приёмка реализации, не телефонное исследование и не публикация.
- **Implementation delta:** шапка и два прямых CTA, все личные current tasks, история `Все/Только мои`, top-3, уведомления и названные вторичные входы. `recentRole=player` фильтруется сервером до top-5; полный набор собственных результатов питает `myStats`. Обновление Home фоновое с сохранением последнего валидного ответа и явным Retry после ошибки.
- **R2 verified local:** турнирные карточки строятся из матчей/состава/judge sessions без full-detail fanout; чужой admin каталог не становится личными `currentTasks`, но совместимый `activeEvents.tournament` сохраняет существующий `topThree` для одного выбранного турнира. HOME-004/a03 «Только мои» означает участие игроком по D36/AT-HOME-001. Для HOME-007/a03 обычный завершённый матч ставит стороны/счёт первыми, длительность третьей, знак победителя у серверной `winnerSide`; особые terminal исходы остаются видимы. Формат/судья доступны в деталях. HOME-003 Maps/iPhone остаётся непроверенным сообщением.
- **Evidence:** D36, HOME-001/002/004/005/007, GAP-015; интервью — qualitative feedback одного автора.
- **Expected:** compact avatar/name/surname/rank/matches/wins/losses, direct match/tournament CTA, role-aware current tasks ahead of history; secondary stats в profile; Home обновляется фоном без постоянного «Обновить», Retry после ошибки.
- **Actual:** локальный кандидат выполняет принятый target; причина сообщения о Google Maps и физическое поведение iPhone не воспроизведены.
- **Repro:** Home с участником, судьёй, организатором, пустой историей и несколькими текущими событиями.
- **Risk:** скрыть событие другой роли или утратить доступ к истории/ranking/notifications/profile.
- **Verification:** AT-HOME-001..003, visibility/role API fixture и browser 390/desktop/empty/loading/error/keyboard.
- **Dependencies:** D36, GAP-030 shell, GAP-015 superseding target; право видимости не расширяется.

### GAP-032 — Ведение матча и следующий шаг без потери судейских инвариантов

- **Type:** interaction-concept
- **Priority:** P2
- **Status:** confirmed
- **Evidence:** U01-DETAIL-001..004, U01-JUDGE-001..006, GAP-017/023; жесты и таймер — предложения, не verified runtime.
- **Expected:** стабильные touch targets/счёт/подача/журнал, ясное подтверждение и следующий шаг; reduced motion и keyboard alternative.
- **Actual:** детали и судейство требуют отдельной спецификации геометрии и recovery; white gutters и zoom нужно воспроизвести на физическом устройстве.
- **Repro:** текущий JudgePage portrait/landscape и матчи разных состояний, затем scoped browser/device probe.
- **Risk:** случайное очко от scroll/tap, ложный результат, изменение прав через UI.
- **Verification:** после accepted target — component/browser/PG по затронутому поведению, D24/D33 и fast taps; physical iPhone отдельно.
- **Dependencies:** BUG-029/031/039, Q-UX-006/007/008/009 для новых механик; до решений только существующие безопасные seams.

### BUG-040 — Проверить и устранить iPhone zoom и landscape gutters

- **Type:** mobile-runtime-finding
- **Priority:** P2
- **Status:** confirmed
- **Evidence:** AUTH-003 и U01-JUDGE-001, self-report с кадрами; CSS-причина не установлена. Visual receipt 44 кадров подтверждает отдельные видимые состояния, но не воспроизводит persistent zoom; оригиналы во внешнем ephemeral источнике.
- **Expected:** auth focus/keyboard и judge rotation не оставляют навязанное приближение или белые поля; пользовательский zoom остаётся разрешён.
- **Actual:** сообщённые физические состояния ещё не воспроизведены независимо.
- **Repro:** physical iPhone с точным браузером/версией/viewport/font/keyboard/orientation; сверить до/после shell change.
- **Risk:** объявить эмуляцию подтверждением физического дефекта или запретить доступное масштабирование.
- **Verification:** browser emulation для разработки и отдельный physical-iPhone gate после публикации; evidence явного device/OS/browser.
- **Dependencies:** этап 3/6, GAP-030 body/safe-area restore; до повторения не повышать severity по предположению.

### GAP-033 — Упростить отдельный band матча за третье место

- **Type:** bracket-interaction
- **Priority:** P2
- **Status:** confirmed
- **Evidence:** первичный комментарий T03-08: матч за третье место нужен, отдельные zoom/arrow controls для одной пары воспринимаются лишними; перекрытие при scroll — пока гипотеза.
- **Expected:** отдельная пара за третье место и вход в неё доступны, без избыточных локальных controls; масштаб и навигация основной SE/DE сетки по GAP-020 сохраняются.
- **Actual:** текущий third-place band имеет собственные arrows/zoom; mobile перекрытие независимо не воспроизведено.
- **Repro:** SE3/5/8, DE5/8 и third-place на 390/desktop/keyboard; сравнить управление band и scroll regions.
- **Risk:** удалить доступ к матчу или сломать фокус/обзор основной сетки.
- **Verification:** после точного target — focused bracket tests и browser mobile/desktop/keyboard/scroll, отдельная проверка overlap hypothesis.
- **Dependencies:** stage 8 GAP-020, TOURNAMENT-017/AT-TRN-010; target и визуальная приёмка до `ready`.

### GAP-034 — Общая семантика статусных чипов и иконок

- **Type:** cross-surface-ui-semantics
- **Priority:** P2
- **Status:** confirmed
- **Evidence:** первичные U01-DETAIL-002 («любой из статусных чипов в системе» выглядит кнопкой с неясной иконкой) и U01-JUDGE-003 (иконка подающего и согласованность иконок сервиса); один автор, без доказанной частоты ошибки. Существующий визуальный baseline — опубликованный продукт по D22.
- **Expected:** статусы читаются как данные, действия — как действия; иконка, если она нужна, означает одно и то же в родственных контекстах и дополняется понятным текстом/accessible name. Focus, selected, active, pending и error не смешиваются с доменным статусом. Никакого rebrand или новой художественной системы.
- **Actual:** реакция на match status chip и serve icon зафиксирована в отзыве; поведение всех поверхностей и точный visual target ещё не инвентаризированы.
- **Repro:** на исходном SHA открыть match detail и judge serve setup с текущими статусами/иконкой, затем теми же ролями пройти Home, tournament, history, notifications, team и admin; записать rendered/DOM роль каждого chip/action без предположения о клике из кадра.
- **Stage 3 bounded output / owner:** один writer сначала составляет inventory фактических chip/icon семейств и состояний по Home, match/judge, tournament/bracket, history, notifications, team и admin (только доступные роли и видимые по D37 данные). Для каждой семьи фиксирует источник значения, статический/интерактивный характер, label/icon/цвет/focus/selected/active/disabled/pending/error, responsive и screen-reader meaning; затем предлагает минимальный target и sample на текущих компонентах. `ready` только после принятия inventory/target; одна общая семантика без преждевременной замены всех consumers.
- **Consumer sequence:** stage 3 — общий контракт и Home/common-control sample после Home shell; stage 6 — match/judge; stage 8 — tournament/bracket; stage 9 — team; stage 10 — history/notifications; stage 11 — admin. Каждый consumer применяет принятый контракт в своём bounded work order и не переписывает общий компонент параллельно с другим writer. GAP-017/GAP-032 сохраняют отдельную подачу/счёт и права; GAP-034 задаёт только общую status/icon грамматику.
- **Given / When / Then:** Given non-actionable match/tournament/account/team/notification status, When он показан рядом с разрешённым действием, Then роль чипа, текст и focus не обещают click; keyboard/screen reader получают смысл без угадывания иконки или цвета. Given selected filter или active judge/action, Then это различимо от persisted domain status и интерактивность соответствует доступным правам. Given loading/pending/error, Then смысл состояния и достижимое следующее действие сохраняются на 360/390/desktop и в light/dark. Отсутствие скрытых D37 приглашений не превращается в фиктивный статус.
- **Risk:** скрыть редкое состояние, сделать невидимым разрешённое действие, изменить actor rights или заменить ясный текст декоративной иконкой.
- **Verification:** stage 3 inventory + target review по всем семьям/ролям и representative rendered states; для каждого consumer — focused semantics tests и browser keyboard/focus/contrast/light-dark/mobile/desktop, без тестов на имя CSS class. Проверить сохранение всех meaningful states и D17/D35 visibility/rights; runtime acceptance только после соответствующего этапа.
- **Dependencies:** D22/D36/D37, AT-UI-STATUS-001, BUG-020 focus и имеющиеся компоненты; конкретный visual target должен пройти review до реализации. Никаких новых API/data/permissions.
