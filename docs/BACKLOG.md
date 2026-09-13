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

- **Accepted Wave C 2026-09-13:** full `verify:all` 1056/1056 (quality980, PostgreSQL47, browser25, cleanup4), zero failures/skips/todo/interrupted; 16 compiled desktop/390 journeys and rendered review. Independent review repairs and authoritative persisted-state assertions passed. [Evidence](audit/evidence/wave-c-local.json). Candidate2.1.0 awaits exact-SHA public release.

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
- **Execution slices (wave D, после GAP-007):** 1) Полные настройки/roster/pair/bye editing и invalidation/regenerate. 2) Start/advance/stop/cancel/dissolve, current/next/duration/placements/top-3. 3) SE/DE 3/5/8 участников, busy-bye, concurrent advancement и D33; browser portrait/landscape bracket.
- **Acceptance mapping:** TOURNAMENT-001..019; AT-TRN-001..021; verification evidence фиксируется по каждой slice, полный ID закрывается после всех slices и release gate.


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
- **Execution slices (wave D, до GAP-006):** 1) Captain/invite/respond/detail с active-membership invariants. 2) Leave/transfer/archive и недопустимые переходы. 3) Подключение состава к event picker и браузерный lifecycle нескольких пользователей; конкурентные изменения на PostgreSQL.
- **Recheck 2026-09-13:** current service has create/get/list/invite/respond and block-triggered captain selection; no update/remove/leave/manual-transfer/archive API or team-detail UI. `matchCreateOptions` already includes own active teams and was verified in Wave C. Reuse it instead of duplicating a picker service.
- **Bounded orders:** domain transaction/DTO and captain invariants → canonical route/OpenAPI contracts with legacy invite/respond compatibility → team detail/welcome/controls → multi-user browser and real PostgreSQL captain/leave/accept races. Inspect blockUser→transferCaptainOnBlock atomicity before changing lifecycle; preserve historical memberships and current team ranking semantics.

- **Acceptance mapping:** TEAM-001..009; AT-TEAM-001..006; verification evidence фиксируется по каждой slice, полный ID закрывается после всех slices и release gate.


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
- **Execution slices (wave E):** 1) Сопоставить каждый product event с типом и получателем уведомления. 2) Реализовать недостающие types/popup/suppression и действия. 3) Проверить expiry/cancel/revoke/read/retry и отсутствие дублей; browser multi-user flow.
- **Acceptance mapping:** NOTIF-001..006; AT-NOTIF-*; verification evidence фиксируется по каждой slice, полный ID закрывается после всех slices и release gate.


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
- **Execution slices (wave E):** 1) Завершить contextual guide поверх persisted steps с явным завершением после tutorial. 2) Категории Help/feedback и contextual tips. 3) First-login/skip/resume/restart/tutorial-return и отправка разных категорий с ошибками/retry.
- **Acceptance mapping:** ONB-001..005; HELP-001..003; D34; verification evidence фиксируется по каждой slice, полный ID закрывается после всех slices и release gate.


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
- **Execution slices (wave E):** 1) Search/filter/profile edit/created/last-login и audit visibility. 2) Ролевые запреты, self/last-admin, session revocation и пустые результаты поиска. 3) Полный browser admin lifecycle и persisted audit assertions.
- **Acceptance mapping:** ADM-002..008; AT-AUTH-008; verification evidence фиксируется по каждой slice, полный ID закрывается после всех slices и release gate.


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
- **Execution slices (wave F и в каждой UI-задаче):** 1) Закрывать geometry/44px/contrast/keyboard/focus/safe-area по мере интеграции страниц. 2) Убрать временное исключение color-contrast из critical E2E после исправления. 3) Полный desktop/390/360/judge-landscape и доступный WebKit проход; неподтверждённые physical-device проверки явно оставить residual, не объявлять выполненными.
- **Acceptance mapping:** A11Y checklist; UX state matrix; verification evidence фиксируется по каждой slice, полный ID закрывается после всех slices и release gate.


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
- **Evidence:** Red: `pnpm test:e2e` отсутствовал. Текущие `playwright.config.ts` и `tests/e2e/critical.spec.ts` запускают два acceptance journey в system Chrome на 1280×800 и 390×844 через attested in-memory `AUDIT_EPHEMERAL=1` API.
- **Expected:** критические auth/match/judge/tournament/admin journeys и negative authz проверяются на real browser; coverage thresholds измеряются, но не заменяют сценарии.
- **Actual:** bounded first slice повторяемо проходит login → guest match create → judge acquire/setup → rapid score 5:0 → persisted finish и runtime session revoke → focused re-login → same route/draft без mutation replay. Login/Home/Judge/recovery form проходят serious/critical axe gate (известный `color-contrast` GAP-011 явно исключён), проверенные surfaces не имеют horizontal overflow. Tournament/admin/team/handover и cross-browser/device breadth ещё не покрыты.
- **User-visible outcome:** regressions в критическом standalone match/judge и runtime re-auth path ловятся реальным браузером до релиза на desktop и mobile widths.
- **Non-goals:** production/external services, deploy/version bump, визуальный redesign и remediation GAP-011 в этом slice.
- **Permissions:** loopback browser/API/web и disposable PGlite only.
- **Open questions:** расширение на Safari/Firefox/real devices, tournament/admin и multi-context handover остаётся продолжением TECH-002/GAP-011.
- **Repro:** на Node 24/pnpm 9 выполнить `pnpm test:e2e`.
- **Risk:** визуальные/интеграционные дефекты проходят CI.
- **Verification:** [`test-plans/TECH-002-browser-e2e.md`](test-plans/TECH-002-browser-e2e.md); Playwright 1.63.0/system Chrome 4/4 green локально (2 journeys × desktop/mobile), serious/critical axe и horizontal geometry included. Combined Node 24 CI green: audits, lint/typecheck, shared 522, test-utils 4, web 124, API 150 + 7 guarded PostgreSQL skipped, builds. GitHub quality job теперь устанавливает Chrome и запускает тот же `pnpm test:e2e`; hosted run требует commit/push approval и ещё не выполнялся. Screenshots/traces сохраняются only-on-failure.
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
