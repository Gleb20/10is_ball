# Tab-10 — статус проекта

Обновлено: **2026-09-08**. Версия в корневом `package.json`: **1.10.1**.

## Итог

Сервис опубликован и отвечает, но **не готов к полноценной эксплуатации**. Базовая
цепочка login → match → judge → score и турнирный код существуют, однако аудит
обнаружил P0-дефекты безопасности, авторизации и целостности данных. Ранее
выставленные статусы фаз `done` означали наличие реализации, а не подтверждённую
готовность.

## Проверенный снимок

| Область | Состояние на 2026-09-08 |
|---|---|
| Public stand web/API | Disposable испытательный стенд: exact SHA `6892d6e`/version `1.10.1` одновременно подтверждены у Vercel web, Render API и proxy; seed-admin login прошёл в браузере |
| OPS-004 foundation | PR #4 и Neon-normalization PR #5 слиты; дальнейшая работа по D32 идёт прямыми commits/pushes в `main`; исходный dirty worktree и внешний recovery snapshot сохранены |
| Закреплённый stack | Repo target: Node **24.20.0**, pnpm **9.15.0**, PostgreSQL **16.15-alpine** по digest, Playwright **1.63.0**/Chromium **153.0.8010.12**; fresh frozen install и `doctor` прошли |
| Текущий full test | OPS-004 `pnpm ci`: `820 passed, 0 failed, 0 skipped, 0 todo, 0 interrupted`; PostgreSQL 16 и compiled browser входят в тот же барьер |
| Детерминизм | после изоляции RNG три последовательных full suite и последний Node 24 run зелёные; известный busy+bye дефект закреплён отдельным `BUG-015` characterization test |
| Local quality/build | Frozen install/doctor и полный `verify:all` зелёные с `0 failed / 0 skipped / 0 todo`; disposable PostgreSQL cleanup подтверждён |
| Hosted CI | SHA `6892d6e`: GitHub run `34195797553` success; Quality/PGlite, PostgreSQL 16 и compiled browser lanes green |
| Web artifact fingerprint | local build HTML/JS/CSS hashes совпали с production capture; это не заменяет commit SHA/release metadata |
| Browser baseline | production login: 4 viewport; local synthetic data: 4 home viewport, key 360px screens и smoke 17 organizer routes + admin; это не полный PRD E2E/axe |
| PostgreSQL verification | Локальный Docker/Colima и exact PostgreSQL 16.15 доступны; новый migration suite прошёл focused checks, но полное единое acceptance evidence фиксируется финальным `verify:all` |
| Secret incident | Neon role credential ротирован; disposable stand по D32 сознательно использует `neondb_owner`, `SEED_ADMIN=1`; новый seed-admin создан, credentials хранятся только в Render и переданы пользователю через локальный clipboard |
| Security dependencies | 17 production advisories: 12 high и 5 moderate |
| Route/OpenAPI inventory | source: 60 operations / 54 paths; OpenAPI: 15 operations / 12 paths (25% operation coverage); live version 0.1.0 |
| Product decisions | D23: cancel только active admin/creator; D24: creator/admin soft void без mandatory reason/second approver; D25: V1 DE preservation не требуется; D26: полный PRD v2 остаётся target |
| Documentation | immutable baseline: 48 findings; live backlog: 49 после выделения DATA-007; links/anchors/IDs/status schema проверяются автоматически |
| Релизная синхронизация | D32: прямой verified push в `main` запускает Render/Vercel native Git deploy и параллельный CI; `pnpm smoke:public` read-only ждёт одинаковый SHA/version; public API временно использует `neondb_owner` |
| Public DB bootstrap | Пользователь разрешил одноразово пересоздать `public`/`drizzle` на точном Neon target и применить `0000` с нуля; последующие releases только apply-only |
| Recovery | Существующий manual snapshot/recovery copy сохранён как ручная страховка, но не является release barrier для disposable stand |

## Главные блокеры

- Остаётся обход обязательной смены временного пароля.
- Несколько organizer-only операций проверяют только факт входа; есть IDOR между
  турнирами.
- Завершение матча, статистика и продвижение сетки не образуют одну транзакцию;
  параллельные результаты могут потеряться или повредить турнир.
- Целевая видимость событий и права start/stop/cancel не соблюдаются; D24 void с
  immutable audit и compensation ещё отсутствует.
- UI допускает потерю очка при быстром двойном нажатии и не освобождает judge lock
  при некоторых выходах.

Полный зафиксированный отчёт: [baseline audit](audits/2026-09-06-baseline.md).
Текущие приоритеты и критерии проверки: [BACKLOG.md](BACKLOG.md).

## Следующий этап

`OPS-004` достиг `verified_prod`: baseline применён к disposable public schema,
seed admin включён, CI и первый exact-SHA public release проверены. Следующий
этап — переносить product/story delta и migrations `0001–0003` небольшими
прямыми commits в `main`; рабочий delivery-контур их больше не блокирует.

SEC-001 остаётся `verified_prod`, пока нет безопасного independent old-URI
negative probe. SEC-002 исправлен локально, но ещё не выпущен; после delivery
foundation остаются P0 SEC-003/005/006/007 и DATA-001/002.
Q-MATCH-001, Q-MATCH-002, Q-DATA-001 и Q-PRODUCT-001 закрыты решениями D23–D26; BUG-002,
DATA-006 и standalone/ledger DATA-005 готовы к реализации; DATA-007 остаётся
`blocked_decision` до ответа Q-MATCH-003 о void турнирного матча с уже сыгранными
downstream matches. Полный PRD v2 закреплён D26. Одноразовый reset текущей
публичной тестовой schema явно разрешён D31; это не разрешение удалять будущие
ценные данные. Новые
продуктовые решения принимаются только через
[OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) и [DECISIONS.md](DECISIONS.md).

## Визуальный статус

Current production — временный visual regression baseline до отдельно
согласованного redesign. Figma-работа 2026-07-25 сохранена как historical
reference и не является source of truth. Подтверждённые a11y/layout defects
production не нормализуются и остаются в `GAP-011` (ADR D22).
