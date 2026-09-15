# Модель данных as-built

Снимок [`../../apps/api/src/db/schema.ts`](../../apps/api/src/db/schema.ts) и
forward migrations на **2026-09-13**. Целевая модель в
[`../requirements/07_DATA_MODEL.md`](../requirements/07_DATA_MODEL.md) не полностью
совпадает с этим состоянием.

## Фактические таблицы

| Таблица | Назначение | Важные связи/заметки |
|---|---|---|
| `users` | аккаунт, роль/status, профиль, avatar, onboarding | unique email; `onboarding_step` bounded 0..6, nullable completion timestamp; содержит password hash и session-related flags |
| `auth_sessions` | hashed session tokens | user FK, expiry/revocation |
| `temporary_password_issues` | выдача/потребление временного пароля | user + issuing admin |
| `matches` | правила, score snapshot, lifecycle | creator; optional tournament; JSON event log/idempotency keys; `first_server_method`, `source` |
| `match_participants` | стороны A/B, user или guest | guest хранится в строке; constraints «ровно один тип» недостаточны |
| `match_invitations` | voluntary player/judge invitation history | match/user/inviter FKs; historical participant UUID without FK, saved side, pending uniqueness and 10-minute TTL; start closes pending rows |
| `match_void_audits` | append-only ledger коррекции результата | unique match/key; actor, prior result/events/version, reason и compensation; trigger запрещает update/delete |
| `judge_sessions` | judge lock/heartbeat/expiry | match, user, auth session, optional `reserved_for_user_id`; active match/user/reservation exclusivity app/SQL |
| `tournaments` | config/lifecycle/bracket | bracket JSON, DB-only bracket version, construction algorithm, immutable consent policy |
| `tournament_participants` | user/guest roster, seed, wins snapshot | status; actor/source and optional fingerprinted idempotency provenance; partial unique active user/key |
| `tournament_invitations` | invite lifecycle | invited/inviter users, expiry/status/terminal reason; partial unique pending invite per tournament/user |
| `teams` | team/captain/status | unique slug |
| `team_memberships` | membership history | leftAt/leaveReason вместо hard delete; partial unique active membership per team/user |
| `team_invitations` | team invite lifecycle | expiry/status; partial unique pending invite per team/user |
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
и forward-only migrations [`0001_data_005_match_void.sql`](../../apps/api/drizzle/0001_data_005_match_void.sql),
`0002_data_004_invitation_membership_races.sql`, `0003_bug_012_onboarding_resume.sql`
`0004_gap_005_match_judge_flows.sql` и `0005_gap_008_match_consent.sql`:
19 public tables и Drizzle ledger в отдельной schema `drizzle`. API startup не
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

## Wave A migration safety

Immutable migrations 0000/0001 are preserved. Migration 0002 reconciles duplicate
active memberships and collecting/unbracketed participants before adding partial
unique indexes; it fails before writes for duplicate participants in any tournament
with a bracket or progress. Migration 0003 adds onboarding step 0..6 and backfills
legacy active accounts as completed. Ledger-prefix schema attestation supports
intermediate snapshots; malformed index predicates/check bounds remain rejected.

Migration 0004 adds `matches.first_server_method`, `matches.source`,
`judge_sessions.reserved_for_user_id` with canonical short-name FK, and partial
unique indexes for active user participation and reserved judge ownership. The
older 0000..0003 migration files remain unchanged.

Wave C handover releases the former judge row and inserts a separate reserved row,
preserving historical judge/profile counts. Claim activates the reserved row.
New finish confirmation adds `finish-confirmed:<sha256(judge-session-id)>` to the
existing match `idempotency_keys` JSON array; no additional schema migration is
needed. This marker records retry provenance rather than a client idempotency key.

Wave D team lifecycle uses the existing membership, invitation and team schema; no migration
is required. User blocking and captain succession/archive share one transaction. User locks
precede team locks for create/invite/accept so a block cannot race in a new active membership
or sole captain. Captain removal/leave requires prior transfer; memberships are retained for
history. Archived teams cancel pending invitations and disappear from active team pickers.
Tournament summary is derived from persisted bracket and actual match scores; it adds no
stored leaderboard and excludes voided match statistics while preserving D33 bracket places.

### Wave E candidate persistence

Migration0005 creates consent history without a legacy backfill. Removing a prestart
roster row retains the historical participant UUID and side; pending history becomes
cancelled. Accepted consent is usable only by the unchanged current row. Match,
invitation and user locks serialize responses, retries and starts; tested concurrent
accept/start and reinvite produce one persisted outcome and one pending notification.
PGlite migration21/21 and focused PostgreSQL2/2 passed; full PostgreSQL gate pending.

### GAP-012 persistence

Migration `0006_gap_012_game_setup.sql` adds
`tournaments.require_participant_consent boolean not null default false`,
participant actor/source/idempotency provenance and tournament-invitation terminal
reason. Historical tournaments remain direct-roster policy and historical
participants use source `legacy` without an invented actor. A partial unique index
owns each successful `(tournament_id, addition_idempotency_key)`. The application
writes the request fingerprint with every keyed addition and rejects a replay whose
fingerprint differs; the database has no separate key/fingerprint pairing check.

Tournament add, invitation response, bracket generation and start lock the parent
tournament row. Post-bracket add inserts the participant, cancels/reads a matching
pending invitation, writes the audit and regenerates the bracket inside one
transaction. Existing `seedOrder` is retained as a prefix and new participant IDs
append. Real PostgreSQL ordered races cover both invite/add orders, start/add and
two concurrent post-bracket adds; PGlite fault injection proves full rollback.
