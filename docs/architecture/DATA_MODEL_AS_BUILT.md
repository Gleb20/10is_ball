# Модель данных as-built

Снимок [`../../apps/api/src/db/schema.ts`](../../apps/api/src/db/schema.ts) и
immutable baseline migration на **2026-09-07**. Целевая модель в
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

PR1 содержит ровно [`0000_data_003_baseline.sql`](../../apps/api/drizzle/0000_data_003_baseline.sql):
17 public tables и Drizzle ledger в отдельной schema `drizzle`. API startup не
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
PGlite остаётся explicit reduced-fidelity mode и hermetic test layer. TypeScript
mapping умеет безопасно прочитать будущий match status `voided`, но migration
0000 его не создаёт и PR1 не имеет write route/UI action для этого состояния.

## Необеспеченные invariants

- Нет полного DB-level запрета duplicate/self players и invalid user/guest rows.
- Judge exclusivity по пользователю/сессии и cleanup expired rows неполны.
- Invite/membership uniqueness и atomic state transitions неполны.
- Match finish, stats и bracket advancement не единая транзакция.
- Audit log не immutable; source events могут физически исчезать.
- Hard delete standalone match противоречит принятой void-only модели.

Оставшиеся исправления отслеживаются как `DATA-001..006`, `SEC-007` в
[`../BACKLOG.md`](../BACKLOG.md). При любом schema change обновить этот файл,
целевой data model, migration evidence и traceability по
[`../WORKFLOW.md`](../WORKFLOW.md).
