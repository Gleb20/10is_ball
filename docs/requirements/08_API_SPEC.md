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

## D40 — атомарный запуск обычного матча

`POST /matches/launches` принимает обязательный UUID `Idempotency-Key`, совпадающий
с `requestId` тела. Строгая shared schema: optional title, format, pointsToWin,
mercyEnabled/mercyPoints, firstServerMethod и roster A1/B1 (+ A2/B2 только2v2).
Manual/rally требуют существующий `firstServerSlot`; random запрещает slot.
Default title вычисляется от фактического server startedAt; manual title сохранён.
Сервер фиксирует standalone/manual/no invitations и текущие actor/auth session.

Sorted actor/player locks → active actor/session row lock/recheck → receipt lookup
→ create/acquire/setup/start → immutable receipt, всё в одной транзакции.
Ответ `{ requestId, matchId }`; повтор actor/key/fingerprint возвращает исходный ID
без повторной случайности или передачи судейства. Другой fingerprint —409
`IDEMPOTENCY_KEY_REUSED`. `GET /matches/launches/{requestId}` actor-scoped/no-store:
`{ outcome: "unknown" }` либо `{ outcome: "committed", matchId }`; чужой/отсутствующий
ключ не различаются. Receipt не заменяет fresh GET/current auth judge ownership.
После eligible purge receipt остаётся, тот же запрос никогда не создаёт новый матч.

## BUG-022 — версия построения сетки

Organizer-only `GET /tournaments/{id}/bracket-generation-context` возвращает
`{ tournament }` с обязательной `bracketStateVersion`. Tournament lock предшествует
чтению и допустимому legacy organizer-healing; healing меняет version один раз.
`POST /tournaments/{id}/bracket-generations` принимает строго
`{ expectedVersion, constructionAlgorithm? }`; версия проверяется под тем же lock
до любых записей. Stale —409 `BRACKET_VERSION_CONFLICT`, ноль writes.
Старый `POST /tournaments/{id}/bracket` отклоняется409
`VERSIONED_BRACKET_GENERATION_REQUIRED`;403/404 сохраняются, legacy mutation нет.

Actual roster/format/participation/seed/generation/start/dissolve меняют fence;
metadata, pending invitation, повтор и no-effective swaps не меняют. D35 admin
add/rebuild остаётся одной отдельной атомарной операцией с одним version bump.
Unknown не запускает auto POST и GET не доказывает авторство изменения. После
успешного явного GET допустим explicit retry точно прежнего version/algorithm:
CAS даёт не более одной записи. Большая fresh version либо запрещающий lifecycle
закрывают возможность поздней старой записи и требуют нового явного подтверждения
для следующей операции. Failed GET сохраняет unknown.
Выпуск: strict API → подтверждённый old-fleet drain → versioned UI; unsafe legacy
API не является rollback.

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
- `GET /admin/users/{userId}/audit?cursor=`
- `PATCH /admin/users/{userId}`
- `POST /admin/users/{userId}/block`
- `POST /admin/users/{userId}/unblock`
- `POST /admin/users/{userId}/reset-password`
- `GET /admin/users/{userId}/reset-password/state`
- `GET /admin/users/{userId}/reset-password/requests/{requestId}`
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

Password reset POST требует UUID `Idempotency-Key`. Обычная попытка отправляет
`{"expectedLastAppliedRequestId":null|"uuid"}`. Подтверждённая replacement
попытка дополнительно отправляет другой `supersedesRequestId` и
`confirmReplacement:true`. Совпадение request id с другим fingerprint даёт
`409 IDEMPOTENCY_KEY_REUSED`; CAS conflict — `409 RESET_STATE_CHANGED` без
credential/session/issue/audit/notification writes. Первый успешный ответ может
содержать `temporaryPassword` и `secretAvailable:true`; exact replay и оба GET
всегда возвращают `secretAvailable:false`.

State GET возвращает только `targetUserId` и `lastAppliedRequestId`. Exact
receipt GET возвращает `unknown` либо terminal `applied|rejected_state_changed`,
`current` и `completedAt`; секрет не восстанавливается. Все три route admin-only,
`Cache-Control: no-store`. Старый POST без ключа или без полного body получает
400 до мутации.

Оба новых чтения admin-only. `GET /admin/users/{userId}` возвращает только
`AdminUser`: id, email, role, status, mustChangePassword, имя, фамилию,
avatarKey, birthDate, organizationText, positionText, createdAt и lastLoginAt.
Audit feed содержит до 20 записей в порядке `(createdAt DESC, id DESC)` и
`nextCursor`. Запись разрешает только id, createdAt, текущую подпись actor либо
null, действия `user.created|user.updated|user.role_changed|user.blocked|user.unblocked|user.password_reset|admin.bootstrap_provisioned`
и changedFields `firstName|lastName|birthDate|organizationText|positionText|role`.
Неизвестные действия исключаются; raw meta, значения до/после, пароли, токены,
сессии, source и outcome не выдаются. Cursor непрозрачен, привязан к target id и
сравнивается с исходным PostgreSQL timestamp строки, сохраняя микросекунды.
Ошибки: 400 malformed/cross-target cursor, 401, 403, 404 и 500.

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

