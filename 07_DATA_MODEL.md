# Data Model v1 — Tab-10 MVP

## 1. Принципы

- UUID/ULID для публичных идентификаторов.
- UTC timestamps, отображение в локальной зоне клиента.
- Soft state (`status`, `archived_at`, `blocked_at`) вместо удаления значимых записей.
- Без `organization_id`: одна инсталляция = одна организация.
- Завершённые события неизменны.
- Зарегистрированный пользователь в истории рендерится по актуальному профилю.
- Гости — event-level записи.

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

## 3. Команды

### `team`
- `id`
- `name`
- `slug`
- `avatar_path` nullable
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

### `guest_participant`
- `id`
- `first_name`
- `last_name`
- `created_by_user_id`
- `created_at`

Не связывать разные записи одного человека.

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
- `status` enum `waiting|in_progress|pending_confirmation|finished|stopped|cancelled`
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

### `match_participant`
- `id`
- `match_id`
- `side` enum `A|B`
- `position_in_side` integer
- `participant_type` enum `user|guest|tutorial_actor`
- `user_id` nullable
- `guest_participant_id` nullable
- `display_name_snapshot` only for tutorial actor/optional guest convenience
- `created_at`

Check exactly one participant reference.

### `match_invitation`
- `id`
- `match_id`
- `invited_user_id`
- `invited_by_user_id`
- `kind` enum `player|judge`
- `status` enum `pending|accepted|declined|expired|cancelled`
- `expires_at`
- `responded_at` nullable
- `expiry_reason` nullable
- `created_at`

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

### `tournament_participant`
- `id`
- `tournament_id`
- `participant_type` enum `user|guest`
- `user_id` nullable
- `guest_participant_id` nullable
- `source` enum `organizer|invitation|team_auto_add|manual_guest`
- `status` enum `active|withdrawn|forfeited`
- `seed_rank` nullable
- `joined_at`
- `withdrawn_at` nullable

### `tournament_invitation`
- аналог match invitation, `kind=player|judge`, TTL 10 минут.

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
