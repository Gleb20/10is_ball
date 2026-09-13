# API as-built

Снимок регистрации Fastify routes в
[`../../apps/api/src/app.ts`](../../apps/api/src/app.ts) на **2026-09-13**.
Это inventory, а не обещание корректности или полноты. Все `/api/v1/*`, кроме
login/OpenAPI, требуют session; state-changing routes вне test требуют CSRF.

## System и auth (10)

| Method | Path |
|---|---|
| GET | `/health` |
| GET | `/ready` |
| GET | `/api/v1/openapi.json` |
| POST | `/api/v1/auth/login` |
| POST | `/api/v1/auth/logout` |
| GET | `/api/v1/auth/me` |
| POST | `/api/v1/auth/password/first-change` |
| POST | `/api/v1/auth/password/change` |
| GET | `/api/v1/auth/sessions` |
| DELETE | `/api/v1/auth/sessions/:sessionId` |

## Admin и profile (13)

| Method | Path |
|---|---|
| GET, POST | `/api/v1/admin/users` |
| PATCH | `/api/v1/admin/users/:userId` |
| POST | `/api/v1/admin/users/:userId/block` |
| POST | `/api/v1/admin/users/:userId/unblock` |
| POST | `/api/v1/admin/users/:userId/reset-password` |
| POST | `/api/v1/admin/matches/:matchId/force-close` |
| DELETE | `/api/v1/admin/matches/:matchId` |
| PATCH | `/api/v1/me/profile` |
| GET, PATCH | `/api/v1/profile/me` |
| GET | `/api/v1/players/:userId` |
| PATCH | `/api/v1/me/onboarding` |

Admin match hard delete ограничен non-terminal standalone rows; finished,
stopped и voided sporting results не удаляются (`DATA-005/007`).
Profile mutation теперь возвращает отдельный `OwnProfileUser` allowlist из 13
полей и не сериализует password hash, auth timestamps или storage paths
(`SEC-002`, local verification). Wave B добавляет канонический `/profile/me`; legacy `/me/profile` сохраняется для совместимости.

## Match, directory, ranking, history, home (20)

| Method | Path |
|---|---|
| GET, POST | `/api/v1/matches` |
| GET | `/api/v1/matches/create-options` |
| GET | `/api/v1/matches/:matchId` |
| POST | `/api/v1/matches/:matchId/start` |
| POST | `/api/v1/matches/:matchId/judge/acquire` |
| POST | `/api/v1/matches/:matchId/judge/heartbeat` |
| POST | `/api/v1/matches/:matchId/judge/release` |
| POST | `/api/v1/matches/:matchId/judge/handover` |
| POST | `/api/v1/matches/:matchId/judge/setup` |
| POST | `/api/v1/matches/:matchId/points` |
| POST | `/api/v1/matches/:matchId/undo` |
| POST | `/api/v1/matches/:matchId/manual-correction` |
| POST | `/api/v1/matches/:matchId/no-show` |
| POST | `/api/v1/matches/:matchId/confirm-finish` |
| POST | `/api/v1/matches/:matchId/revert-finish` |
| POST | `/api/v1/matches/:matchId/stop` |
| POST | `/api/v1/matches/:matchId/cancel` |
| POST | `/api/v1/matches/:matchId/void` |
| POST | `/api/v1/matches/tutorial` |
| GET | `/api/v1/users/directory` |
| GET | `/api/v1/rankings` |
| GET | `/api/v1/home` |
| GET | `/api/v1/history` |

Counting `GET, POST` as two route registrations gives 20. Point/undo and
cancel/void require an `Idempotency-Key`; core match payloads use shared Zod
runtime schemas. Temporary-password authorization compares exact method plus
matched router path.

## Tournament (16)

| Method | Path |
|---|---|
| GET, POST | `/api/v1/tournaments` |
| GET, PATCH | `/api/v1/tournaments/:id` |
| POST | `/api/v1/tournaments/:id/participants` |
| DELETE | `/api/v1/tournaments/:id/participants/:participantId` |
| POST | `/api/v1/tournaments/:id/invitations` |
| DELETE | `/api/v1/tournaments/:id/invitations/:invitationId` |
| POST | `/api/v1/tournament-invitations/:id/respond` |
| POST, PATCH | `/api/v1/tournaments/:id/bracket` |
| POST | `/api/v1/tournaments/:id/dissolve-bracket` |
| POST | `/api/v1/tournaments/:id/withdraw` |
| POST | `/api/v1/tournaments/:id/cancel` |
| POST | `/api/v1/tournaments/:id/start` |
| POST | `/api/v1/tournaments/:id/stop` |

## Teams, notifications, help (9)

