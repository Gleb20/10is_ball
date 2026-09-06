# Tab-10 — статус проекта

Обновлено: **2026-09-06**. Версия в корневом `package.json`: **1.10.1**.

## Итог

Сервис опубликован и отвечает, но **не готов к полноценной эксплуатации**. Базовая
цепочка login → match → judge → score и турнирный код существуют, однако аудит
обнаружил P0-дефекты безопасности, авторизации и целостности данных. Ранее
выставленные статусы фаз `done` означали наличие реализации, а не подтверждённую
готовность.

## Проверенный снимок

| Область | Состояние на 2026-09-06 |
|---|---|
| Production web/API | После credential rotation Render deploy `dep-daerpe8u01pc73fpfh80` вышел в `live`; direct и Vercel-proxied health ответили 200; Vercel не изменялся |
| Node 24 | repo, CI, Render и package engines закреплены на 24; SEC-002 validation выполнена на bundled Node **24.19.0** с pnpm 9.15.0, foundation baseline — на 24.20.0 |
| Текущий full test | shared 517 passed + 1 todo; test-utils 4 passed; web 70 passed; API 84 passed + 3 real-PostgreSQL tests skipped |
| Детерминизм | после изоляции RNG три последовательных full suite и последний Node 24 run зелёные; известный busy+bye дефект закреплён отдельным `BUG-015` characterization test |
| Local quality/build | foundation frozen install/full CI прошли на exact Node 24.20.0; SEC-002 повторил полный `pnpm run ci` на bundled Node 24.19.0 — audit gates, lint, typecheck, tests и API/web builds зелёные |
| Hosted CI | commit `f925efc`: GitHub run `34048623246` green — Quality/PGlite и PostgreSQL 16 jobs passed; evidence в `audit/evidence/hosted-ci-foundation.json` |
| Web artifact fingerprint | local build HTML/JS/CSS hashes совпали с production capture; это не заменяет commit SHA/release metadata |
| Browser baseline | production login: 4 viewport; local synthetic data: 4 home viewport, key 360px screens и smoke 17 organizer routes + admin; это не полный PRD E2E/axe |
| PostgreSQL verification | corrected hosted job `101528083822`: 3/3 passed — fresh-schema/date, concurrent `200/409` + one-time stats, final + third-place advancement; local PostgreSQL runtime отсутствует |
| Secret incident | Neon role credential ротирован, Render `DATABASE_URL` обновлён, `SEED_ADMIN=0`, 26 admin-сессий отозваны и 0 остались active; independent old-URI auth probe недоступен через plugin, поэтому SEC-001=`verified_prod` |
| Security dependencies | 17 production advisories: 12 high и 5 moderate |
| Route/OpenAPI inventory | source: 60 operations / 54 paths; OpenAPI: 15 operations / 12 paths (25% operation coverage); live version 0.1.0 |
| Product decisions | D23: cancel только active admin/creator; D24: creator/admin soft void без mandatory reason/second approver; D25: V1 DE preservation не требуется; D26: полный PRD v2 остаётся target |
| Documentation | immutable baseline: 48 findings; live backlog: 49 после выделения DATA-007; links/anchors/IDs/status schema проверяются автоматически |
| Релизная синхронизация | версия и опубликованный набор функций не подтверждены единым release artifact |

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

Внешняя ротация секрета и отзыв сессий выполнены; SEC-001 остаётся
`verified_prod`, пока нет безопасного independent old-URI negative probe.
SEC-002 исправлен и проверен локально, но ещё не выпущен; следующая реализация
начинается с оставшихся P0: SEC-003/005/006/007 и DATA-001/002.
Локальный quality baseline уже зелёный; real-PostgreSQL CI и затем browser E2E
должны подтверждать каждое core-flow исправление.
Q-MATCH-001, Q-MATCH-002, Q-DATA-001 и Q-PRODUCT-001 закрыты решениями D23–D26; BUG-002,
DATA-006 и standalone/ledger DATA-005 готовы к реализации; DATA-007 остаётся
`blocked_decision` до ответа Q-MATCH-003 о void турнирного матча с уже сыгранными
downstream matches. Полный PRD v2 закреплён D26. Ни один reset/recreate production
этой фиксацией не разрешён. Новые
продуктовые решения принимаются только через
[OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) и [DECISIONS.md](DECISIONS.md).

## Визуальный статус

Current production — временный visual regression baseline до отдельно
согласованного redesign. Figma-работа 2026-07-25 сохранена как historical
reference и не является source of truth. Подтверждённые a11y/layout defects
production не нормализуются и остаются в `GAP-011` (ADR D22).
