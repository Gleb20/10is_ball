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

## 7. Notifications

- `GET /notifications?cursor=`
- `POST /notifications/{notificationId}/read`
- `POST /notifications/read-visible`

Actionable действия вызывают endpoint исходной сущности, а не универсальную произвольную команду notification.

## 8. Matches

- `GET /matches`
- `POST /matches`
- `GET /matches/{matchId}`
- `PATCH /matches/{matchId}` — только до старта
- `POST /matches/{matchId}/invitations`
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

- `POST /matches/{matchId}/judge/acquire`
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
- `UNSUPPORTED_BRACKET_VERSION` — legacy V1 double-elimination не исполняется;
  ответ bounded и не запускает implicit reset/migration (D25)
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