| Method | Path |
|---|---|
| GET, POST | `/api/v1/teams` |
| POST | `/api/v1/teams/:id/invite` |
| POST | `/api/v1/team-invitations/:id/respond` |
| GET | `/api/v1/notifications` |
| POST | `/api/v1/notifications/:id/read` |
| POST | `/api/v1/notifications/read-visible` |
| GET | `/api/v1/faq` |
| POST | `/api/v1/feedback` |

Итого: **72 registered operations / 65 unique paths**. Встроенный OpenAPI описывает
**72 operations / 65 paths** (100%). Машинный снимок обновляет родитель интеграции:
[`../audit/evidence/route-openapi-inventory.json`](../audit/evidence/route-openapi-inventory.json).

## Contract drift

- Artifact OpenAPI берёт version из той же release metadata, что `/health` и
  `/ready`; public1.11.0 уже подтверждён exact-SHA smoke b193e9d.
- [`../requirements/08_API_SPEC.md`](../requirements/08_API_SPEC.md) — целевой,
  частично устаревший контракт.
- Route/OpenAPI inventory 2026-09-13 совпадает 72/72 operations и 65/65 paths;
  runtime schema/actor coverage по отдельным историческим routes остаётся
  самостоятельным acceptance вопросом.

## Wave A contracts

- `GET /api/v1/home?period=all_time|month` возвращает typed dashboard aggregate.
- `PATCH /api/v1/me/onboarding` принимает `set-step`, explicit `complete` или
  `restart` и возвращает безопасную user projection.
- `POST /api/v1/notifications/read-visible` атомарно отмечает переданные owner
  notification IDs и возвращает authoritative `readAt`.
- Tournament invite/respond/roster transitions сериализуются по tournament row;
  start проверяет весь roster, включая bye, до первой записи.

Match/tournament list/detail применяют actor-scoped active-event visibility;
terminal events club-visible active users. Start, direct roster/bracket,
stop/cancel and cross-tournament participant mutation checks выполняются на
server side. Void допускает terminal standalone/tournament result для active
admin или creator и следует D33 preservation policy.

## Release и readiness contract

`GET /health` проверяет liveness процесса, `GET /ready` выполняет DB probe и при
ошибке возвращает redacted `503`. Оба ответа включают одинаковый `release`:
`{ sha, version, environment, dirty }`. В staging/production принимается только
full 40-character SHA, `dirty=false` и root-package version. Web публикует ту же
структуру отдельно в `/release.json`; exact-SHA smoke сравнивает direct и proxy
ответы, а не только HTTP status.

## Wave B profile/history/ranking contracts (candidate)

Все routes ниже требуют активного пользователя. `GET /api/v1/profile/me` и
`GET /api/v1/players/:userId` возвращают единый `{profile}`: isOwn, canChallenge,
identity, avatar, stats, facts, teams. Только собственная identity содержит email
и birthDate; blocked историческая цель читается без challenge. UUID валидируется.
`PATCH /api/v1/profile/me` принимает только firstName/lastName/birthDate/
organizationText/positionText; невозможная дата и неизвестные поля дают400 без
записи. Legacy PATCH сохраняет прежний контракт. DELETE auth/sessions/:sessionId
отклоняет текущую сессию409; logout остаётся способом выхода.

`GET /api/v1/history` принимает role, result, eventType, from/to, q, cursor, limit
(1..50, default20). Ответ `{items,nextCursor}` объединяет доступные события,
исключает tutorial и сохраняет voided result-neutral. Сортировка occurredAt/type/id
descending, cursor даёт устойчивый порядок, но не transactional snapshot.
Finished tournament result вычисляется по сохранённому чемпиону; stopped/cancelled
без результата. PostgreSQL/PGlite различия raw results и ISO timestamp binding
обработаны в сервисе и покрыты отдельным обязательным PostgreSQL тестом.

`GET /api/v1/rankings` сохраняет rankings и добавляет scope/team/availableTeams.
Запрос принимает all_time/calendar_week/calendar_month и совместимые week/month;
response.scope остаётся all_time/week/month. teamId доступен только текущему
участнику активной команды; строки исключают left/blocked, командный winsAllTime
следует D3/Q2. Публичная карточка принадлежит ProfileService, второго flat DTO нет.

## Wave C match/judge contracts

`GET /api/v1/matches/create-options` returns `{ users, teams, recentOpponentIds,
frequentOpponentIds }`; team entries contain `id`, `name` and `userIds`. Match
creation accepts grouped 1v1/2v2 registered/guest roster, rules, `firstServerMethod`
and `source`. `manual`/`rally` start requires an explicit participant id;
`random` chooses under the runtime selector and rejects an incompatible manual id.

