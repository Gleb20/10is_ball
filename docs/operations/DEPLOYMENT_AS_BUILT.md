# Deployment as-built

Состояние, наблюдавшееся во время baseline-аудита **2026-09-06**. Пошаговая
инструкция — в [`../DEPLOY.md`](../DEPLOY.md); этот документ фиксирует фактическую
схему и риски.

## Схема

```text
User browser
  └─ https://tab-10.vercel.app/          Vercel, Vite SPA
       ├─ static assets / SPA fallback
       └─ /api/* and /health rewrite
            └─ https://one0is-ball.onrender.com   Render Free, Fastify API
                 └─ DATABASE_URL                 Neon PostgreSQL
```

Vercel rewrite позволяет браузеру использовать один site origin: session/CSRF
cookies выставляются через `/api` на Vercel domain. Прямой cross-site API режим
поддерживается env-настройками, но не является текущей рекомендуемой схемой.

## Repo-controlled configuration

| Компонент | Источник | Baseline и текущий foundation state |
|---|---|---|
| Render | [`../../render.yaml`](../../render.yaml) | Optional Blueprint описывает новый service `tab10-api`; фактический live service называется `10is_ball`, поэтому YAML не считается доказательством его dashboard policy |
| Vercel | [`../../apps/web/vercel.json`](../../apps/web/vercel.json) | Vite build; `/api` и `/health` rewrite на Render; SPA fallback; `codex/audit-foundation` preview отключён branch-specific guard |
| API startup | [`../../apps/api/src/index.ts`](../../apps/api/src/index.ts) | DB connect, boot schema/migrate behavior, optional seed, listen |
| DB schema | [`../../apps/api/src/db/client.ts`](../../apps/api/src/db/client.ts) | `CREATE/ALTER IF NOT EXISTS` на boot вместо versioned migrations |
| Root runtime | [`../../package.json`](../../package.json) и `.node-version` | foundation переводит repo-controlled configs на Node 24; dashboard deploy ещё требует проверки |

Dashboard/plugin inspection 2026-09-06 подтвердил, что фактический Render service
`10is_ball` связан с `Gleb20/10is_ball`, branch `main`, и показывает deployed SHA
`1a98a5f7e516762bed12c3d9b20ceefc06a6be06`. PR Previews=`Off`; credential state
подтверждён отдельной SEC-001 execution ниже. Vercel deployed SHA и полная release
policy ещё остаются Q-OPS-002 в [`../OPEN_QUESTIONS.md`](../OPEN_QUESTIONS.md).

## SEC-001 credential rotation 2026-09-06

После явного action-time разрешения через подключённые Neon/Render plugins:

- пароль production-роли `neondb_owner` сброшен; Neon operations
  `6e83b8d4-15ed-41e1-8579-b2ede0a75394` и
  `b739306a-96ab-4e3b-a908-9325a6a76832` завершились `finished`;
- Render service `srv-d9f3odn41pts73fvpktg` merge-обновил только
  `DATABASE_URL` и `SEED_ADMIN=0`; env update автоматически запустил один deploy,
  дополнительный deploy не создавался;
- deploy `dep-daerpe8u01pc73fpfh80` вышел в `live` на `main`, SHA
  `1a98a5f7e516762bed12c3d9b20ceefc06a6be06`, 2026-09-06 22:20:26 MSK;
- endpoint имеет `pooler_enabled=false`, поэтому active service использует новый
  direct URI. Перевод compute на pooler — отдельное infrastructure change;
- 26 active admin auth sessions получили `revoked_at` и reason
  `credential_rotation`; после deploy active count = 0;
- post-deploy direct health = 200 за 0.356 s, Vercel-proxied health = 200 за
  0.533 s. Повторный Vercel inventory показал 0 deployments после начала
  операции; latest остался production `dpl_JDzAkaZ29XQi3zyiM9YysnXSFPgF` от
  2026-07-22. Vercel configuration и содержимое БД не менялись.

Independent negative query со старым URI не выполнен: connected Neon tool не
принимает arbitrary connection URI. Terminal control-plane reset подтверждает
ротацию, но SEC-001 остаётся `verified_prod`, пока этот отдельный acceptance step
не выполнен безопасным инструментом. Sanitized machine-readable evidence:
[`../audit/evidence/sec-001-production-rotation.json`](../audit/evidence/sec-001-production-rotation.json).

## Foundation branch после baseline

Foundation branch выровняла repo-controlled runtime на Node 24,
поставила `SEED_ADMIN=0` в Render blueprint и добавила fail-closed bootstrap:
`SEED_ADMIN=1` требует явные valid email/password; существующий active admin не
получает тихую ротацию пароля; конкурентный bootstrap атомарно различает
`created/existing`, а создание записывает durable audit с system actor. Production
API без `DATABASE_URL` теперь fail-closed, а startup/migration errors редактируют
connection strings. `apps/api/.env` загружается нативным Node loader только если
файл существует; hosting/CI env имеют приоритет.

