# Data Model v1 — Tab-10 MVP

## 1. Принципы

- UUID/ULID для публичных идентификаторов.
- UTC timestamps, отображение в локальной зоне клиента.
- Soft state (`status`, `archived_at`, `blocked_at`) вместо удаления значимых записей.
- Без `organization_id`: одна инсталляция = одна организация.
- Завершённые события неизменны.
- Зарегистрированный пользователь в истории рендерится по актуальному профилю.
- Гости сохраняют event-level snapshot; D40 дополнительно предусматривает явную
  reusable identity без auto-merge или переписывания historical names.

## 2. Пользователи и сессии

### `user`
- `id`
- `email` unique
- `password_hash`
- `role` enum `admin|user`
- `status` enum `active|blocked`
- `first_name`
- `last_name`
- `birth_date` nullable
- `organization_text` nullable, default `Moscow transport`
- `position_text` nullable
- `avatar_source` enum `generated|uploaded`
- `generated_avatar_key` nullable
- `uploaded_avatar_path` nullable
- `must_change_password` boolean
- `onboarding_completed_at` nullable
- `created_at`
- `updated_at`
- `blocked_at` nullable
- `last_login_at` nullable
- `last_admin_password_reset_request_id` nullable FK → `admin_password_reset_requests.request_id`

Constraints:
- lowercased unique email;
- blocked user cannot create new session;
- generated/uploaded avatar fields consistent with source.

### `auth_session`
- `id`
- `user_id`
- `token_hash`
- `user_agent`
- `ip_hash_or_truncated`
- `created_at`
- `last_seen_at`
- `expires_at`
- `revoked_at` nullable
- `revoke_reason` nullable

### `temporary_password_issue`
- `id`
- `user_id`
- `issued_by_admin_id`
- `issued_at`
- `consumed_at` nullable

Не хранит открытый пароль; запись нужна только для аудита выпуска.

### `admin_password_reset_requests`
- `request_id` UUID primary key
- `actor_admin_id`
- `actor_auth_session_id`
- `target_user_id`
- `expected_last_applied_request_id` nullable
- `supersedes_request_id` nullable
- `request_fingerprint`
- `outcome` enum `pending|applied|rejected_state_changed`
- `completed_at` nullable
- `created_at`

Открытый пароль не хранится. Один request id нельзя переиспользовать с другим
fingerprint. `pending` не имеет `completed_at`, terminal outcome обязан его
иметь; request не может supersede сам себя. Target pointer и receipt меняются в
той же транзакции, что password hash, отзыв сессий, temporary issue, audit и
notification.

## 3. Команды

### `team`
- `id`
- `name`
- `slug`
- `avatar_key` nullable (D40: один из avatar_1..avatar_10; без upload/storage)
- `slogan` nullable
- `welcome_text` nullable
- `captain_user_id`
- `status` enum `active|archived`
- `created_at`
- `updated_at`
- `archived_at` nullable

### `team_membership`
- `id`
- `team_id`
- `user_id`
- `joined_at`
- `left_at` nullable
- `leave_reason` nullable

Unique active `(team_id,user_id)`.

### `team_invitation`
- `id`
- `team_id`
- `invited_user_id`
- `invited_by_user_id`
- `status` enum `pending|accepted|declined|expired|cancelled`
- `expires_at`
- `responded_at` nullable
- `expiry_reason` nullable
- `created_at`

## 4. Гости

### `guest_identities` — явно сохранённый гость (D40)

UUID, first_name/last_name (1..100 после trim), неизменяемый avatar_key из D10,
created_by_user_id, version >= 0, created_at/updated_at. Имя не является ключом:
две записи с одинаковыми именами допустимы. Переименование меняет только текущую
подпись identity и требует expectedVersion; разрешено создателю либо active admin.

`guest_identity_requests`: actor_user_id + request_id — составной PK, операция
create/rename, fingerprint исходного запроса, guest_identity_id, resulting_version
и время. Identity, audit и receipt фиксируются одной транзакцией; повтор не
дублирует ни одну из них. Rename audit хранит прежнее/новое имя и итоговую версию.

Разовые гости по-прежнему хранятся снимком в participant row. Nullable
`guest_identity_id` добавляется рядом с именем/аватаром снимка; у прежних строк
остаётся NULL. Автоматического объединения по имени, backfill или привязки к
аккаунту нет. Матч не допускает один durable guest ID на двух местах; активный
состав турнира также уникален по identity. Ограничение одновременного участия
зарегистрированных users не расширяется на гостей.

