# Tab-10 — статус проекта

Обновлено: **2026-09-13**. Опубликована **1.11.0**; выполняется волна B.

## Current accepted candidate 2.0.0 (supersedes local evidence below)

Wave B GAP-002/003/004 is verified_local: `pnpm run verify:all` passed 1010/1010
with zero failures/skips/todo/interrupted (quality 945, PostgreSQL 42, browser 19,
cleanup 4). Strengthened loaded-card browser check rerun passed 19/19.
Desktop/390 profile, rankings and history return reviewed.
[Evidence](audit/evidence/wave-b-local.json). Public release pending.
Original 186 files unchanged. GAP-005..011 remain open; Wave C is next.

## Итог

Выполняется принятый план завершения PRD v2 волнами A–F:
[очередь и критерии приёмки](test-plans/OPS-004-completion-waves.md).
Read-only public smoke подтвердил `b193e9de7f6448a722ae061cb106825fe273d352`,
version `1.11.0` у web/API/proxy. GitHub CI run `34726774716` завершился success
во всех четырёх jobs. Волна A опубликована, волна B (GAP-002/003/004) выполняется.
Полная готовность PRD v2 не заявляется: GAP-002..011 остаются открыты.

## Текущая проверка кандидата

- Финальный `pnpm run verify:all`: **965 passed**, 0 failed/skipped/todo/interrupted;
  quality 906, PostgreSQL 40, compiled browser 15 (6 journeys + 9 foundation), cleanup 4.
- Исправления гонок и устаревшей ошибки после reauth прошли независимое ревью;
  desktop/390 browser проверяет сохранённый результат и восстановленный черновик.
- [Обезличенный отчёт](audit/evidence/wave-a-local.json). Scope волны A переведён
  в `verified_local`; public release подтверждён exact-SHA smoke и CI. GAP-002..011 остаются открыты.
- Backlog содержит 51 canonical ID. Исходные 186 файлов совпадают со снимком.

## Исторический снимок 2026-09-09 (superseded текущей проверкой выше)

| Область | Состояние на 2026-09-09 |
|---|---|
| Public stand web/API | Disposable испытательный стенд: exact SHA `6892d6e`/version `1.10.1` одновременно подтверждены у Vercel web, Render API и proxy; seed-admin login прошёл в браузере |
| OPS-004 foundation | PR #4 и Neon-normalization PR #5 слиты; дальнейшая работа по D32 идёт прямыми commits/pushes в `main`; исходный dirty worktree и внешний recovery snapshot сохранены |
| Закреплённый stack | Repo target: Node **24.20.0**, pnpm **9.15.0**, PostgreSQL **16.15-alpine** по digest, Playwright **1.63.0**/Chromium **153.0.8010.12**; fresh frozen install и `doctor` прошли |
| Текущий full test | P0 release candidate `pnpm verify:all`: `862 passed, 0 failed, 0 skipped, 0 todo, 0 interrupted`; в aggregate входят quality 810, PostgreSQL 37, compiled browser 11 и cleanup 4 |
| Детерминизм | после изоляции RNG три последовательных full suite и последний Node 24 run зелёные; известный busy+bye дефект закреплён отдельным `BUG-015` characterization test |
| Local quality/build | Frozen install, doctor, docs/routes/secrets audits, lint, typecheck, builds и полный `verify:all` зелёные с `0 failed / 0 skipped / 0 todo`; disposable PostgreSQL cleanup подтверждён |
| Hosted CI | SHA `6892d6e`: GitHub run `34195797553` success; Quality/PGlite, PostgreSQL 16 и compiled browser lanes green |
| Web artifact fingerprint | local build HTML/JS/CSS hashes совпали с production capture; это не заменяет commit SHA/release metadata |
| Browser baseline | production login: 4 viewport; local synthetic data: 4 home viewport, key 360px screens и smoke 17 organizer routes + admin; это не полный PRD E2E/axe |
| PostgreSQL verification | Exact PostgreSQL 16.15: fresh/idempotent `0000→0001`, split-role policy, DATA-002/005/007 transaction/concurrency и immutable void audit прошли в полном барьере: 37/37 |
| Secret incident | Neon role credential ротирован; disposable stand по D32 сознательно использует `neondb_owner`, `SEED_ADMIN=1`; новый seed-admin создан, credentials хранятся только в Render и переданы пользователю через локальный clipboard |
| Security dependencies | Production graph: 0 high/critical и 3 documented moderate React Router advisories; Fastify 5.12.3 и Drizzle 0.45.2 проверены полным барьером |
| Route/OpenAPI inventory | current source/OpenAPI: 64 operations / 58 paths, 100% inventory coverage; live/public artifact remains tied to the last released SHA until Wave A release |
| Product decisions | D23: cancel только active admin/creator; D24: creator/admin soft void; D33: void турнирного матча компенсирует только его stats/ranking и сохраняет остальную сетку/downstream неизменными |
| Wave A integration | `BUG-004..016`, `GAP-001`, `OPS-005` — `in_progress`; frozen 2026-09-07 evidence историческое, текущий web gate: typecheck green, focused 59/59, full 125/125; API/PostgreSQL/CI/browser gates выполняются отдельно |
| Documentation | immutable baseline: 48 findings; live backlog: 49 после выделения DATA-007; links/anchors/IDs/status schema проверяются автоматически |
| Релизная синхронизация | D32: прямой verified push в `main` запускает Render/Vercel native Git deploy и параллельный CI; `pnpm smoke:public` read-only ждёт одинаковый SHA/version; public API временно использует `neondb_owner` |
| Public DB bootstrap | Пользователь разрешил одноразово пересоздать `public`/`drizzle` на точном Neon target и применить `0000` с нуля; последующие releases только apply-only |
| Recovery | Существующий manual snapshot/recovery copy сохранён как ручная страховка, но не является release barrier для disposable stand |

## Блокеры исторического снимка 2026-09-09

- Текущий P0 batch ещё должен пройти один direct-main push, hosted CI и exact-SHA
  read-only smoke у Render API, Vercel web и proxy.
- Public runtime временно использует owner-role, а production-grade
  backup/recovery и отдельный staging отложены до VPS-readiness scope.
- P1 gaps, включая полные browser journeys, profile/ranking/team/match slices и
  известный busy-player/bye BUG-015, не входят в этот выпуск.

Полный зафиксированный отчёт: [baseline audit](audits/2026-09-06-baseline.md).
Текущие приоритеты и критерии проверки: [BACKLOG.md](BACKLOG.md).

## Следующий этап

`OPS-004` достиг `verified_prod`: baseline применён к disposable public schema,
CI и первый exact-SHA public release проверены. SEC-001/002/004 и TECH-001/004
сверены с тем же опубликованным foundation SHA. Текущий P0 batch переносит только
миграцию `0001`; P1 migrations `0002–0003` и GAP-002–005 исключены.

Q-MATCH-003 закрыт решением D33. Следующий обязательный шаг этого batch — один
push всей локальной серии в `origin/main`, hosted CI и read-only `smoke:public`.
Одноразовый reset по D31 не повторяется: применяются только immutable forward
migrations. После подтверждения exact SHA можно перевести текущие P0 пункты из
`verified_local` в `verified_prod` отдельной честной post-release фиксацией.
Новые продуктовые решения принимаются только через
[OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) и [DECISIONS.md](DECISIONS.md).

## Визуальный статус

Current production — временный visual regression baseline до отдельно
согласованного redesign. Figma-работа 2026-07-25 сохранена как historical
reference и не является source of truth. Подтверждённые a11y/layout defects
production не нормализуются и остаются в `GAP-011` (ADR D22).
