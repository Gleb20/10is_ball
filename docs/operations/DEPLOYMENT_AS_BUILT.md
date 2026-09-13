# Deployment as-built

## Release 3.0.0 observed — 2026-09-13

Direct-main code commit165aecdaaa2eba6ffa5fd9d39926bca155016c95 was published by
native Git integrations: Render dep-daj5k0ijnfac73enlod0 live and Vercel
dpl_Hq3u1Do5RurMD1epjibpEkZjJNQU READY. GitHub CI34746947853 all4 jobs success;
`pnpm run smoke:public` confirmed3.0.0 and the exact commit on web/API/proxy.
[Redacted evidence](../audit/evidence/release-3.0.0-public.json). Startup remains
forward apply-only, with migration0005 included; no reset/manual migration or
independent public schema-ledger query was performed. Public testing was GET-only.
Later evidence commits change documentation only and retain3.0.0.


Исторический снимок репозитория и провайдеров на **2026-09-08**. Каноническая
штатная процедура — в [`../DELIVERY.md`](../DELIVERY.md); исторический ручной
runbook в [`../DEPLOY.md`](../DEPLOY.md) помечен superseded.

## OPS-004: текущее состояние

Delivery foundation и Neon catalog-default normalization слиты в `main` через
PR #4/#5. Дальнейшая работа по D32 выполняется прямыми тематическими commit/push
в `main` из чистого worktree.
Исходный dirty worktree не переключался: tracked diff, Git-visible untracked
files и SHA-256 manifest сохранены во внешнем закрытом recovery-каталоге.
`.agents/**` и `skills-lock.json` в publishable branch не переносятся.

Repository-controlled target уже включает exact Node/pnpm/PostgreSQL toolchain,
production-like `pnpm dev`, reduced-fidelity `dev:pglite`, обязательные
fast/PostgreSQL/compiled-browser lanes, immutable migration `0000` и одинаковый
`ReleaseMetadata` у API/web.

После уточнения назначения окружения принят D31, затем ускорен D32: текущие Vercel/Render/Neon —
один disposable public stand. Отдельный staging и GitHub provider orchestration
не входят в active path. Render настроен на native Git deploy каждого direct
push в `main`, Vercel — на production branch `main`; после deploy локальный
`pnpm smoke:public` только ждёт exact SHA на обоих origins. Public runtime и migrations временно
используют `neondb_owner`: pooled URL для runtime и производный direct URL для migrator. Старую Neon schema разрешено один раз пересоздать и
применить `0000` с нуля. Reset и оба merge выполнены; первый converged release,
переход startup на apply-only и seed-admin bootstrap подтверждены на SHA
`6892d6e6fe79425eadf76c39bf052500bde5055a`.

Локально на clean worktree выполнены frozen install, `doctor` и полный `pnpm ci`:
`820 passed, 0 failed, 0 skipped, 0 todo, 0 interrupted`; disposable PostgreSQL
containers/networks удалены. GitHub run `34195797553` green; Render deploy
`dep-dafr5egn74is73b9lt0g` вышел в `live`, Vercel deployment
`dpl_ER2ekejpxQbRN7MfTvP5VyAkPWax` — `READY`, а `pnpm smoke:public` прошёл с
первой попытки за 1626 ms. Neon содержит 17 public tables, одну exact ledger
record и одного active seed admin; реальный browser login успешен. `OPS-004`
имеет статус `verified_prod`. Redacted evidence:
[`../audit/evidence/ops-004-public-release.json`](../audit/evidence/ops-004-public-release.json).

### Production recovery evidence 2026-09-07

Перед baseline adoption сохранён обезличенный fingerprint: 17 public tables,
201 aggregate rows, catalog SHA-256
`4ca0e9024d0c054f5151f6f6ca82fd592d6ff7581e7417d267fea025cb4dd81a` и data
SHA-256 `d9fd5ae005fdfc040c2c35b8a00b4c1567a002baf9257c41067aa0edb4a78f50`.
Создан доступный manual Free snapshot.

Restore был запрошен как временное доказательство, но control plane получил
`finalize=true`: стабильный production endpoint сохранился, а identity primary
branch перешла на восстановленную ветку; прежняя primary ветка оставлена как
recovery copy. Это непреднамеренная инфраструктурная мутация, а не штатная схема
rehearsal. После переключения все 17 таблиц, 201 aggregate rows и оба fingerprint
совпали; direct и Vercel-proxied health ответили 200. Миграции и application-data
writes этой проверкой не выполнялись. Автоматический обратный restore запрещён,
поскольку active primary могла получить последующие пользовательские записи.
Redacted evidence: [`../audit/evidence/ops-004-pre-pr1-production-recovery.json`](../audit/evidence/ops-004-pre-pr1-production-recovery.json).

Manual snapshot и recovery branch не выдаются за полный backup. Для disposable
stand это accepted debt; полноценный backup/restore становится обязательным до
переноса ценных данных на VPS.

## Исторический production baseline 2026-09-06

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

До merge PR1 перечисленные gaps остаются историческим состоянием live-среды.
Любой следующий release должен идти только по fail-closed процедуре
[`../DELIVERY.md`](../DELIVERY.md), а smoke/recovery evidence регистрируется в
[`../CHANGELOG_DEV.md`](../CHANGELOG_DEV.md). Ручной runbook
[`../DEPLOY.md`](../DEPLOY.md) не является разрешённым fallback.

## Кандидат Wave A — 2026-09-13

Public web/API readiness по read-only metadata остаются на ecf7605 / 1.10.1 до публикации. Кандидат 1.11.0 сохраняет D32/native delivery и добавляет immutable 0002/0003. Local PostgreSQL16 gate40 passed; public migration не выполнялась. Миграция0002 fail-closed при дублях участника в турнирной сетке; read-only preflight выявил0 таких пар на текущем стенде.

OPS-002 readiness/logging интегрированы с release metadata и request IDs. OPS-003 local rehearsal создаёт только новую disposable restore DB, передаёт quoted identifier через psql stdin и не удаляет pre-existing target. Boundary tests7 passed; реальные backup/RPO/RTO публичного стенда этим не подтверждены.

## Wave B release / Wave C forward migration — 2026-09-13

This supersedes the Wave A candidate deployment snapshot above. Public main is
8f36941b283a678105558656b1fb3b343546d999 / 2.0.0; CI34728440590 all four jobs
passed and GET-only web/API/proxy smoke matched exactly. Wave C candidate 2.1.0
adds immutable migration 0004 for match-source/first-server metadata and exclusive
judge reservations. Read-only preflight of the configured Neon target found zero
duplicate unreleased judge users, zero unreleased sessions and four applied migrations.
The local PostgreSQL gate applies all five entries and verifies repeat/adoption,
rollback and concurrent migrators. Public 0004 applies only through native release;
no reset, seed fixture or mutating public E2E is part of this wave.

### Wave E candidate migration, not deployed

Forward migration0005 adds match invitation history (19 public tables, six ledger entries).
It does not backfill legacy matches. PGlite fresh/prefix checks passed; the fresh PostgreSQL
foundation passed9/9 and exposed old consent fixtures in subsequent concurrency tests,
which are being reconciled. Migration/deployment remains pending the release gate; this
entry is not evidence of production schema change. Preserve the same owner/runtime-role
separation and exact-SHA read-only public smoke required by the delivery checklist.