## 5. Правила матча

### `match_ruleset`
- `id`
- `points_to_win` integer
- `mercy_enabled` boolean
- `mercy_points` integer nullable
- `first_server_method` enum `random|manual|rally`
- `match_format` enum `1v1|2v2`
- `created_by_user_id`
- `created_at`

Validation:
- `points_to_win >= 1`;
- при mercy `mercy_points >= 1`;
- tournament ruleset только `1v1`.

## 6. Матчи

### `match`
- `id`
- `title`
- `kind` enum `standalone|tournament|tutorial`
- `status` enum `waiting|in_progress|pending_confirmation|finished|stopped|cancelled|voided`
- `format` enum `1v1|2v2`
- `ruleset_id`
- `created_by_user_id`
- `tournament_id` nullable
- `tournament_slot_id` nullable
- `score_a`
- `score_b`
- `current_server_participant_id` nullable
- `serve_sequence_index`
- `deuce_mode`
- `version`
- `started_at` nullable
- `finished_at` nullable
- `stopped_at` nullable
- `winner_side` nullable `A|B`
- `finish_reason` nullable enum `normal|manual_stop|no_show|forfeit|tutorial`
- `stop_reason_code` nullable
- `stop_reason_text` nullable
- `created_at`
- `updated_at`

Для `voided` исходный результат/события не удаляются. Отдельная append-only запись
void хранит `match_id`, `actor_user_id`, `created_at`, prior result/version,
опциональную причину и ссылки на идемпотентную stats/dependent compensation.
Отдельного approval state нет. Void разрешён только активному `admin` или
`match.created_by_user_id`; hard delete finished/stopped/voided match запрещён
(D19/D24).
Повтор той же операции не создаёт повторную компенсацию, а audit/compensation
коммитятся согласованно. Для tournament result компенсируются только counters
целевого match; `bracket_json`, `bracket_state_version`, downstream rows/results,
их stats и notifications остаются неизменными (D33). Audit фиксирует выбранную
policy `preserve_bracket_and_downstream`.

### `match_participant`
- `id`
- `match_id`
- `side` enum `A|B`
- `position_in_side` integer
- `participant_type` enum `user|guest|tutorial_actor`
- `user_id` nullable
- `guest_identity_id` nullable; guest name/avatar snapshot remains on this participation
- `display_name_snapshot` only for tutorial actor/optional guest convenience
- `created_at`

Input выбирает ровно один вариант: user_id, guest_identity_id или полное имя разового гостя. Снимок сохранённого гостя заполняется сервером в той же транзакции.

Создание `match` и полного набора `match_participant` атомарно: invalid roster,
blocked/missing registered user или ошибка любой participant write не оставляет
частичный match. Exact 1v1/2v2 cardinality и distinct user проверяются также
application service; `created_by_user_id` остаётся владельцем и не требует
participant row. DB-level дублирующие constraints вводятся
только через согласованный versioned migration (DATA-003).

Переход `pending_confirmation → finished` и допустимый `→ stopped` используют
status/version CAS. Terminal match row, SQL-arithmetic `user_stats`, judge release,
tournament row-locked/CAS bracket transition, materialized next matches и
notifications входят в одну transaction. Повтор подтверждения тем же judge
session возвращает уже finished result без повторных counters/advancement.
Partial unique `(tournament_id,tournament_bracket_match_id)` обеспечивает один
actual match на V2 node независимо от application retry (`DATA-002`).

### `match_invitation`
- `id`
- `match_id`
- `match_participant_id` nullable: immutable historical UUID for player consent; retained after roster replacement, intentionally no participant FK
- `participant_side` nullable `A|B`: historical player side; judge invitations have neither participant field
- `invited_user_id`
- `invited_by_user_id`
- `kind` enum `player|judge`
- `status` enum `pending|accepted|declined|expired|cancelled`
- `expires_at`
- `responded_at` nullable
- `expiry_reason` nullable
- `created_at`

Player invitation attaches to a particular roster identity and side, but remains
voluntary metadata rather than permission to play. A prestart edit that keeps the
participant ID/user/side retains accepted history; replacement cancels obsolete
pending history. Selection sends nothing unless `sendPlayerInvitations=true`.
Neither player nor judge invitation gates start or reserves a judge session. Start
closes every pending row with `expiry_reason=match_started` and reads the linked
notification. Pending uniqueness remains per match/target/kind and historical
participant.

