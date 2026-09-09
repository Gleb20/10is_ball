# Модель данных as-built

Снимок [`../../apps/api/src/db/schema.ts`](../../apps/api/src/db/schema.ts) и
forward migrations на **2026-09-09**. Целевая модель в
[`../requirements/07_DATA_MODEL.md`](../requirements/07_DATA_MODEL.md) не полностью
совпадает с этим состоянием.

## Фактические таблицы

| Таблица | Назначение | Важные связи/заметки |
|---|---|---|
| `users` | аккаунт, роль/status, профиль, avatar, onboarding | unique email; содержит password hash и session-related flags |
| `auth_sessions` | hashed session tokens | user FK, expiry/revocation |
| `temporary_password_issues` | выдача/потребление временного пароля | user + issuing admin |
| `matches` | правила, score snapshot, lifecycle | creator; optional tournament; JSON event log/idempotency keys |
| `match_participants` | стороны A/B, user или guest | guest хранится в строке; constraints «ровно один тип» недостаточны |
| `match_void_audits` | append-only ledger коррекции результата | unique match/key; actor, prior result/events/version, reason и compensation; trigger запрещает update/delete |
| `judge_sessions` | judge lock/heartbeat/expiry | match, user, auth session; exclusivity частично app/SQL |
| `tournaments` | config/lifecycle/bracket | bracket JSON, DB-only bracket version, construction algorithm |
| `tournament_participants` | user/guest roster, seed, wins snapshot | status text; uniqueness/invariants неполны |
| `tournament_invitations` | invite lifecycle | invited/inviter users, expiry/status |
| `teams` | team/captain/status | unique slug |
| `team_memberships` | membership history | leftAt/leaveReason вместо hard delete |
| `team_invitations` | team invite lifecycle | expiry/status |
| `notifications` | per-user messages | JSON payload, readAt |
| `audit_logs` | generic technical audit entries | actor/action/entity/meta; bootstrap writes `admin.bootstrap_provisioned` with nullable system actor; append-only не обеспечен DB |
| `faq_articles` | help content | category/sort |
| `feedback_messages` | user feedback | kind/message |
| `user_stats` | denormalized ranking counters | all-time wins/losses и week/month wins |

## Хранение спортивного состояния

- Match score хранится и как snapshot (`score_a`, `score_b`, serve/deuce/version),
  и как JSON `event_log` в той же строке.
- Tournament topology хранится в `tournaments.bracket_json`, а игровые экземпляры —
  в `matches` с `kind=tournament`, `tournament_id`, slot/node identifier.
- V2 bracket concurrency version хранится только в DB column
  `bracket_state_version`, не внутри JSON.
- User ranking counters денормализованы в `user_stats`; calendar period values не
  являются полным журналом, а пересчитываются/обновляются прикладным кодом.
- Все абсолютные timestamps с timezone должны храниться в UTC; Europe/Moscow
  применяется для UI и календарных day/week/month boundaries согласно ADR D20.

## Фактическое создание/обновление схемы

Migration set содержит immutable
[`0000_data_003_baseline.sql`](../../apps/api/drizzle/0000_data_003_baseline.sql)
и forward-only [`0001_data_005_match_void.sql`](../../apps/api/drizzle/0001_data_005_match_void.sql):
18 public tables и Drizzle ledger в отдельной schema `drizzle`. API startup не
выполняет DDL и допускает только точный известный ledger prefix; более новые
trailing migrations разрешены лишь для запуска предыдущего совместимого API при
rollback. После explicit migration требуется exact ledger и полный catalog
profile (enum, columns/defaults/nullability, constraints, indexes).

`db:migrate -- --mode=apply` создаёт fresh schema либо продолжает exact prefix.
Одноразовый `--mode=adopt-unversioned` принимает только exact historical 17-table
catalog с отсутствующим/канонически пустым ledger и проверенным backfill manifest.
Оба режима используют dedicated direct `MIGRATION_DATABASE_URL`, одну reserved
connection, advisory lock и bounded timeouts. Ошибка не выполняет ручной stamp.

Default local runtime — PostgreSQL 16.15 с разделёнными owner/runtime roles;
PGlite остаётся explicit reduced-fidelity mode и hermetic test layer. Migration
`0001` добавляет `voided`, immutable ledger, indexes and trigger without rewriting
`0000`; current snapshot проверяется отдельно от historical adoption snapshot.

## Необеспеченные invariants

- Нет полного DB-level запрета duplicate/self players и invalid user/guest rows.
- Judge exclusivity по пользователю/сессии и cleanup expired rows неполны.
- Invite/membership uniqueness и atomic state transitions неполны.
- Generic `audit_logs` остаётся mutable; dedicated sporting void ledger immutable.
- Invitation/membership races и часть judge lifecycle constraints остаются P1.

Match terminal write, SQL-arithmetic stats, judge release and tournament
advancement now share one transaction with match CAS, tournament row lock,
bracket version CAS and unique actual-match-per-node index. D33 tournament void
does not touch the bracket or downstream history and reverses only target stats.

Оставшиеся исправления отслеживаются в
[`../BACKLOG.md`](../BACKLOG.md). При любом schema change обновить этот файл,
целевой data model, migration evidence и traceability по
[`../WORKFLOW.md`](../WORKFLOW.md).