`GET /home?period=all_time|month&recentRole=all|player` возвращает hero stats,
совместимые `activeEvents`, `currentTasks`, последние пять завершённых событий,
ranking top, rival summaries, notification indicator и `myStats`. Без
`recentRole` действует `all`. Фильтр `player` применяется по участию игроком
**до** ограничения пятью строками; одна роль судьи не включает событие.
`currentTasks` содержит все видимые actor-scoped незавершённые собственные
матчи и турниры с фактическими `currentRoles` (player/current judge/organizer),
упорядоченные по срочности, затем `updatedAt` и стабильному ID. Историческая
judge session не даёт текущую роль. Активное `judgeName` берётся из
`activeJudge`; terminal события сохраняют историческую подпись судьи.
`myStats` вычисляется по полному набору собственных матчей, независимо от
количества более новых чужих событий. Ответ не подтверждает владение judge
lock конкретной auth session и не расширяет права доступа.
Home match event сохраняет `winnerName` для совместимости и добавляет
необязательный `winnerSide: "A"|"B"|null` из серверного результата. Отсутствие
поля в старом ответе не позволяет клиенту выводить победителя по тексту имени.
Турнирные сводки получают имена гостей и зарегистрированных участников из
состава игр, а текущего судью — только из неосвобождённой, не зарезервированной
и неистёкшей сессии. Сводка не требует полного `getMatch` каждой игры сетки;
чужой активный турнир из admin каталога не становится личным `currentTasks`.
Для одного выбранного такого турнира legacy `activeEvents.tournament`
сохраняет прежнюю сводку результата, включая `topThree`, без загрузки деталей
каждой игры остальных турниров каталога.

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

Каждый `HistoryItem` обязательно содержит `sideA` и `sideB` типа
`string|null`: для матча это display snapshots обеих сторон, для турнира оба
значения `null`. Поиск применяется после проверки видимости и до `limit`,
сопоставляет tournament title и каждый participant snapshot обеих сторон;
`%`, `_` и `\\` экранируются как литералы. Новые поля не содержат id/email и не
требуют дополнительных detail-запросов.

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

При D37 `GET /notifications?notificationView=available` возвращает только записи,
доступные новому UI: исключены `match_invitation`, `judge_invitation`,
`tournament_invitation`. Ответ добавляет `notificationView=available`,
`unreadCount` и первые пять `unreadNotifications`; count и preview вычисляются
после отбора типов из того же owner-scoped набора. `GET /home` принимает тот же
opt-in параметр и использует тот же видимый count/preview. Без параметра оба
endpoint сохраняют прежние ответы для существующих клиентов. Новый web вызывает
`POST /notifications/read-visible?notificationView=available`: сервер отмечает
только переданные владельцем ID доступных типов. Без параметра этот POST
сохраняет прежнюю семантику и может прочитать переданное собственное игровое
приглашение; сам фильтр ничего не читает и не принимает. Текущий runtime отдаёт полный список без cursor; cursor
выше остаётся целевым контрактом будущей пагинации, где отбор типов должен
предшествовать странице.

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
- optional `sendPlayerInvitations=false`; player selection alone never invites;
- source `manual|challenge|revenge|tutorial`.

`created_by_user_id` is ownership, not mandatory roster membership. A valid start
does not wait for player/judge responses and atomically closes all pending match
invitations with `match_started` plus their visible notifications.

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
число игроков на каждой стороне и distinct active users. В manual standalone
creator может быть только оператором; в challenge/revenge creator обязан быть
participant. Ошибка или отказ при записи любого participant откатывает весь create.
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

`GET /matches/{matchId}` возвращает полное authoritative состояние, включая
неубывающую persisted `version` и полный, не усечённый массив `idempotencyKeys`
для доступного матча. Raw point UUID и prefixed mutation keys сохраняются без
проекции. Presence точного известного ключа доказывает применение соответствующей
mutation; absence не доказывает отказ, пока запрос может выполняться. Порядок
прихода HTTP responses не гарантирует монотонность, поэтому клиент не применяет
ответ с версией ниже уже показанной.

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

Manual correction request:
```json
{
  "scoreA": 4,
  "scoreB": 2,
  "currentServerParticipantId": "participant-uuid",
  "expectedVersion": 17
}
```
Headers: `Idempotency-Key: <raw uuid>`. Успешная коррекция сохраняет в
`idempotencyKeys` точное значение `manual-correction:<raw uuid>` и возвращает
полное authoritative match state. Point и correction `400 VALIDATION` и
`409 VERSION_CONFLICT` не выполняют mutation; transport/5xx не определяют исход.

Errors:
- `JUDGE_SLOT_OCCUPIED`
- `JUDGE_SESSION_REQUIRED`
- `JUDGE_DEVICE_MISMATCH`
- `MATCH_VERSION_CONFLICT`
- `MATCH_NOT_IN_PROGRESS`
- `DUPLICATE_IDEMPOTENCY_KEY`