PostgreSQL CI использует отдельный `TEST_DATABASE_URL`, разрешённый только при
`NODE_ENV=test`, пустом `DATABASE_URL`, loopback host, test-named DB и явном
`ALLOW_TEST_DATABASE_RESET=1`. `db:migrate` требует полный explicit PostgreSQL
target и больше не сообщает успех после disposable PGlite smoke. Local checks
выполнены на Node 24.20.0. GitHub run `34048623246` для commit `f925efc` green:
quality/PGlite и PostgreSQL 16 `3/3` прошли; evidence сохранён в
[`../audit/evidence/hosted-ci-foundation.json`](../audit/evidence/hosted-ci-foundation.json).
Production deploy foundation-кода не выполнялся (`SEC-004`, `TECH-004`).

До первого push foundation-ветки в `apps/web/vercel.json` добавлен
`git.deploymentEnabled=false` только для `codex/audit-foundation`. Это позволяет
открыть draft PR и выполнить GitHub CI без Vercel Preview этого snapshot. Guard
ещё не подтверждён фактическим push. Чтобы независимо исключить Render PR
Preview, draft PR получает `[skip preview]` в title; не в commit message. После
push Render dashboard сохранил branch `main`, PR Previews=`Off` и прежний live
SHA `1a98a5f`; GitHub Deployments для foundation SHA вернул 0 записей. Vercel
dashboard verification ожидает owner 2FA, поэтому его отсутствие не объявляется
полностью подтверждённым только по dashboard. Merge/deploy foundation-кода не
разрешён.

Локальный Docker PostgreSQL получает user/password/database из ignored root
`.env`, шаблон которого согласован с `apps/api/.env.example`; порт связан только
с `127.0.0.1`. Уже созданный volume сохраняет исходные credentials и не должен
удаляться ради смены config без отдельного backup/разрешения.

## Проверка доступности 2026-09-06

Read-only HTTP evidence сохранён в
[`../audit/evidence/production-http-baseline.json`](../audit/evidence/production-http-baseline.json).

- `https://tab-10.vercel.app/` → HTTP 200.
- `https://one0is-ball.onrender.com/health` → HTTP 200 после пробуждения.
- `https://tab-10.vercel.app/health` → HTTP 200 через rewrite.
- Hashes production HTML/JS/CSS совпали с локально собранными web artifacts;
  fingerprint подтверждает content match, но не заменяет commit SHA metadata.
- Первый прямой probe API превысил timeout 25 секунд; последующий запрос стал
  успешным приблизительно через 20 секунд.
- Live OpenAPI отвечал, но имел version `0.1.0` и только 12 paths.

HTTP 200 health доказывает доступность процесса, но не readiness DB: текущий
endpoint не делает DB probe. Полный login/match/tournament smoke и deployed commit
во время этого read-only audit не были подтверждены. Для authenticated production
проверки нужен ответ на Q-OPS-004; до него production используется только read-only.

## Cold-start convention

Для Render Free допускается до **60 секунд** только на пробуждение уснувшего API.
Web обязан показывать явное состояние «сервис просыпается/загрузка», иметь timeout
и Retry. После пробуждения обычные запросы оцениваются по NFR SLO; cold-start
исключение не должно маскировать медленный или сломанный warm API. См. ADR D21 и
`OPS-005`.

## Secrets и bootstrap

- Secrets должны существовать только в Neon/Render/Vercel secret stores или
  локальном ignored env.
- Blocking scan проверяет worktree, Git index (включая staged-only blobs) и все
  refs; `audit:secrets:local` отдельно включает ignored `.env*`, чтобы частный
  local config не делал обычный CI заведомо красным.
- В baseline был обнаружен ранее опубликованный live-looking DB credential.
  Значение намеренно не воспроизводится. 2026-09-06 пароль роли ротирован и Render
  обновлён; independent old-URI negative probe остаётся единственным residual
  verification step `SEC-001`.
- В baseline Render config включал production admin seed. Live service теперь
  подтверждённо имеет `SEED_ADMIN=0`; fail-closed/opt-in foundation-код всё ещё
  ожидает отдельного production deploy (`SEC-004`).

## Release и recovery gaps

- Нет repo evidence, связывающего одновременно deployed web/API с commit SHA и
  product version (`OPS-004`).
- Feature-branch guard должен быть подтверждён после push по отсутствию Vercel
  deployment; draft PR не должен merge-иться в рамках audit foundation.
- `/health` — liveness, structured logging/readiness не подтверждены (`OPS-002`).
- Ежедневный backup/restore и RPO/RTO не подтверждены; rehearsal script требует
  hardening (`OPS-003`, Q-OPS-003).
- Boot-time DDL создаёт риск drift и startup failure (`DATA-003`).

Перед любым production deploy использовать checklist в
[`../DEPLOY.md`](../DEPLOY.md) и регистрировать smoke evidence в
[`../CHANGELOG_DEV.md`](../CHANGELOG_DEV.md).