### `judge_session`
- `id`
- `match_id`
- `judge_user_id`
- `auth_session_id`
- `status` enum `active|released|expired|handed_over`
- `reserved_for_user_id` nullable
- `started_at`
- `last_heartbeat_at`
- `expires_at`
- `ended_at` nullable

Critical indexes/constraints:
- unique active session per match;
- unique active judge session per judge user;
- active session bound to one auth session.

### `match_event`
- `id`
- `match_id`
- `sequence_no`
- `event_type` enum `point_awarded|point_undone|manual_correction|serve_adjusted|side_changed|finish_proposed|finish_reverted|finish_confirmed`
- `actor_user_id`
- `side` nullable
- `participant_id` nullable
- `payload_json`
- `idempotency_key` nullable
- `is_effective` boolean
- `occurred_at`
- `created_at`

Unique `(match_id,sequence_no)`; unique `(match_id,idempotency_key)` where not null.

## 7. Турниры

### `tournament`
- `id`
- `title`
- `status` enum `collecting|bracket_generated|needs_regeneration|in_progress|finished|stopped|cancelled`
- `format` enum `single_elimination|double_elimination`
- `organizer_user_id`
- `organizer_participates`
- `ruleset_id`
- `default_judge_user_id` nullable
- `bracket_version`
- `started_at` nullable
- `finished_at` nullable
- `stopped_at` nullable
- `stop_reason_code` nullable
- `stop_reason_text` nullable
- `created_at`
- `updated_at`

Для double-elimination поддерживается только V2 bracket representation. Legacy V1
DE не мигрируется и не сохраняется как playable/read-compatible формат: такой
payload должен fail closed с bounded unsupported-version result. Никакой
production reset/recreate из этой схемы не следует и без отдельного явного
разрешения не выполняется (D25). V1 single-elimination этим решением не меняется.

### `tournament_participant`
- `id`
- `tournament_id`
- `participant_type` enum `user|guest`
- `user_id` nullable
- `guest_identity_id` nullable; guest name/avatar snapshot remains on this participation
- `added_by_user_id` nullable FK to user; historical migration leaves it null
- `addition_source` text check: `legacy|organizer_default|manual_direct|manual_override|invitation_accept|guest_manual`
- `addition_idempotency_key` nullable UUID and `addition_request_fingerprint` nullable hash
- `status` enum `active|withdrawn|forfeited`
- `seed_rank` nullable
- `joined_at`
- `withdrawn_at` nullable

### `tournament_invitation`
- адресное добровольное приглашение с TTL 10 минут; `terminal_reason` сохраняет
  `expired|declined|manual_override|organizer_cancelled|roster_closed|event_cancelled`.

`tournaments.require_participant_consent boolean not null default false` хранит
immutable creation-time policy. Existing tournaments migrate to `false`, а existing
participants receive `addition_source=legacy` without an invented actor. Partial
unique indexes enforce one active registered participant and one successful
idempotency key per tournament. Add/invite response/generate/start serialize on the
tournament row; participant, invitation notification, audit and optional bracket
regeneration commit or roll back together.

### `tournament_bracket_slot`
- `id`
- `tournament_id`
- `bracket_side` enum `main|losers|final`
- `round_no`
- `slot_no`
- `participant_source_type` enum `participant|winner_of|loser_of|bye|empty`
- `participant_id` nullable
- `source_match_id` nullable
- `target_match_id` nullable
- `locked`

### `tournament_match`
- `id`
- `tournament_id`
- `match_id`
- `bracket_side`
- `round_no`
- `match_no`
- `next_winner_match_id` nullable
- `next_loser_match_id` nullable
- `status`

## 8. Уведомления

### `notification`
- `id`
- `user_id`
- `type`
- `title`
- `message`
- `entity_type` nullable
- `entity_id` nullable
- `action_state` enum `pending|accepted|declined|expired|informational`
- `reason_code` nullable
- `is_read`
- `read_at` nullable
- `expires_at` nullable
- `created_at`

## 9. FAQ и feedback

### `faq_category`
- `id`, `slug`, `title`, `sort_order`, `active`.