`POST /matches/{id}/judge/handover` accepts `{toUserId}` and returns
`{reservation}`. `manual-correction` and `no-show` require `Idempotency-Key` and
expected version; correction retains a technical baseline in the event log and
Undo does not erase it. Handover reservation and active judge exclusivity are
enforced in the service/DB boundary. Browser completion remains a separate gate.

### Wave C review: judge and start authority

Start is creator-owned and transactional, locking registered participants in
stable order before the busy-player check and waiting-state CAS. `startedAt`
is set at start; pre-start judge setup does not start the timer and later setup
cannot reset it. After any points, changing first server requires audited manual correction.
Handover preserves released historical rows and creates a separate reservation;
only its target may claim. Former judges lose active visibility and mutation rights.
New confirmations persist a hashed exact judge-row marker in `idempotencyKeys`;
terminal retry must match that row and auth session. Multiple historical rows for
one auth session are checked so release/reacquire still permits the true confirmer.
Legacy finished matches without a marker retain the historical user/auth fallback.
The UI may acquire a free slot after a contextual detail 403 on a writable judge
route (D7); read-only routes never acquire or weaken detail visibility.

### Wave D candidate: teams and tournament read/draft contracts

Teams expose strict create/read/update, captain-only invite/remove/transfer, and member leave.
Responses carry safe members, current actor flags, archive timestamps, and captain-only
invitation metadata; arbitrary outsiders cannot read details. Canonical invitation accept/
decline returns status + teamId for the welcome route; legacy respond/invite remain compatible.
Blocking and role changes serialize administrator checks and transactionally revoke sessions
and audit. The blocking hook performs captain succession/archive within that same transaction;
team create/invite/accept lock and revalidate the relevant user before locking the team.

Tournament read responses include the documented summary projection. Settings/seed edits
serialize against the tournament row; format/organizer roster changes invalidate a built
bracket. Explicit seed:N positions allow either member of a first-round pair and bye recipient
to be moved; invalid references fail validation. Full Wave D browser/aggregate acceptance is
pending; this records implementation, not a public release claim.

### Wave E candidate contract

OpenAPI and literal route inventory agree at84 operations /75 paths. Added organizer
prestart match PATCH, match invitation create and accept/decline; exact contracts are
in requirements08 and OpenAPI. Missing player consent returns409, expired invitation
400 after persisted expiry, recipient mismatch404. Match detail includes invitation
history; unchanged roster rows retain consent.
Admin listing supports q/status and safe profile/date fields; profile PATCH excludes
email and preserves sessions unless role changes. Feedback accepts four categories
and bounded text. Focused OpenAPI9/9 and runtime consent contract1/1 passed. Broader
Wave E browser/aggregate acceptance remains pending.

### Wave E consent review checkpoint

Waiting side changes retain accepted history, cancel obsolete pending invitations
with `side_changed`, mark those notifications read, and require current-side
consent. Reinvitation cancels legacy old-side pending history in the same
transaction before reusing or creating a current-side invitation; this avoids
the unique-pending conflict without deleting history. Start accepts only current
participant identity and side when consent history exists. Legacy matches with
no player-consent history remain start-compatible; changing team membership
does not strand participants whose prior consent requires renewal.

Create/respond revalidate active actors under user locks. A terminal response
persists cancellation and read state before returning MATCH_IMMUTABLE: active
play/pending confirmation maps to match_started, cancellation to match_cancelled,
and finished/stopped/voided to match_finished. Expired TTL takes precedence.
Focused worker evidence is42 PGlite/5 PostgreSQL cases; independent review
identified an unverified cross-match user/FK lock cycle in side swap versus
reinvite. Aggregate acceptance is paused for a deterministic concurrency probe.

The lock-cycle checkpoint above is superseded by focused Red/Green: three
cross-match PostgreSQL40P01 cases are repaired by locking creator with all
required users in one sorted group. This applies before waiting-side consent
renewal and before tournament-start materialization, including a nonplaying
organizer. Final consent PostgreSQL file passes8/8, related tournament PG2/2.
[Focused evidence](../audit/evidence/wave-e-consent-focused.json); full E
aggregate and final review remain separate gates.

### BUG-017 judge device conflict

A second auth session attempting judge acquire while the same user already
judges elsewhere receives409 JUDGE_OTHER_DEVICE and a Russian message to
release the other device's slot. The former500 mapping is fixed. Same-match
and cross-match route tests preserve the original judge/match rows, deny
second-session heartbeat and retain first-session heartbeat/release. Existing
OpenAPI409 ApiError already covers the response. Focused2/2 and four selected
judge regressions pass; full F integration remains pending.
