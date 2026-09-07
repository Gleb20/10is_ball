# Dev Changelog

Обратная хронология: новые подтверждённые изменения добавляются сверху; старые
записи сохраняются как история и могут быть помечены `superseded` новой записью.

## 2026-09-07 — OPS-004 public-stand simplification (in progress)

- По явному уточнению пользователя текущий public contour классифицирован как
  disposable испытательный стенд без ценных данных; production-grade D29/D30
  superseded для этого контура новым D31.
- Отдельный staging, rehearsal/recovery branches, writer pause и provider API
  orchestration удаляются из active release path. Render и Vercel используют
  native Git deploy каждого `main`, GitHub вручную выполняет только bounded
  read-only exact-SHA/version smoke после deploy.
- По отдельному разрешению disposable public API и migrator используют один
  существующий direct `neondb_owner` URL без копирования credential между
  провайдерами, а deploy не ждёт повторного CI merge SHA. Split-role и
  полный release gate остаются обязательными local/PR проверками; это accepted
  debt до VPS.
- Пользователь разрешил одноразово пересоздать `public` и `drizzle` текущей Neon
  БД вместо historical adoption. Следующие releases используют apply-only и не
  сбрасывают данные.
- Локальные гарантии не ослаблены: exact Node/pnpm/PostgreSQL/Playwright/Chromium,
  quality/PostgreSQL/compiled-browser lanes, ReleaseMetadata и zero-skip policy
  остаются обязательными. Vercel CLI удалён из local toolchain: web публикуется
  native Git deployment. Production-grade recovery/backup/staging возвращаются
  отдельным scope перед переносом ценных данных на оплачиваемый VPS.
- Verification: clean `pnpm ci` на Node `24.20.0`/pnpm `9.15.0`/PostgreSQL
  `16.15`/Playwright Chromium — `816 passed, 0 failed, 0 skipped, 0 todo,
  0 interrupted`; disposable containers/networks удалены. Hosted `Release gate`,
  merge пользователем, public reset/bootstrap и одинаковый SHA web/API ожидаются.
- Первый hosted run выявил clean-checkout drift: job-level `runner.temp` не
  валиден до старта runner, относительный evidence path уходил в cwd workspace-
  пакета, а API build не гарантировал готовые `shared`/`test-utils`. Workflow,
  path resolution и release build scripts исправлены; повторный gate ожидается.

## 2026-09-07 — OPS-004 delivery foundation (historical D29/D30 design)

### Scope

- D29/D30; `AT-OPS-DELIVERY-001..009`; только PR1 baseline migration
  `0000_data_003_baseline`. Product/story delta и migrations `0001–0003`
  зарезервированы для PR2; version/tag остаются `1.10.1`.
- Исходный dirty worktree не переключался. Его tracked/untracked SHA-256 recovery
  snapshot хранится вне repository; `.agents/**` и `skills-lock.json` не входят в
  publishable branch.

### Changed

- Закреплены Node `24.20.0`, pnpm `9.15.0`, PostgreSQL `16.15-alpine` по digest,
  Playwright `1.63.0`/lockfile Chromium и Vercel CLI `59.11.7`; единый lockfile и
  одинаковые install/build команды используются локально, в CI и provider build.
- `.mise.toml` добавляет безопасный repository-local pnpm dispatcher: bare
  `mise exec -- pnpm doctor` и `mise exec -- pnpm ci` больше не перехватываются
  встроенными командами pnpm, а остальные команды без изменений идут через
  Corepack `pnpm@9.15.0`.
- `pnpm dev` запускает PostgreSQL с раздельными migration/runtime roles;
  `pnpm dev:pglite` оставлен явным reduced-fidelity режимом. Оба local runner
  очищают inherited hosted/provider/Vite origin environment и принудительно
  используют loopback same-origin proxy. Добавлены строгие `doctor`,
  `verify:fast`, `verify:postgres`, `verify:e2e`, `verify:all` и `pnpm run ci`.
- Boot-time DDL заменяется immutable migration ledger. Runner выполняет exact
  17-table adoption profile, data-change manifest, URL/control-plane/role
  attestation, reserved-connection advisory lock и bounded timeouts; ручной stamp
  и down-migration отсутствуют.
- API `/health`/`/ready` и web `/release.json` публикуют единый ReleaseMetadata;
  staging/production fail closed на неверном SHA/version/environment/dirty state.
  Vite dev и compiled preview используют одинаковый same-origin proxy contract.
- Добавлены три required PR/main lane и первоначальный exact-SHA staging →
  production workflow с
  stale-main guard, Neon rehearsal/recovery, bounded writer pause, exact Render
  deploy, unaliased Vercel candidate/promotion и read-only production smoke.
  Provider tokens/URLs/credentials не должны попадать в logs или artifacts.
  Этот provider workflow superseded упрощённым D31 выше до публикации в `main`.
- Документационный drift по runtime, 17/18 tables, route inventory, migration
  rollback и release topology согласован; Q-OPS-002/Q-OPS-004 закрыты D29,
  Q-OPS-003 сохранён как P0 residual risk.

### Verified so far

- Fresh frozen install и `pnpm run doctor` прошли на Node `24.20.0`, pnpm
  `9.15.0`, Docker CLI `29.8.0`/server `29.5.2`, Compose `5.5.1`, Playwright
  `1.63.0`, Chromium `153.0.8010.12` и Vercel CLI `59.11.7`.
- Focused migration/release policy: 50/50 PGlite/URL/startup tests; 13/13 final
  PostgreSQL migration tests, включая fresh/adoption/drift/failure/race/no-op;
  compiled CLI fresh/no-op, API typecheck и diff check прошли.
- Отдельный staging Neon создан; runtime login проверен как non-superuser без
  createdb/createrole/replication/bypassrls и с runtime/default ACL.
- Перед PR1 сохранены aggregate production fingerprints и manual Free snapshot.
  Restore comparison подтвердил 17 tables, 201 aggregate rows, catalog/data
  digests и direct/proxied health 200. Redacted evidence:
  [`audit/evidence/ops-004-pre-pr1-production-recovery.json`](audit/evidence/ops-004-pre-pr1-production-recovery.json).

### Incident disclosure and remaining