### `faq_article`
- `id`, `category_id`, `title`, `body_md`, `sort_order`, `active`, `updated_at`.

### `feedback_message`
- `id`
- `user_id`
- `category` enum `bug|idea|question|other`
- `message_text`
- `status` enum `new|reviewed|closed`
- `created_at`

## 10. Audit

### `audit_log`
- `id`
- `actor_user_id` nullable for system
- `event_type`
- `entity_type`
- `entity_id`
- `context_role` nullable
- `payload_json`
- `created_at`

## 11. Read models

### `user_stats`
- `user_id`
- `matches_played`
- `wins`
- `losses`
- `points_scored`
- `avg_points_per_match`
- `tournaments_played`
- `tournament_wins`
- `matches_judged`
- `tournaments_created`
- `updated_at`

### `ranking_entry`
- `scope` enum `all_time|calendar_week|calendar_month`
- `period_start` nullable
- `user_id`
- `wins`
- `losses`
- `matches_played`
- `win_rate`
- `rank_position`
- `updated_at`

Может быть view/query, а не физическая таблица на старте.

## 12. Индексы

Обязательные:
- `user(lower(email))` unique;
- sessions by `user_id, revoked_at, expires_at`;
- matches by `status, updated_at`;
- match participants by `user_id, match_id`;
- events by `match_id, sequence_no`;
- tournaments by `status, updated_at`;
- tournament participants by `user_id, tournament_id`;
- notifications by `user_id, created_at desc`;
- team memberships by `user_id, left_at`;
- history queries by participant and finish time.

## 13. Testability requirements

- Clock передаётся зависимостью, а не вызывается напрямую в domain logic.
- Random source для посева/аватаров/паролей инъецируется.
- State transitions реализуются pure functions/application services.
- Каждый invariant имеет unit test.
- Репозитории имеют integration contract tests с реальной PostgreSQL.

## 14. Schema evolution

- Schema меняется только упорядоченными forward-only SQL migrations; применённые
  migration files immutable и идентифицируются ledger timestamp/checksum.
- Fresh database и upgrade с последней поддерживаемой historical schema должны
  приводить к одному Drizzle-compatible shape без потери существующих rows.
- Persistent API startup не выполняет `CREATE`, `ALTER`, `DROP`, backfill или
  migration. До любых application writes он read-only подтверждает точное
  соответствие migration ledger текущему artifact и fail-closed при drift.
- Migration запускается отдельным явным operational step до нового application
  artifact. Ошибка миграции откатывает transaction; после успешно применённой
  backward-compatible schema rollback делается application artifact-ом, а schema
  исправляется новым forward migration.
- Один набор migrations проверяется на disposable PGlite и ephemeral PostgreSQL;
  test harness никогда не использует production `DATABASE_URL` и требует
  loopback/test-name/reset-consent guards для destructive reset test schema.

## D40 — `match_launch_requests`

Durable receipt: actor_user_id/request_id unique pair, originating_auth_session_id,
normalized request_fingerprint, match_id, initial_server_participant_id, canonical
slot_map и created_at. Все идентификаторы opaque без FK к удаляемым match/participant/
auth session: eligible purge не блокируется и не уничтожает replay tombstone.
Нет секрета или постоянно сохраняемого незавершённого draft. Migration0008 additive;
0007 и прежние historical results не переписываются.

## D40 — факты матча и плановая дата (кандидат миграций 0009–0010)

`matches.initial_server_participant_id` — nullable неизменяемый первый подающий;
legacy backfill разрешён только из точного immutable launch receipt без игровых
событий и при совпадении текущего подающего. Остальные legacy факты неизвестны.
`playing_elapsed_ms` и `playing_segment_started_at` хранят накопленное игровое
время и текущий сегмент: ожидание подтверждения не учитывается. Возобновление
после Undo/коррекции создаёт новый сегмент; finish/stop/no-show фиксируют время.
`judge_history_complete` различает полную новую историю и legacy partial;
`judge_sessions.activated_at` заполняется при реальном приобретении/принятии,
не при резервировании. События счёта/Undo/коррекции получают occurredAt,
actorUserId и judgeSessionId; старые события без них не реконструируются.

`tournaments.planned_date` — nullable PostgreSQL DATE. Миграция 0010 только
добавляет поле; прежние строки остаются NULL. Часовой пояс и планировщик отсутствуют.
