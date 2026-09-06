# API as-built

Снимок регистрации Fastify routes в
[`../../apps/api/src/app.ts`](../../apps/api/src/app.ts) на **2026-09-06**.
Это inventory, а не обещание корректности или полноты. Все `/api/v1/*`, кроме
login/OpenAPI, требуют session; state-changing routes вне test требуют CSRF.

## System и auth (9)

| Method | Path |
|---|---|
| GET | `/health` |
| GET | `/api/v1/openapi.json` |
| POST | `/api/v1/auth/login` |
| POST | `/api/v1/auth/logout` |
| GET | `/api/v1/auth/me` |
| POST | `/api/v1/auth/password/first-change` |
| POST | `/api/v1/auth/password/change` |
| GET | `/api/v1/auth/sessions` |
| DELETE | `/api/v1/auth/sessions/:sessionId` |

## Admin и profile (9)

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

Admin match hard delete конфликтует с принятой void-only моделью (`DATA-005`).
Profile mutation теперь возвращает отдельный `OwnProfileUser` allowlist из 11
полей и не сериализует password hash, auth timestamps или storage paths
(`SEC-002`, local verification). Несовпадение target `/profile/me` и runtime
`/me/profile` остаётся contract drift вне этого исправления.

## Match, directory, ranking, home (18)

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
| POST | `/api/v1/matches/tutorial` |
| GET | `/api/v1/users/directory` |
| GET | `/api/v1/rankings` |
| GET | `/api/v1/home` |

Counting `GET, POST` as two route registrations gives 18. Point/undo require an
`Idempotency-Key`; most bodies are TypeScript casts rather than runtime schemas.

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

## Teams, notifications, help (8)

| Method | Path |
|---|---|
| GET, POST | `/api/v1/teams` |
| POST | `/api/v1/teams/:id/invite` |
| POST | `/api/v1/team-invitations/:id/respond` |
| GET | `/api/v1/notifications` |
| POST | `/api/v1/notifications/:id/read` |
| GET | `/api/v1/faq` |
| POST | `/api/v1/feedback` |

Итого: **60 registered operations / 54 unique paths**. Встроенный OpenAPI описывает
**15 operations / 12 paths** (25% operations). Машинный снимок:
[`../audit/evidence/route-openapi-inventory.json`](../audit/evidence/route-openapi-inventory.json).

## Contract drift

- Live OpenAPI 2026-09-06: version `0.1.0`, 12 paths.
- [`../requirements/08_API_SPEC.md`](../requirements/08_API_SPEC.md) — целевой,
  частично устаревший контракт.
- Shared types и runtime responses также расходятся (например, статус
  `cancelled` не везде отражён).

До закрытия `OPS-001` при изменении API обновляйте одновременно route inventory,
runtime validation, target spec и tests. Authorization defects: `SEC-003`,
`SEC-006`, `SEC-007`, `BUG-001`, `BUG-002` в [`../BACKLOG.md`](../BACKLOG.md).
