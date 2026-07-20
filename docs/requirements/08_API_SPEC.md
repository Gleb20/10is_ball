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

Create response включает `temporaryPassword` только один раз.

Errors:
- `ADMIN_REQUIRED`
- `EMAIL_ALREADY_EXISTS`
- `LAST_ADMIN_CANNOT_BE_DEMOTED_OR_BLOCKED`
- `USER_ALREADY_BLOCKED`

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

- `POST /matches`
- `GET /matches/{matchId}`
- `PATCH /matches/{matchId}` — только до старта
- `POST /matches/{matchId}/invitations`
- `POST /match-invitations/{id}/accept`
- `POST /match-invitations/{id}/decline`
- `POST /matches/{matchId}/start`
- `POST /matches/{matchId}/stop`
- `POST /matches/{matchId}/no-show`
- `POST /matches/{matchId}/confirm-result`
- `POST /matches/{matchId}/revert-finish`

Create supports:
- title;
- format;
- rules;
- registered and guest participants;
- optional judge invite;
- source `manual|challenge|revenge|tutorial`.

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

- `POST /tournaments`
- `GET /tournaments/{tournamentId}`
- `PATCH /tournaments/{tournamentId}` — до старта
- `POST /tournaments/{tournamentId}/participants`
- `DELETE /tournaments/{tournamentId}/participants/{participantId}`
- `POST /tournaments/{tournamentId}/invitations`
- `POST /tournament-invitations/{id}/accept`
- `POST /tournament-invitations/{id}/decline`
- `POST /tournaments/{tournamentId}/generate-bracket`
- `PATCH /tournaments/{tournamentId}/bracket`
- `POST /tournaments/{tournamentId}/dissolve-bracket`
- `POST /tournaments/{tournamentId}/start`
- `POST /tournaments/{tournamentId}/withdraw`
- `POST /tournaments/{tournamentId}/stop`

Errors:
- `INSUFFICIENT_PLAYERS`
- `TOO_MANY_PLAYERS`
- `BRACKET_NOT_EDITABLE`
- `BRACKET_REGEN_REQUIRED`
- `TOURNAMENT_ALREADY_STARTED`
- `PLAYER_ALREADY_IN_ACTIVE_MATCH`

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
- judge mutations — active judge session.
- tournament bracket — organizer before start.
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