## 10. Tournaments

- `GET /tournaments`
- `POST /tournaments` — accepts immutable-at-creation
  `requireParticipantConsent=false`
- `GET /tournaments/{tournamentId}`
- `PATCH /tournaments/{tournamentId}` — до старта
- `POST /tournaments/{tournamentId}/participants` — organizer or active admin
  registered-user add; guest remains organizer-only. Strict body contains exactly
  user or guest plus optional `confirmManualOverride` and
  `confirmBracketRegeneration`; optional UUID `Idempotency-Key`. Response is
  `{participant,tournament}`
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
коммитятся вместе. `requireParticipantConsent` нельзя PATCH. Required-consent add
и любой non-organizer admin add требуют `confirmManualOverride=true`. Добавление
при `bracket_generated` требует `confirmBracketRegeneration=true` и атомарно
перестраивает bracket с прежним seed prefix. Exact key replay возвращает прежний
participant; different fingerprint даёт `409 IDEMPOTENCY_KEY_REUSED` без записей.
После старта новый add отклоняется до любых side effects; exact replay успешного
prestart add возвращает только его сохранённый participant без новых записей.

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

Исключение D17 только для active global admin: list отдаёт `id/title/status`, detail
— tournament identity/policy и active roster, необходимые для scoped add. Invite
history, settings, bracket и остальные organizer capabilities не раскрываются.

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
- `MANUAL_OVERRIDE_CONFIRMATION_REQUIRED` — HTTP 409, confirmation отсутствует
- `BRACKET_REGEN_CONFIRMATION_REQUIRED` — HTTP 409, перестроение не подтверждено
- `IDEMPOTENCY_KEY_REUSED` — HTTP 409, ключ принадлежит другому fingerprint

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
- tournament registered-user add — organizer or active global admin with the
  required explicit confirmations; guest add, removal, invitation and bracket/
  lifecycle control remain organizer-only. Invitation response and self-withdraw
  use their own contextual actor rules.
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

## GAP-019 D40 — плановая дата турнира

`Tournament`, `CreateTournamentRequest`, `TournamentPatchRequest` содержат
необязательное nullable `plannedDate` формата `YYYY-MM-DD` (реальная календарная
дата, год 0001..9999). Это дата без времени и часового пояса. Create omission/null
сохраняет NULL; patch omission сохраняет прежнее значение, null очищает.
Неверная дата отклоняется 400 до записи. Изменять может только организатор до
старта; terminal/in_progress edit сохраняет прежний `TOURNAMENT_ALREADY_STARTED`
400. Изменение даты не меняет bracketStateVersion, состав и сетку. Дата не
ограничивает ручной старт и не создаёт запланированный запуск/уведомления.

## D40 — сохранённые гости и аватар команды

GAP-013/GAP-019 сохраняют разовые имена и добавляют явный `guestIdentityId`.
Participant input — ровно один из userId / guestIdentityId / пары
 guestFirstName+guestLastName. Payload не присылает собственный snapshot для UUID.
Повтор launch и добавления в турнир сравнивает исходный UUID, а не изменяемое имя.

| Метод и путь `/api/v1` | Контракт |
|---|---|
| GET `/guests` | `{ guests, nextCursor }`; q, limit=20 (max50), cursor связан с q; порядок lower(lastName), lower(firstName), UUID |
| POST `/guests` | `{requestId, firstName, lastName}`; заголовок Idempotency-Key совпадает с requestId; ответ `{guest}` |
| GET `/guests/requests/:requestId` | no-store; только receipt текущего actor; unknown либо committed с operation/guestId/resultingVersion |
| GET `/guests/:guestId` | `{guest}` активному пользователю; без раскрытия creator/auth credentials |
| PATCH `/guests/:guestId` | requestId, expectedVersion, firstName, lastName; создатель или active admin; ответ `{guest}` |
| GET `/guests/:guestId/history` | `{guest, items, nextCursor}`; 20 событий, cursor привязан к гостю; терминальные матчи кроме tutorial и терминальные турниры с активной строкой участия |

Guest: id, firstName, lastName, displayName, avatarKey, version, canRename,
createdAt, updatedAt. CAS conflict — 409 VERSION_CONFLICT; reuse ключа с другим
исходным payload — 409 IDEMPOTENCY_KEY_REUSED. Неизвестный исход мутации сначала
проверяется receipt GET; автоматического повторного POST/PATCH нет. Receipt
подтверждает операцию, но текущая карточка после чужого rename может быть новее.
История фильтруется по UUID, никогда по совпавшему имени; прежние подписи сохраняются.

GAP-025 добавляет nullable avatarKey в Team и create/update. При create отсутствие
равно null; PATCH отсутствие сохраняет прежнее значение, null очищает. Допускаются
только avatar_1..avatar_10. Изменение капитаном активной команды; TEAM_ARCHIVED —
409 без записей. Каталог изображений общий с D10, новые upload endpoints отсутствуют.