- Restore rehearsal был ошибочно финализирован control plane: стабильный Neon
  endpoint сохранился, но primary branch identity сменилась; прежняя primary
  оставлена recovery copy. Fingerprints совпали, migration/application writes не
  выполнялись. Обратное переключение не делается автоматически, чтобы не потерять
  возможные последующие production writes.
- Итоговый `pnpm run verify:all`, hosted three-lane `release-gate`, Render/Vercel
  staging, native auto-deploy disable, GitHub Environments/main protection, новый
  PR и оба пользовательски подтверждённых release ещё не выполнены. OPS-004
  остаётся `in_progress`.

## 2026-09-06 — SEC-002 profile response allowlist

- Scope: SEC-002; PROFILE-001/003; NFR Security §4; AT-PROFILE-001. Полный
  profile/avatar/public-card flow и переименование runtime route исключены.
- Changed: `apps/api/src/modules/auth/auth-service.ts` возвращает типизированный
  `OwnProfileUser` вместо DB row; `apps/api/src/auth.integration.test.ts`
  закрепляет точный 11-field HTTP contract. Target/API as-built, acceptance,
  traceability, backlog, capability и status docs синхронизированы.
- Verified: focused test сначала упал на 19 полях, включая `passwordHash`, затем
  прошёл 1/1; полный `auth.integration.test.ts` — 9/9; API suite — 84 passed и 3
  real-PostgreSQL tests skipped; API typecheck passed. Grep review не нашёл второго
  raw-user-row HTTP serializer. Полный `pnpm run ci` на bundled Node 24.19.0
  прошёл: audit gates, lint, typecheck, 517 shared + 1 todo, 4 test-utils, 70 web,
  84 API + 3 real-PostgreSQL skipped, API/web builds.
- Remaining: production deploy/smoke не разрешён и не выполнялся; SEC-002 до него
  остаётся local-only fix. GAP-002 продолжает полный profile flow.

## 2026-09-06 — SEC-001 production credential rotation

### Scope
- Явно разрешённая production-операция: Neon role credential rotation, Render
  `DATABASE_URL` update, `SEED_ADMIN=0`, отзыв active admin sessions и один
  проверочный Render deploy. Database reset/delete и Vercel deploy исключены.

### Changed
- Neon password роли `neondb_owner` ротирован; control-plane operations
  `6e83b8d4-15ed-41e1-8579-b2ede0a75394` и
  `b739306a-96ab-4e3b-a908-9325a6a76832` завершены.
- Render service `10is_ball` merge-обновил только `DATABASE_URL` и
  `SEED_ADMIN=0`; automatic deploy `dep-daerpe8u01pc73fpfh80` вышел в `live` на
  прежнем `main` SHA `1a98a5f7e516762bed12c3d9b20ceefc06a6be06`.
- Одной SQL transaction отозвано 26 admin-сессий с reason
  `credential_rotation`; active admin sessions после deploy = 0.

### Verification
- Neon reset operations terminal `finished`; Render deploy terminal `live`.
- Sanitized startup logs содержат startup/listening/schema-ready signals без
  auth/fatal failures или connection-string output.
- Post-deploy direct `/health` = 200 за 0.356 s; Vercel proxy `/health` = 200 за
  0.533 s. Vercel не изменялся и не деплоился; БД не удалялась и не reset-илась.
- Повторный Vercel deployment inventory: 0 deployments после начала incident
  operation; latest остался `dpl_JDzAkaZ29XQi3zyiM9YysnXSFPgF` от 2026-07-22,
  `READY`, production, тот же SHA `1a98a5f`.
- Blocking secret scan: 253 worktree files, 1038 ref objects, 662 ref blobs,
  0 skipped inputs и 0 candidates.
- Endpoint имеет `pooler_enabled=false`, поэтому Render использует новый direct
  URI. Секреты не сохранены; evidence:
  [`audit/evidence/sec-001-production-rotation.json`](audit/evidence/sec-001-production-rotation.json).

### Remaining
- Independent authentication failure старого URI не проверен: Neon plugin не
  выполняет SQL по произвольному retained URI. Поэтому SEC-001=`verified_prod`,
  не `done`; operational threat mitigated control-plane reset-ом.

## 2026-09-06 — Foundation CI green на GitHub и Render preview guard подтверждён

