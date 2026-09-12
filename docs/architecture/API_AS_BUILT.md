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

## Admin и profile (10)

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
| PATCH | `/api/v1/me/onboarding` |

Admin match hard delete ограничен non-terminal standalone rows; finished,
stopped и voided sporting results не удаляются (`DATA-005/007`).
Profile mutation теперь возвращает отдельный `OwnProfileUser` allowlist из 11
полей и не сериализует password hash, auth timestamps или storage paths
(`SEC-002`, local verification). Несовпадение target `/profile/me` и runtime
`/me/profile` остаётся contract drift вне этого исправления.

## Match, directory, ranking, home (19)

| Method | Path |
|---|---|
| GET, POST | `/api/v1/matches` |
| GET | `/api/v1/matches/:matchId` |
| POST | `/api/v1/matches/:matchId/start` |
| POST | `/api/v1/matches/:matchId/judge/acquire` |
| POST | `/api/v1/matches/:matchId/judge/heartbeat` |
| POST | `/api/v1/matches/:matchId/judge/release` |
| POST | `/api/v1/matches/:matchId/judge/setup` |
| POST | `/api/v1/matches/:matchId/points` |
| POST | `/api/v1/matches/:matchId/undo` |
| POST | `/api/v1/matches/:matchId/confirm-finish` |
| POST | `/api/v1/matches/:matchId/revert-finish` |
| POST | `/api/v1/matches/:matchId/stop` |
| POST | `/api/v1/matches/:matchId/cancel` |
| POST | `/api/v1/matches/:matchId/void` |
| POST | `/api/v1/matches/tutorial` |
| GET | `/api/v1/users/directory` |
| GET | `/api/v1/rankings` |
| GET | `/api/v1/home` |

Counting `GET, POST` as two route registrations gives 19. Point/undo and
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

Итого: **64 registered operations / 58 unique paths**. Встроенный OpenAPI описывает
**64 operations / 58 paths** (100%). Машинный снимок обновляет родитель интеграции:
[`../audit/evidence/route-openapi-inventory.json`](../audit/evidence/route-openapi-inventory.json).

## Contract drift

- Artifact OpenAPI берёт version из той же release metadata, что `/health` и
  `/ready`; production останется историческим `0.1.0`, пока PR1 не выпущен.
- [`../requirements/08_API_SPEC.md`](../requirements/08_API_SPEC.md) — целевой,
  частично устаревший контракт.
- Route/OpenAPI inventory 2026-09-13 совпадает 64/64 operations и 58/58 paths;
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
