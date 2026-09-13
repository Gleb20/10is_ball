# REST API Spec — Tab-10 MVP

## 1. Общие правила

- Prefix: `/api/v1`.
- JSON UTF-8.
- Auth: opaque server session in secure cookie.
- CSRF token для мутаций.
- Ошибка: `{ "code": "...", "message": "...", "details": {...}, "requestId": "..." }`.
- Пагинация: cursor preferred.
- Все времена ISO-8601 UTC.
- Критичные мутации принимают `Idempotency-Key`.
- Ресурсные конфликты используют `expectedVersion`.

## 2. Auth

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /auth/password/first-change`
- `POST /auth/password/change`
- `GET /auth/sessions`
- `DELETE /auth/sessions/{sessionId}`

Сессия пользователя с `mustChangePassword=true` ограничена ровно тремя
зарегистрированными парами method+path: `GET /api/v1/auth/me`,
`POST /api/v1/auth/logout` и `POST /api/v1/auth/password/first-change`. Любая
другая защищённая операция, дошедшая до auth gate, возвращает
`403 PASSWORD_CHANGE_REQUIRED`. Независимая protocol-проверка может отклонить
невалидный запрос раньше, например mutation без корректного CSRF получает
`CSRF_INVALID`. Auth gate использует сопоставленный router path и HTTP method:
query string не расширяет allowlist, а эквивалентное percent-encoding
разрешённого static path сохраняет идентичность того же маршрута.

`POST /auth/login`:
```json
{"email":"user@example.com","password":"..."}
```
Response:
```json
{"user":{"id":"...","role":"user","mustChangePassword":false}}
```

Errors:
- `INVALID_CREDENTIALS`
- `ACCOUNT_BLOCKED`
- `PASSWORD_CHANGE_REQUIRED`
- `RATE_LIMITED`

## 3. Tennis admin

- `GET /admin/users?q=&status=&cursor=`
- `POST /admin/users`
- `GET /admin/users/{userId}`
- `PATCH /admin/users/{userId}`
- `POST /admin/users/{userId}/block`
- `POST /admin/users/{userId}/unblock`
- `POST /admin/users/{userId}/reset-password`
- `POST /admin/matches/{matchId}/force-close` — admin-only alias для soft cancel
  active **standalone** match → `cancelled` (D23)
- `DELETE /admin/matches/{matchId}` — admin-only hard purge только
  **non-finished** standalone record; finished/stopped/voided result запрещён
  (D15, superseded scope D19/D23/D24)

Hard delete finished match не является частью целевого API. Ошибочный finished
result проходит общий void flow ниже (D19/D24). И force-close, и допустимый
non-finished purge требуют явного подтверждения в клиенте до отправки запроса;
сервер не считает этот dialog authorization boundary.

Create response включает `temporaryPassword` только один раз.

Force-close body; `reasonText` optional:
```json
{"expectedVersion":7,"reasonText":"ops cleanup"}
```

Errors:
- `ADMIN_REQUIRED`
- `EMAIL_ALREADY_EXISTS`
- `LAST_ADMIN_CANNOT_BE_DEMOTED_OR_BLOCKED`
- `USER_ALREADY_BLOCKED`
- `TOURNAMENT_MATCH_FORBIDDEN` — `kind !== standalone`
- `MATCH_NOT_ACTIVE` — force-close when already finished/stopped/cancelled
- `MATCH_IMMUTABLE` — hard purge для finished/stopped/voided результата
- `NOT_FOUND`

## 4. Home / profile

- `GET /home`
- `GET /users/directory?q=` — список активных пользователей для выбора соперника/участника (id, имя; без email)
- `GET /profile/me`
- `PATCH /profile/me`
- `POST /profile/me/avatar/regenerate`
- `POST /profile/me/avatar/upload`
- `GET /players/{userId}`
- `POST /profile/onboarding/restart`

`GET /home` возвращает hero stats, active summaries, last five, ranking top, rival summaries, notification indicator, `myStats`.

Успешный ответ `PATCH /profile/me` строится по явному allowlist и содержит только
поля собственного профиля: `id`, `email`, `role`, `status`, `firstName`,
`lastName`, `birthDate`, `organizationText`, `positionText`,
`mustChangePassword`, `avatarKey`. Password hash, timestamps блокировки/входа,
storage paths и другие внутренние auth persistence-поля запрещены. Текущий
runtime alias `/api/v1/me/profile` остаётся contract drift в OPS-001 и этим
исправлением не переименовывается.

## 5. Rankings / history

- `GET /rankings?scope=all_time|calendar_week|calendar_month&teamId=`
- `GET /history?role=&result=&eventType=&from=&to=&q=&cursor=`

## 6. Teams

- `POST /teams`
- `GET /teams`
- `GET /teams/{teamId}`
- `PATCH /teams/{teamId}`
- `POST /teams/{teamId}/invitations`
- `POST /team-invitations/{invitationId}/accept`
- `POST /team-invitations/{invitationId}/decline`
- `POST /teams/{teamId}/leave`
- `DELETE /teams/{teamId}/members/{userId}`
- `POST /teams/{teamId}/captain-transfer`

Team metadata contracts: create requires trimmed `name` (1–200 characters),
optional `slogan` (≤300) and `welcomeText` (≤2000). PATCH accepts a nonempty subset
of those fields; extra keys are rejected. Empty optional strings clear the text.
UUID path/body identifiers are validated. Compatibility aliases `/teams/{id}/invite`
and `/team-invitations/{id}/respond` remain supported with identical authority.
Accept/decline responses include `{status, teamId}` for the welcome destination.
Detail is available to current/former members and the addressed pending invitee;
invitation metadata is captain-only. Mutations require an active team and the
specified captain/member. Captain cannot leave or remove self before transfer.
Archive is an automatic transition when no active members remain, not a destructive
team deletion; historical membership and event rows are retained.

## 7. Notifications

- `GET /notifications?cursor=`
- `POST /notifications/{notificationId}/read`
- `POST /notifications/read-visible`

Actionable действия вызывают endpoint исходной сущности, а не универсальную произвольную команду notification.

## 8. Matches

- `GET /matches`
- `POST /matches`
- `GET /matches/{matchId}`
- `PATCH /matches/{matchId}` — organizer-only waiting standalone; strict nonempty partial settings/full optional roster. Unchanged participant ID + user + side retains consent; source/judgeUserId immutable here
- `POST /matches/{matchId}/invitations` — strict `{userId, kind: player|judge}`; idempotent reuse of pending/accepted consent
- `POST /match-invitations/{id}/accept`
- `POST /match-invitations/{id}/decline`
- `POST /matches/{matchId}/start` — только `created_by_user_id`; иной active
  actor, включая participant/current judge/admin, получает `403 FORBIDDEN`
- `POST /matches/{matchId}/stop`
- `POST /matches/{matchId}/cancel` — cancel active **standalone** match; только
  active admin или `created_by_user_id`, причина опциональна; strict body
  `{expectedVersion, reasonText?}` и UUID `Idempotency-Key` обязательны (D23)
- `POST /matches/{matchId}/void` — сохранить finished result как voided,
  компенсировать stats и согласовать dependents; только active admin или
  `created_by_user_id`, strict `{expectedVersion, reasonText?}` и UUID
  `Idempotency-Key`; reason optional, second approval отсутствует (D24/D33).
  Для tournament match меняются только target status/version, его stats и audit;
  bracket JSON/version, downstream rows/results/stats и notifications сохраняются
- `POST /matches/{matchId}/no-show`
- `POST /matches/{matchId}/confirm-result`
- `POST /matches/{matchId}/revert-finish`

`confirm-finish` и terminal `stop` выполняют match CAS, one-time SQL statistics,
judge release и tournament advancement в одной transaction. Успешный повтор
`confirm-finish` из того же judge/auth session возвращает уже finished match без
повторной статистики, materialization или notification. Конкурентные результаты
одного турнира сериализуются row lock и сохраняют bracket version CAS.

Create supports:
- title;
- format;
- rules;
- registered and guest participants;
- optional judge invite;
- source `manual|challenge|revenge|tutorial`.

`GET /matches` и `GET /matches/{matchId}` применяют D17 к authenticated active
actor. `waiting|in_progress|pending_confirmation` доступны только
`created_by_user_id`, зарегистрированному participant или current active judge с
неосвобождённой и неистёкшей judge session. `finished|stopped|cancelled|voided`
доступны любому active club user. Tutorial не входит в shared list/home/history,
а detail доступен только его organizer/participant/current active judge. Existing,
но недоступный actor event возвращает `403 FORBIDDEN`; отсутствующий id —
`404 NOT_FOUND`.

`POST /matches` принимает только object по runtime schema: непустое название,
`format=1v1|2v2`, положительные целые `pointsToWin`/`mercyPoints` и структурно
валидных registered/guest participants. Service дополнительно проверяет точное
число игроков на каждой стороне, distinct active users и участие creator в
standalone. Ошибка или отказ при записи любого participant откатывает весь create.
Те же runtime gates проверяют side/version в point/undo, first server/setup и
winner/reason в stop; validation error не меняет score, event log или version.

Cancel body; `reasonText` optional:
```json
{"expectedVersion":7,"reasonText":"created by mistake"}
```

Void body; `reasonText` optional:
```json
{"expectedVersion":12,"reasonText":"wrong winner confirmed"}
```

Оба endpoint требуют `Idempotency-Key: <uuid>`. Повтор того же actor + match +
key возвращает тот же authoritative outcome и не создаёт второй audit или
compensation; новый key со stale `expectedVersion` получает version conflict без
side effects.

Cancel / stop errors (also via admin force-close):
- `TOURNAMENT_MATCH_FORBIDDEN`
- `MATCH_NOT_ACTIVE`
- `FORBIDDEN`
- `MATCH_IMMUTABLE` (stop on finished)

Void errors:
- `MATCH_NOT_VOIDABLE` — source is not finished/stopped
- `FORBIDDEN` — actor is neither creator nor active admin
- `VERSION_CONFLICT` — stale `expectedVersion`

Client cancel/void UI требует отдельного явного confirmation action перед
request; actor/state/version/idempotency сервер проверяет независимо. Void обязан
быть идемпотентным и сохранять immutable actor/timestamp/prior result/version,
опциональную reason и ссылки на compensation audit. Для tournament match UI явно
сообщает, что остальная сетка и downstream history останутся без изменений.
Hard-delete route для
finished/stopped/voided результата запрещён. Unauthorized/stale request не меняет
match, audit, stats или dependent tournament state.

## 9. Judge

- `POST /matches/{matchId}/judge/acquire` — конфликт с активной judge session того же пользователя на другом устройстве: `409 JUDGE_OTHER_DEVICE`; первая сессия сохраняется.
- `POST /matches/{matchId}/judge/heartbeat`
- `POST /matches/{matchId}/judge/release`
- `POST /matches/{matchId}/judge/handover`
- `POST /matches/{matchId}/points`
- `POST /matches/{matchId}/undo`
- `POST /matches/{matchId}/manual-correction`

Point request:
```json
{
  "side": "A",
  "expectedVersion": 17
}
```
Headers:
`Idempotency-Key: <uuid>`

Point response returns full authoritative match state.

Errors:
- `JUDGE_SLOT_OCCUPIED`
- `JUDGE_SESSION_REQUIRED`
- `JUDGE_DEVICE_MISMATCH`
- `MATCH_VERSION_CONFLICT`
- `MATCH_NOT_IN_PROGRESS`
- `DUPLICATE_IDEMPOTENCY_KEY`

## 10. Tournaments

- `GET /tournaments`
- `POST /tournaments`
- `GET /tournaments/{tournamentId}`
- `PATCH /tournaments/{tournamentId}` — до старта
- `POST /tournaments/{tournamentId}/participants` — organizer-only direct roster mutation
- `DELETE /tournaments/{tournamentId}/participants/{participantId}` —
  organizer-only; `participantId` обязан принадлежать route tournament, иначе
  `404 NOT_FOUND` без изменения обеих сущностей
- `POST /tournaments/{tournamentId}/invitations`
- `POST /tournament-invitations/{id}/accept`
- `POST /tournament-invitations/{id}/decline`
- `POST /tournaments/{tournamentId}/generate-bracket` — organizer-only
- `PATCH /tournaments/{tournamentId}/bracket`
- `POST /tournaments/{tournamentId}/dissolve-bracket`
- `POST /tournaments/{tournamentId}/start`
- `POST /tournaments/{tournamentId}/withdraw`
- `POST /tournaments/{tournamentId}/stop`

Tournament invitation contract аналогичен team flow: organizer-only invite,
один pending invite и один active registered participant на пару, actor-scoped
response и stable terminal retry. Invite/respond/direct roster add/bracket close
сериализуются по tournament row; notification и invitation/participant state
коммитятся вместе.

`POST /tournaments/{tournamentId}/start` до materialization проверяет весь
игровой roster, включая organizer/participant с bye. Любой зарегистрированный
игрок в active standalone match получает HTTP 400
`PLAYER_ALREADY_IN_ACTIVE_MATCH`; tournament status, `started_at`, bracket
JSON/version, matches и notifications остаются без изменений.

`GET /tournaments` и `GET /tournaments/{tournamentId}` используют тот же D17
read scope. `collecting|bracket_generated|needs_regeneration|in_progress` видят
organizer, active tournament participant и current active judge любого дочернего
match с неосвобождённой и неистёкшей judge session. `finished|stopped|cancelled`
видит любой active club user. Existing hidden active tournament возвращает
`403 FORBIDDEN`, неизвестный id — `404 NOT_FOUND`.

Errors:
- `INSUFFICIENT_PLAYERS`
- `TOO_MANY_PLAYERS`
- `BRACKET_NOT_EDITABLE`
- `BRACKET_REGEN_REQUIRED`
- `TOURNAMENT_ALREADY_STARTED`
- `PLAYER_ALREADY_IN_ACTIVE_MATCH`
- `UNSUPPORTED_BRACKET_VERSION` — HTTP 400 для legacy V1 double-elimination на
  `POST /bracket`, `PATCH /bracket`, `POST /start` и
  `POST /dissolve-bracket`; ответ формируется до обхода slot graph, не меняет
  tournament/bracket/match/notification state и не запускает implicit
  reset/migration (D25)
- `FORBIDDEN` — actor не является organizer route tournament
- `NOT_FOUND` — route tournament или связанный с route participant не найден

## 11. FAQ / feedback

- `GET /faq/categories`
- `GET /faq/articles?category=`
- `POST /feedback`

## 12. Polling

- active summary endpoints support ETag / `updatedSince` where practical;
- refetch on screen entry;
- interval 30 sec only while tab visible;
- manual refresh always available;
- no polling on background/hidden page.

## 13. Authorization matrix

- `admin/*` — only admin.
- match update before start — organizer.
- standalone cancel — active admin or match creator; participant/current judge
  без одной из этих ролей недостаточен.
- finished/stopped standalone или tournament match void — active admin or match
  creator; no second approver; tournament downstream state preserved by D33.
- judge mutations — active judge session.
- tournament direct roster mutation and bracket generation/edit — organizer of
  the route tournament before start; invitation response and self-withdraw use
  their own contextual actor rules.
- team edit/invite/remove — captain.
- view active event — participant/judge/organizer.
- view completed event — any active user.

## 14. Contract testing

Для каждого endpoint обязательно:
- happy path;
- unauthenticated;
- forbidden;
- validation error;
- invalid state transition;
- concurrency/idempotency where relevant;
- response schema snapshot or typed contract.

## Wave B contract clarifications

- PROFILE canonical GET/PATCH `/profile/me`, GET `/players/:userId` use one nested
  `{profile}` DTO, with own-only email/birthDate; avatar is read-only under D10.
  PATCH accepts exactly five local profile fields, validates real calendar dates,
  and returns the existing safe `{user}`. Legacy `/me/profile` remains compatible.
- Session revoke is other-own only: current session409, absent/foreign404,
  malformed UUID400, no mutation on rejection.
- History query: role player/judge, result win/loss, eventType match/tournament,
  ISO instants from/to, q up to100chars, opaque cursor, limit1..50(default20).
  Day controls use Moscow boundaries. Items include type/id/title/status/occurredAt/
  roles/result/matchKind/scoreA/scoreB/format; nextCursor null ends pagination.
  Finished tournament champion wins, other active participant loses; unknown
  champion, stopped/cancelled or nonparticipant have null result. Doubles opponent
  search excludes a participating actor's teammates.
- Rankings query canonical scopes all_time/calendar_week/calendar_month;
  compatibility week/month aliases supported. Response retains internal
  all_time/week/month scope plus team context, availableTeams and rankings.
  Team membership is enforced server-side; arbitrary query fields are rejected.

### GAP-006 tournament read summary and draft edits

`GET /tournaments/{id}` includes `tournament.summary`: `durationSeconds` (null before start),
`playedMatchCount`, `results[{participantId,points,playedMatches,place}]`, `top3` participant IDs,
and `matchParticipants[{matchId,participantIds}]`. Places derive from the stored bracket,
with equal elimination rounds sharing a place; game points do not break bracket ties.
`top3` lists occupants of places 1–3, including tied third-place participants in old
brackets without a bronze match; it does not truncate tied participants by points or ID.
Only finished tournaments expose places/top. Finished/stopped matches contribute actual
scores and played counts; voided matches do not, while their bracket placements remain (D33).
Settings PATCH is a nonempty strict object; title trims to 1–200 characters and game points
are positive integers. Format or organizer-roster changes invalidate an existing bracket.
V2 bracket PATCH `swaps` accepts explicit `seed:N` references (1-based seedOrder positions)
for either participant, including a bye recipient; existing match-node references remain
compatible. Unknown/out-of-range references fail validation. Seed/graph writes are atomic
and may only affect an unstarted generated bracket.

Tournament stop returns the complete detail DTO including participants, matches and summary.
It requires a nonblank reason code (max100); code `other` also requires trimmed nonempty
text (max500). Specific reason codes remain compatible. Missing/invalid reason requests fail
before any mutation; the stopped detail displays the persisted explanation.

### Wave E strict contract reconciliation

Match creation accepts optional UUID `judgeUserId`. A new standalone outsider player
invitation gates start with409 `PLAYER_CONSENT_REQUIRED`; judge consent does not gate.
Invitation accept/decline use strict empty bodies and return `{invitation}`; another
recipient sees404, elapsed TTL yields400 `INVITATION_EXPIRED` after persisted expiry.
`GET /admin/users` supports optional `q` (maximum100 chars), `status=active|blocked`.
Safe admin DTO adds birthDate, organizationText, positionText, createdAt, lastLoginAt.
Admin profile PATCH is strict and nonempty; email is immutable, nullable profile fields
can be cleared. Profile-only edit keeps sessions; role changes revoke them.
Feedback requires `kind=bug|idea|question|other` and trimmed nonempty message <=4000.
Material links remain message text; there is no attachment upload contract.