### Scope
- `TECH-001`, `TECH-004`, `OPS-004`; commit
  `f925efc63596b4aac56cad09f12419f6306819df` в draft PR
  [`#3`](https://github.com/Gleb20/10is_ball/pull/3).

### Verified
- GitHub workflow
  [`34048623246`](https://github.com/Gleb20/10is_ball/actions/runs/34048623246)
  завершился `success`: `Quality and PGlite tests` и
  `PostgreSQL critical integration` зелёные.
- PostgreSQL 16 job: `3/3` passed — fresh schema/Date, `AT-MATCH-007/011`
  (`200 + 409`, последовательное завершение, одна победа в статистике) и
  `AT-TRN-010` (два finished semi-finals, waiting final + third place).
- Render dashboard после push по-прежнему связан с `main`, PR Previews=`Off`,
  last deployed SHA остался `1a98a5f`; GitHub Deployments для foundation SHA
  вернул 0 записей. Vercel dashboard напрямую ещё не проверен: ожидается owner
  2FA; branch-specific deployment guard остаётся repo-controlled evidence.
- Машиночитаемый снимок: [`audit/evidence/hosted-ci-foundation.json`](audit/evidence/hosted-ci-foundation.json).

### Remaining
- CI green не является production deploy verification. Foundation code не
  деплоился; Render/Neon credential rotation, session revocation и Vercel owner
  verification остаются в `SEC-001` и approval-bounded плане.

## 2026-09-06 — Коррекция first-run PostgreSQL CI characterization

### Scope
- `TECH-001`, `TECH-004`; draft PR
  [`#3`](https://github.com/Gleb20/10is_ball/pull/3), initial workflow run
  `34048088511`, PostgreSQL job `101526650172`.

### Changed
- `AT-MATCH-007/011` real-PostgreSQL smoke теперь сохраняет собственно race:
  два конкурентных score command с одной expected version дают `200 + 409`,
  после чего матч с допустимым target 3 доигрывается последовательными версиями
  и статистика победителя проверяется ровно один раз.
- `AT-TRN-010` учитывает целевой default single-elimination: после двух
  полуфиналов материализованы и финал, и матч за третье место (`4 total`,
  `2 finished`, `2 waiting`).

### Verification
- Initial hosted PostgreSQL 16 run выполнил fresh-schema/date smoke успешно, но
  выявил две ошибки ожиданий теста: `pointsToWin=1` не создавал допустимого
  finish state, а проверка сетки не учитывала матч за третье место. Это не было
  скрыто retry/skip.
- Exact Node 24.20.0: API typecheck passed; focused local file корректно guarded
  и показал `3 skipped`, потому что локальный PostgreSQL runtime отсутствует.
- Исправленный hosted PostgreSQL rerun на этом снимке ещё не выполнен; green до
  его завершения не заявляется.

## 2026-09-06 — SEC-001 execution plan и безопасный feature-branch push

### Changed
- Добавлен approval-bounded план
  `test-plans/SEC-001-credential-rotation.md`: Neon credential rotation, Render
  env update, отзыв active admin sessions и отрицательная проверка старого
  credential без записи secret values.
- В `apps/web/vercel.json` preview deployment отключён только для
  `codex/audit-foundation`; GitHub PR CI остаётся доступен, а foundation deploy и
  merge в `main` в scope не входят.
- Draft PR должен содержать `[skip preview]` в title, чтобы не создать Render
  PR Preview, который иначе может скопировать production environment.
- Deployment docs различают фактический Render service `10is_ball` и optional
  Blueprint service `tab10-api`, описывают branch guard и фактическую команду
  сборки shared + web.

### Verification
- External credential rotation, Render restart, session revocation и old-secret
  negative test ещё не выполнены и не заявляются как verified.
- Branch guard будет проверен после разрешённого push по отсутствию Vercel
  deployment. До push это только repo-controlled configuration.

## 2026-09-06 — Cancel/void, legacy V1 DE и полный PRD: решения D23–D26

### Scope
- Закрыты Q-MATCH-001, Q-MATCH-002, Q-DATA-001 и Q-PRODUCT-001 без изменения immutable
  baseline: cancel active standalone и void finished/stopped разрешены только
  active admin или creator; reason optional; для опасных действий обязателен
  отдельный UI confirmation.
- Finished/stopped result остаётся soft-invalidated: hard delete запрещён,
  исходные факты/audit сохраняются, stats/dependents компенсируются идемпотентно.
- Legacy V1 DE preservation/read/play/migration не требуется; input должен fail
  closed в bounded time. Production reset/recreate этим решением не разрешён.
- Полный PRD v2 остаётся functional target; gap не выпадает из scope без
  отдельного superseding ADR и синхронного изменения требований/acceptance.

### Changed
- ADR/open questions/status: `DECISIONS.md`, `OPEN_QUESTIONS.md`,
  `PROJECT_STATUS.md`, `CAPABILITY_MATRIX.md`.
- Target contracts: `requirements/04_PRD.md`, `05_UX_FLOWS.md`,
  `07_DATA_MODEL.md`, `08_API_SPEC.md`, `09_LOCAL_AUTH_AND_TENNIS_ADMIN.md`.
- Acceptance/traceability: `requirements/11_ACCEPTANCE_TEST_CATALOG.md`,
  `requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md`.
- Live backlog: `BACKLOG.md`; standalone DATA-005 и DATA-006 переведены в
  `ready`, tournament downstream policy выделена в DATA-007
  (`blocked_decision`), BUG-002 расширен текущим cancel authz drift.
- Code, immutable baseline и production не изменялись.

### Verification
- `node scripts/audit/check-docs.mjs`: 45 files, 0 broken links/anchors, 49
  unique complete findings, 0 duplicate/malformed IDs or invalid statuses.
- `git diff --check`: passed.

### Remaining
- D23–D26 описывают target, но не исправляют code: BUG-002, DATA-006 и
  standalone/ledger DATA-005 требуют Red/Green; DATA-007 остаётся
  `blocked_decision` до ответа Q-MATCH-003. Нужны API, real-PostgreSQL и browser
  tests.
- Backup/RPO/RTO для будущих ценных данных остаётся Q-OPS-003; любые production
  data operations по-прежнему требуют отдельного явного разрешения.

## 2026-09-06 — Audit foundation и правила Codex/Cursor

### Scope
- Immutable baseline: `audits/2026-09-06-baseline.md`
- Live backlog: `BACKLOG.md` (`SEC`, `BUG`, `GAP`, `DATA`, `OPS`, `TECH` IDs)
- Accepted ADR: D16–D22; updated HISTORY/MATCH/time/cold-start acceptance
- Backlog lifecycle unified: `confirmed → ready → in_progress → verified_local → verified_prod → done`, with `blocked_decision` branch
- External blocker: SEC-001 credential rotation; значение секрета не сохраняется
- Canonical Git: `Gleb20/10is_ball` `main`; рабочая ветка
  `codex/audit-foundation`; commit/push/deploy не выполнялись

### Changed
- Canonical docs: `docs/README.md`, `PROJECT_STATUS.md`, `BACKLOG.md`,
  `CAPABILITY_MATRIX.md`, `OPEN_QUESTIONS.md`, `WORKFLOW.md`, `DECISIONS.md`
- Entry/deploy/QA: `../README.md`, `DEPLOY.md`, `VERSIONING.md`,
  `A11Y_CHECKLIST.md`
- As-built: `architecture/AS_BUILT.md`, `architecture/API_AS_BUILT.md`,
  `architecture/DATA_MODEL_AS_BUILT.md`, `operations/DEPLOYMENT_AS_BUILT.md`
- Requirements governance: `requirements/00_README.md`, `04_PRD.md`,
  `06_NFR_CONSTRAINTS.md`, `11_ACCEPTANCE_TEST_CATALOG.md`,
  `12_IMPLEMENTATION_ROADMAP_TDD.md`, `13_REQUIREMENTS_TEST_TRACEABILITY.md`,
  `14_CURSOR_INSTRUCTIONS.md`,
  `MANIFEST.json`
- Agent rules (параллельная audit-foundation работа): `../AGENTS.md`,
  `../apps/api/AGENTS.md`, `../apps/web/AGENTS.md`,
  `../packages/shared/AGENTS.md`, `../.cursor/rules/*.mdc`
- Runtime/security: Node 24.20.0 pins, default-off bootstrap без fallback,
  atomic create/existing outcome и system audit; production без `DATABASE_URL`
  не запускается; startup/migration errors redacted
- Database tooling: `TEST_DATABASE_URL` не имеет fallback, ограничен loopback
  test-named DB и требует `ALLOW_TEST_DATABASE_RESET=1`; `db:migrate` требует
  explicit complete PostgreSQL URL и не подменяет его PGlite smoke
- Local PostgreSQL DX: root/API env examples согласованы, Compose требует явные
  значения и публикует порт только на `127.0.0.1`; existing volume caveat описан
- Audit automation: docs/link/ID gate, exact route↔OpenAPI baseline drift,
  staged/worktree/all-refs secret scan и отдельный local-env incident mode,
  read-only production capture, guarded synthetic seed и `BUG-015`
  characterization reproducer
- Evidence: production/local visual baseline 360/440/768/1440, local synthetic
  route smoke, production HTTP/fingerprint и PostgreSQL 16 critical CI lane

### Verified
- Исходный baseline был красным: API 2 failed / 40 passed / 1 skipped. После
  изоляции RNG выполнены три последовательных green full suite; дефект busy+bye
  не скрыт, а вынесен в `BUG-015` deterministic characterization
- Node 24.20.0 full test: shared 517 passed + 1 todo; test-utils 4 passed;
  web 70 passed; API 83 passed + 3 guarded PostgreSQL tests skipped
- Exact Node 24.20.0 `pnpm install --frozen-lockfile` и полный `pnpm run ci`
  завершились успешно: audit gates, lint, typecheck, tests, API/web builds
- Bootstrap focused integration: два concurrent seed дают ровно один `created`,
  один `existing` и одну durable audit row с system actor
- Live: Vercel web, direct Render health и proxied health ответили 200 после cold start
- Browser: public production login на 4 viewport; synthetic local home на 4
  viewport, key screens на 360px, 17 organizer routes + отдельный admin pass;
  горизонтальный overflow не найден, полный PRD E2E/axe не заявляется
- Documentation: automated link/anchor/schema check покрывает immutable baseline
  48 findings и live backlog 49 после выделения DATA-007
- Cursor compatibility rules: 6/6 `.mdc` files have delimited frontmatter,
  non-empty `description` and boolean `alwaysApply`
- Secret scan: worktree + index + all refs, 0 unreviewed candidates, 0 skipped
  inputs; 11 exact-hash benign findings в 9 historical loopback blobs reviewed;
  staged-only blob self-test проходит. Это не подтверждает external rotation
- Route/OpenAPI: source 60 operations / 54 paths, OpenAPI 15 operations /
  12 paths, exact inventory unchanged against saved baseline
- Local web build fingerprint совпал с production HTML/JS/CSS capture; deployed
  commit SHA этим не доказан
- PostgreSQL 16 CI lane добавлен и fail-closed; local PostgreSQL runtime был
  недоступен, поэтому 3 real-PG tests и hosted lane остаются pending
- Dependency audit: 17 production advisories — 12 high и 5 moderate

### Remaining
- Исправление product backlog ещё не начато; foundation устранил только риски
  самого audit/dev контура и bootstrap/runtime configuration.
- SEC-001 требует внешнего действия в Neon/Render и отрицательной проверки старого доступа.
- Current production = interim visual regression baseline; Figma = historical,
  non-authoritative reference (D22).

## 2026-07-25 — Historical Figma visual parity + interaction Screen Flows

> Historical design work. Superseded by D22 on 2026-09-06: этот файл не является
> authoritative source; current production используется как interim regression baseline.

### Design
- Rebuilt [10is](https://www.figma.com/design/WBUbQBLKsijwYnQTCVw2Uy/10is) screens for 1:1 layout parity with localhost (Handjet only intentional font delta)
- New kit pieces: AuthCard, HeroCard, PodiumSlot, ScoreDisplay, Segment, BottomNav v2, JudgeSide
- Interaction flows: Auth (login states → first password → Home), Start→Match create→Detail, Judge setup/scoring/pending, Tournament sequence, overlays on Match detail
- Old schematic frames moved to `_Deprecated schematic`

### Docs
- Visual parity rebuild note (this entry)

## 2026-07-25 — Historical Figma UI Kit + Screen Flows (10is)

> Historical design artifact; source-of-truth claim below was superseded by D22.

### Design
- Figma file [10is](https://www.figma.com/design/WBUbQBLKsijwYnQTCVw2Uy/10is): Foundations (variables + Handjet text styles), Components (variants + Auto Layout), Shell (iPhone 17 Pro Max 440×956), Screen Flows (auth, primary tabs, matches, tournaments, more, judge, overlays)
- Typography in mockups: Handjet (pixel direction); web still `Moscow Sans W` until follow-up CSS change

### Docs
- Historical decision note: Q-UI-4 тогда объявлял Figma + Handjet source of truth;
  это отменено D22, Handjet rollout не одобрен
- `PROJECT_STATUS.md` step log

### How to verify
- Open file in Figma Desktop; pages Cover → Foundations → Components → Flows / *

## 2026-07-22 — CI: build shared packages before lint

### CI / root
- `.github/workflows/ci.yml`: build `@tab10/shared` + `@tab10/test-utils` before `pnpm lint`
- Root `package.json` `ci` script: same pre-build (packages export `dist/*.d.ts`)

### Why
- Fresh CI checkout has no `dist/` → api `tsc` lint fails with TS2307 and cascading `any` errors

## 2026-07-22 — Match cancel for organizer/participant (planned v1.10.2)

### API
- `POST /api/v1/matches/:matchId/cancel` — standalone active → `cancelled`, no winner/stats
- Auth: creator / participant / active judge (`assertCanManageMatch`)
- Shared `voidStandaloneMatch` with admin force-close

### Web
- Match detail: «Отменить матч» + confirm dialog for managers on waiting/in_progress/pending

### Tests
- AT-MATCH-CANCEL-001..003
- REQ_ui__match_cancel

### Requirement IDs
- MATCH-009, AT-MATCH-CANCEL-001..003; D15 (user cancel parallel)

### How to verify
```bash
pnpm --filter @tab10/api test -- src/domain.integration.test.ts -t AT-MATCH-CANCEL
pnpm --filter @tab10/web test -- src/pages/MatchDetailPage.test.tsx
```

## 2026-07-22 — Admin force-close / delete standalone matches (D15, planned v1.11.0)

### Decision
- ADR D15: admin may void (`cancelled`) and hard-delete only `kind=standalone`; MATCH-009 concurrency stays; tournament/tutorial forbidden.

### API
- `POST /api/v1/admin/matches/:matchId/force-close` → `cancelled`, no winner/stats, release judge
- `DELETE /api/v1/admin/matches/:matchId` → reverseStats if finished/stopped with winner; delete judge_sessions → participants → match
- Errors: `TOURNAMENT_MATCH_FORBIDDEN`, `MATCH_NOT_ACTIVE`

### Web
- Match detail: «Принудительно закрыть» / «Удалить из истории» (admin + standalone)
- History: delete button on standalone match rows
- Confirm dialogs (ic-kit Dialog)

### Tests
- AT-ADM-MATCH-001..006 in `domain.integration.test.ts`
- REQ_ui__admin_match_ops in `MatchDetailPage.test.tsx`

### Requirement IDs
- ADM-MATCH / AT-ADM-MATCH-001..006; MATCH-009 (unchanged rule, ops unblock)

### How to verify
```bash
pnpm --filter @tab10/api test -- src/domain.integration.test.ts -t AT-ADM-MATCH
pnpm --filter @tab10/web test -- src/pages/MatchDetailPage.test.tsx
```

## 2026-07-22 — Prod hotfix: Date in sql on postgres-js (v1.10.1)

### API
- `match-service.ts`: 8× `` sql`…${date}` `` → `gt` / `lte` / `gte` (judge sessions, rankings week/month)
- `app.ts`: try/catch on `POST/GET /api/v1/matches`; global `setErrorHandler` для INTERNAL

### Tests
- `INT_match__get_after_create_returns_activeJudge` (PGlite)
- `postgres-date.integration.test.ts` — smoke при `DATABASE_URL` (Neon)

### Requirement IDs
- MATCH-001, MATCH-008, JUDGE-001; AT-MATCH-001, AT-JUDGE-003

### How to verify
```bash
pnpm run ci
PGLITE_DATA_DIR= pnpm --filter @tab10/api test -- src/domain.integration.test.ts -t INT_match__get_after_create
# optional Neon:
DATABASE_URL=postgresql://... pnpm --filter @tab10/api test -- src/postgres-date.integration.test.ts
```

## 2026-07-22 — Prod tournament parity (Neon schema drift + cancel)

### Root cause
- Neon/prod tables created at early bootstrap; later columns lived only in `CREATE TABLE IF NOT EXISTS` → never applied on existing DB
- Localhost (fresh PGlite / wiped `.data`) always got full CREATE → looked fine

### API
- `applySchemaSql`: ALTER for `organizer_participates`, participant `status`, mercy/stop/slot/avatar/algorithm columns
- Create: delete tournament row if organizer roster insert fails (no orphan collecting)
- `POST /tournaments/:id/cancel` (organizer, pre-start) → `cancelled`
- Withdraw: `NOT_A_PARTICIPANT`; treat null status as active
- PATCH `organizerParticipates` adds/withdraws organizer on roster

### Web
- «Отменить турнир»; leave only if active participant; `cancelled` label

### Tests
- `schema-drift.integration.test.ts`; AT-TRN-014 cancel + non-participant withdraw

### How to verify
```bash
PGLITE_DATA_DIR= pnpm --filter @tab10/api test -- src/db/schema-drift.integration.test.ts
PGLITE_DATA_DIR= pnpm --filter @tab10/api test -- -t "AT-TRN-014"
pnpm --filter @tab10/web test -- src/pages/TournamentDetailPage.algorithm.test.tsx
```
After Render redeploy: log `Postgres schema ensured`; smoke create tournament with checkbox → organizer in roster with ФИО; Cancel works.

## 2026-07-22 — Compact double elimination

### Shared
- `generateCompactDoubleElimination`: compact WB + phased CompactEntry LB + GF1/GF2
- Golden N=3/5/6/7; property DE compact N=3..32
- Removed `COMPACT_DOUBLE_ELIMINATION_UNSUPPORTED`

### API / Web
- DE + compact generate/start supported; dialog enables both algorithms for DE
- ADR D14 updated

### How to verify
```bash
pnpm --filter @tab10/shared build && pnpm --filter @tab10/shared test -- src/bracket-v2/compact-de.golden.test.ts
PGLITE_DATA_DIR= pnpm --filter @tab10/api test -- -t "construction algorithm"
pnpm --filter @tab10/web test -- src/components/BracketAlgorithmDialog.test.tsx
```

## 2026-07-21 — Bracket construction algorithm choice (compact / power_of_two)

### Shared
- `BracketConstructionAlgorithm`; discriminated V2 metadata (compact без `bracketSize`)
- `generateBracketGraph` / `prepareBracketGraph`; compact SE generator + CompactEntry bye-history
- Po2 SE/DE isolated; compact+DE → `COMPACT_DOUBLE_ELIMINATION_UNSUPPORTED`
- Legacy detect: V1 SE→compact, V1 DE→legacy, V2 missing field→Po2
- Golden N=3/5/6/7; property SE compact+Po2 N=3..64

### API
- Column `bracket_construction_algorithm` (nullable + DEFAULT compact; safe backfill)
- `POST /bracket` body `{ constructionAlgorithm? }` + `resolveRequestedConstructionAlgorithm`
- Seed reorder regenerates full graph with same algorithm
- Integration: default-preservation, DE reject, materialization N=5

### Web
- Dialog «Как построить сетку?»; DE: compact disabled with reason
- Labels «Компактная / Классическая сетка»; bye caption «Проходит дальше без матча»

### Docs
- ADR D14

### How to verify
```bash
pnpm --filter @tab10/shared build && pnpm --filter @tab10/shared test
PGLITE_DATA_DIR= pnpm --filter @tab10/api test
pnpm --filter @tab10/web test
pnpm typecheck
```

## 2026-07-21 — Challonge-inspired bracket V2 (domain + API + web; no product version bump)

### Shared (`bracket-v2/`)
- Match-centric `schemaVersion: 2` types; SE/DE generate; tri-state `resolveSource` + bye fixpoint
- GF2 = W(GF1)×L(GF1) + `activationCondition` (LB champ); derived `inactive`
- Golden DE 4/8/16; property N=3..64; V1 characterization / `test.todo` (not red suite)
- Facade: `tournament-bracket-v1.ts` + re-exports; `isBracketGraphComplete` (V2)

### API
- Columns: `bracket_state_version`, `third_place_enabled`, `tournament_bracket_match_id` (+ unique index)
- New generate → V2; V1 brackets still start/advance
- `createMatch` accepts optional `db` executor; optimistic `bracket_state_version`
- Parse errors: `BRACKET_MISSING` / `CORRUPT` / `UNSUPPORTED` / `VERSION_CONFLICT`
- PGlite: no wrapping `db.transaction` (deadlock); version check + sequential materialize

### Web
- `buildBracketViewModelV2` + V1 path retained; Detail page via `parseBracketJson`
- `liveMatchVersusLabel` supports V2 node id in `tournamentSlotId`

### Docs
- ADR D12 (V2 topology), D13 (correction deferred — no stats compensate yet)
- Proposed next product release when shipping: **1.11.0** (b — rewrite under tournaments)

### How to verify
```bash
pnpm --filter @tab10/shared test && pnpm --filter @tab10/shared typecheck
PGLITE_DATA_DIR= pnpm --filter @tab10/api test -- src/domain.integration.test.ts -t "AT-TRN|INT_trn"
pnpm --filter @tab10/web test -- src/bracketViewModel.test.ts
```

## 2026-07-21 — Roster / notifications / compact SE (v1.10.0)

### Domain
- `generateSingleEliminationBracket` → successive odd-bye (last / fewest prior byes)
- `generatePowerOf2SingleEliminationBracket` kept for DE WB only
- ADR: SE compact vs DE Challonge Po2

### API
- Tournament `get` returns `invitations` (pending/declined); `DELETE .../invitations/:id`
- Directory excludes `load*@tab10.local`
- Notifications list enriched with `lifecycle`; home `unreadCount`
- Respond invite marks related notification read

### Web
- UserPicker controlled `inputValue` clear; roster invite statuses
- Profile unread badge; Notifications «Актуальные» filter + Принято/Отклонено

### How to verify
```bash
pnpm --filter @tab10/shared build && PGLITE_DATA_DIR= pnpm --filter @tab10/api test && pnpm --filter @tab10/web test
# N=5 generate → 1 bye (last seed), 2 R0 matches
```

## 2026-07-21 — Bracket connectors rewrite (v1.9.2)

### Web
- Removed ambiguous CSS card stubs (`::before`/`::after`)
- Measured SVG cubic from winner row → next match card (`feedsToCardKey`)
- Player fate: `advance` | `drop` (↓) | `eliminated` (✕) via `loserToSlotId`
- Column padding by round power-of-two so feeders align under next card

### How to verify
```bash
pnpm --filter @tab10/web test && pnpm --filter @tab10/web typecheck
# Play a WB match in DE → blue curve from winner; loser shows ↓
# Lose in LB or SE R0 → ✕
```

## 2026-07-21 — Bracket UX BYE + connectors (v1.9.1)

### Domain
- `standardPlacement` → Challonge bracket seed order (top seeds get byes)

### Web
- Bracket connectors (CSS path-top/bottom), loser dim, round spacing
- Current matches: vs labels from tournamentSlotId; no 0:0 while waiting
- Hide roster when not collecting / needs_regeneration

### How to verify
```bash
pnpm --filter @tab10/shared build && PGLITE_DATA_DIR= pnpm --filter @tab10/api test && pnpm --filter @tab10/web test
# 6 players generate → bye #1 #2; live matches show A vs B
```

## 2026-07-21 — Challonge-like SE/DE + meme avatars (v1.9.0)

### Domain
- Rewrite `generateDoubleEliminationBracket`: WB + LB drop-ins + `final` / `final_reset`
- `applyMatchResult`: WB wins GF → champion; LB wins → fill reset slots
- ADR Q3 closed (Challonge DE + reset)

### Avatars
- Presets `apps/web/public/avatars/avatar_1.png`…`10`
- `randomAvatarKey` in shared; users 1..10; `guest_avatar_key` on match/tournament participants
- Enrich me/directory/rankings/match/tournament with `avatarKey`

### Web
- Challonge-lite bands + avatars/seeds on bracket cards; Profile/Home/Rankings/Match/Judge

### How to verify
```bash
pnpm --filter @tab10/shared build && PGLITE_DATA_DIR= pnpm --filter @tab10/api test && pnpm --filter @tab10/web test
```

## 2026-07-21 — Tournament playable UX (v1.8.0)

### API
- `create` + `organizerParticipates` → insert organizer as active participant
- `GET /tournaments/:id`: participant `displayName`; one-shot heal organizer on roster
- Duplicate user add → `ALREADY_IN_TOURNAMENT`; `INVALID_STATUS` message

### Web
- `UserPicker` Autocomplete; TournamentDetail add/invite by name
- loadError vs actionError; status-aware withdraw/lifecycle
- `TournamentBracket` + `buildBracketViewModel` (CSS columns)
- Judge: finished → readonly; confirmFinish/release → tournament; MatchDetail «К турниру»

### How to verify
```bash
pnpm --filter @tab10/shared build && pnpm --filter @tab10/api test && pnpm --filter @tab10/web test
# Create with organizer participates → self in list → Autocomplete add → generate → Судить → back to tournament
```

## 2026-07-21 — Working tournaments Phase 6 (v1.7.0)

### API / domain
- Tournament lifecycle: PATCH, invitations, dissolve, withdraw, PATCH bracket
- `start` → create matches from ready pairs; `onMatchFinished` advances bracket
- `stop` cancels unplayed; DE losers/final materialization
- Schema: organizerParticipates, rules, tournament_slot_id, tournament_invitations

### Web
- Tournament detail: start/stop/dissolve/withdraw, match links, invites
- Notifications: tournament_invitation + match_ready

### How to verify
```bash
pnpm --filter @tab10/shared build && pnpm test
pnpm dev
# Create SE → 4 players → generate → start → judge match → stop
```

## 2026-07-21 — Swap ↔ between panels + mercy after undo (v1.6.3)

### Web
- Judge setup: ↔ снова между плашками счёта (`judge-board--setup`), не в toolbar

### Rules
- `checkVictory` mercy: лидер ≥ `mercyPoints` и соперник 0 (D8); отменённые очки не блокируют
- AT-MATCH-004c: accidental B → Undo → 5×A → `pending_confirmation`

### How to verify
```bash
pnpm run ci
pnpm dev
# Judge setup: ↔ между плашками
# +1 сопернику → Undo → 5 очков лидеру → подтверждение сухой победы
```

## 2026-07-21 — Mercy N:0 + setup board + serve racket (v1.6.2)

### Rules
- `checkVictory` mercy: только exact `mercyPoints:0` / `0:mercyPoints` (ADR D8)
- AT-MATCH-004b: 5:1 не завершает матч

### Web
- MatchCreate: дефолт «Игрок»; copy «сухая победа при счёте N:0»
- Judge setup = тот же board (0:0); тап стороны = первый подающий; ↔; «Начать матч»
- Бейдж «Подача» + `TableTennisRacketIcon`

### How to verify
```bash
pnpm run ci
pnpm dev
# /matches/new — режим Игрок; mercy 5:0 copy
# Judge setup: board layout, tap serve, Начать матч → timer
# 5:1 при mercy не finish
```

## 2026-07-21 — Judge UX polish (v1.6.1)

### Fixes
- Undo: rebuild только из `point_awarded` (AT-MATCH-005b) — всегда −1 очко
- `startedAt` ставится в `judge/setup`, не в `startMatch` — таймер после выбора подачи
- Setup UI: кликабельная ↔ между половинами; чекбоксы смены сторон убраны
- +1 внутри ячеек счёта (стабильная высота); spacer в readonly
- После «Подтвердить результат» → navigate на карточку матча
- Undo: `undoPending` + reload при ошибке

### Authz
- ADR D7: любой active user может acquire свободный judge-слот (не только участник)

### How to verify
```bash
pnpm run ci
pnpm dev
# Setup: ↔ меняет стороны; таймер стартует после «Начать судейство»
# Undo после серии award/undo — ровно −1
# Не-участник может «Судить» свободный матч
# Confirm finish → /matches/:id
```

## 2026-07-21 — Judge UX slice (v1.6.0)

### API
- `GET /matches/:id` → `activeJudge: { userId, displayName } | null`
- `POST /matches/:id/judge/setup` — first server, swap sides, display flip (`judge_display_flipped`)
- `acquireJudge` idempotent для той же сессии; `JUDGE_TAKEN` с `details.currentJudge`
- Integration: AT-JUDGE-003, AT-MATCH-004 mercy, setup swap/server

### Web
- JudgePage: фазы loading / blocked / setup / scoring / readonly (`?mode=readonly`)
- MatchCreatePage: сухая победа (default on, порог 5/10)
- MatchDetailPage: длительность, активный судья, «Открыть счёт»
- Таймер матча; кнопки «+1»; контраст loading-текста

### How to verify
```bash
pnpm run ci
pnpm dev
# Создать матч с mercy → 5:0 → pending_confirmation
# Release судьи → другой участник acquire без зависания
# /matches/:id/judge?mode=readonly — просмотр счёта
```

## 2026-07-21 — P0+P1 bugfix slice (v1.5.0)

### P0 — корректность API
- Atomic `UPDATE … WHERE version = expected` на очках / undo
- Обязательный `Idempotency-Key`; повтор ключа — idempotent 200
- CSRF: cookie + `X-CSRF-Token` на мутациях (кроме login; в тестах отключено)
- Authz: stop — только участник/судья; acquire judge — только участник; release — активный судья
- RANK-001 comparator + calendar week/month из `finishedAt` матчей
- `getMatch` обогащает participants полем `displayName`

### P1 — тупиковые UX-сценарии
- `/notifications` — список, read, accept/decline team invite
- Challenge: `/matches/new?opponentId&opponentName` из рейтинга
- Stop match UI на детали матча
- 404 страница, «Назад» / «Отмена» на формах
- Rankings sticky error fix; history sort by time
- Login: show password, текст про админа; first password confirm

### How to verify
```bash
pnpm --filter @tab10/shared build && pnpm --filter @tab10/test-utils build
pnpm run ci
pnpm dev
```

## 2026-07-20 — Admin role create / promote / demote (v1.4.0)

### Added
- `AuthService.updateUserRole` — self-forbid, last-admin, revoke sessions, audit `user.role_changed`
- `PATCH /api/v1/admin/users/:userId` body `{ role }`
- Admin UI: role select on create; «Сделать админом» / «Снять админа» + confirm
- Tests: `INT_admin__role_create_promote_demote_guards`; AdminPage role UI

### Changed
- Product version **1.3.2 → 1.4.0** (b)
- ADR D6 — no self role change; revoke sessions on role change

### How to verify
```bash
pnpm --filter @tab10/api test
pnpm --filter @tab10/web test
pnpm run ci
```

## 2026-07-20 — Deploy readiness (Neon / Render / Vercel)

### Added
- `docs/DEPLOY.md` — пошаговый бесплатный хостинг
- `render.yaml`, `apps/web/vercel.json`, `vercel.rewrites.example.json`
- `.env.example` для api/web
- API: `WEB_ORIGIN` CORS, `COOKIE_SAME_SITE`, schema on Postgres boot
- Web: `VITE_API_BASE_URL` prefix

### How to verify
```bash
pnpm run ci
# follow docs/DEPLOY.md
```

## 2026-07-20 — Phase 10 UI-6 Visual/a11y QA (v1.3.2)

### Added
- `docs/A11Y_CHECKLIST.md`
- `a11y.smoke.test.tsx` — 360px nav, skip-link, AT-EMPTY-001, auth width, CSS floors
- Skip-link в AppShell; global `:focus-visible`; `prefers-reduced-motion`

### Changed
- Product version **1.3.1 → 1.3.2** (c)
- Phase 10 UI polish marked **done**

### How to verify
```bash
pnpm --filter @tab10/web test
pnpm run ci
```

## 2026-07-20 — Phase 10 UI-5 Auth + Admin polish (v1.3.1)

### Added
- `authUi.tsx` — AuthLayout, TempPasswordPanel
- `copyText.ts` — clipboard helper
- ic-kit `Dialog` re-export; admin confirm + temp password dialogs
- Tests: AdminPage.test.tsx, copyText.test.ts

### Changed
- Login / FirstPassword на AuthLayout
- Product version **1.3.0 → 1.3.1** (c)

### How to verify
```bash
pnpm --filter @tab10/web test
pnpm run ci
pnpm dev
```

## 2026-07-20 — Phase 10 UI-4 Judge immersive (v1.3.0)

### Added
- `judgeUi.ts` — side labels, servingSide, landscape hint
- JudgePage: immersive layout, serve badge, rotate hint, more-menu (confirm/revert/release)
- API client: heartbeatJudge, releaseJudge, revertFinish
- Tests: `judgeUi.test.ts`, `JudgePage.test.tsx`

### Changed
- Immersive shell CSS + landscape compact board
- Product version **1.2.0 → 1.3.0** (b)

### How to verify
```bash
pnpm --filter @tab10/web test
pnpm run ci
pnpm dev
# open /matches/:id/judge
```

## 2026-07-20 — Phase 10 UI-3 key screens (v1.2.0)

### Added
- `GET /api/v1/users/directory` — active users for Autocomplete (no email)
- Home `myStats` in `/api/v1/home`
- `rankingUi.ts` — podium split + initials
- MatchCreate guest/player modes + ic-kit Autocomplete

### Changed
- Home / Rankings / Profile visual polish (Avatar, podium, ListRow sections)
- Product version **1.1.1 → 1.2.0** (b)

### How to verify
```bash
pnpm run ci
pnpm dev
```

## 2026-07-20 — Phase 10 UI-2 patterns (v1.1.1)

### Added
- `apps/web/src/patterns.tsx` — ListRow, StatusChip, AsyncState, FilterBar
- `apps/web/src/statusLabels.ts` — RU status/format labels + tone
- `patterns.test.tsx` — REQ_ui__* coverage

### Changed
- Data screens use AsyncState (skeleton / empty / Alert)
- Match/tournament/user statuses via StatusChip (no raw enums)
- Rankings + tournament format via FilterBar
- Product version **1.1.0 → 1.1.1** (c)

### How to verify
```bash
pnpm --filter @tab10/web test
pnpm run ci
pnpm dev
```

## 2026-07-20 — Phase 10 UI-0 + UI-1 (v1.1.0)

### Added
- `layout.tsx`: `AppShell`, `BottomNav`, `PageLayout`, `shouldShowBottomNav`
- Pages: `HistoryPage`, `StartPage`, `MatchCreatePage` (`/matches/new`)
- Shell tests: `layout.test.tsx`

### Changed
- Bottom nav → ADR D5 tabs (removed Матчи/Турниры from primary bar)
- Home / Profile / Matches / Rankings / Tournaments / Match detail use PageLayout
- Admin only from Profile; judge hides bottom nav
- `viewport-fit=cover` + safe-area padding
- Product version **1.0.0 → 1.1.0** (b)

### How to verify
```bash
pnpm --filter @tab10/web test
pnpm run ci
pnpm dev   # bottom nav: Главная · История · Начать · Рейтинг · Профиль
```

## 2026-07-20 — Phase 10 planning: IA variant A (docs)

### Decided
- ADR **D5**: bottom nav = Главная / История / «Начать» / Рейтинг / Профиль
- Q-UI-2 `/matches/new`, Q-UI-3 desktop column, Q-UI-4 ic-kit-only — в D5
- Устаревший прототип (табы Матчи/Турниры) явно помечен как drift до UI-1

### Docs updated
- `docs/DECISIONS.md` — D5
- `docs/PROJECT_STATUS.md` — Phase 10 planned; next = UI-0
- `docs/requirements/05_UX_FLOWS.md` §1, §10, §15
- `docs/requirements/12_IMPLEMENTATION_ROADMAP_TDD.md` — Phase 10 slices
- Traceability: HOME / ONB shell notes

### Not in this change
- Код `apps/web` ещё на старых табах — реализация с Phase 10 UI-0

## 2026-07-20 — Phase 9.1 load test & backup rehearsal

### Added
- `apps/api/src/load.integration.test.ts` — `INT_load__ten_parallel_matches_meet_slo`
- `scripts/backup-rehearsal.sh` — pg_dump/restore rehearsal (NFR §7)
- `percentile()` helper in `@tab10/test-utils`
- Scripts: `pnpm test:load`, `pnpm backup:rehearsal`

### How to verify
```bash
pnpm test:load                    # 10 parallel matches + SLO assertions
docker compose up -d && pnpm backup:rehearsal   # requires pg_dump/psql
pnpm run ci                       # full suite (36 tests)
```

## 2026-07-20 — Repo layout cleanup

### Changed
- Удалены дубликаты требований из корня (`00–14`, `MANIFEST.json`) — канон: `docs/requirements/`
- Добавлен [`docs/README.md`](README.md), обновлён корневой [`README.md`](../README.md)
- `.gitignore`: `.DS_Store`, `apps/api/dist`, `.pnpm-store`

## 2026-07-20 — Versioning & commit conventions

### Added
- [`docs/VERSIONING.md`](VERSIONING.md) — правила `a.b.c`
- [`CHANGELOG.md`](../CHANGELOG.md) — продуктовый changelog
- [`.cursor/rules/git-commits.mdc`](../.cursor/rules/git-commits.mdc) — шаблон детальных коммитов
- Версия продукта **1.0.0** в root `package.json`

### How to bump version
| Change type | Digit | Example |
|-------------|-------|---------|
| Новый экран/флоу | a | 1.0.0 → 2.0.0 |
| Функционал в существующем UI | b | 1.1.1 → 1.2.0 |
| Баг / UX fix | c | 1.2.0 → 1.2.1 |

## 2026-07-20 — Bootstrap Tab-10 monorepo

### Done
- pnpm workspaces: `apps/api`, `apps/web`, `packages/shared`, `packages/test-utils`
- Requirements copied to `docs/requirements/`
- Domain pure logic: password policy, match engine, brackets, rankings, teams
- Fastify API: auth, admin, matches, judge, tournaments, teams, notifications, FAQ, home/rankings
- React + ic-kit UI: login, admin, matches, judge, tournaments, teams, profile, help, onboarding
- Integration tests on PGlite; unit tests for shared domain
- CI workflow, docker-compose for PostgreSQL, cursor project-plan rule

### How to test
```bash
corepack enable && pnpm install && pnpm run ci && pnpm dev
```

### Manual smoke
1. Login as admin
2. Create user in /admin, copy temp password
3. Login as user → set password → home
4. Create match with guest → judge → score → confirm
5. Create tournament with 3 guests → generate bracket
