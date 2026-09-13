# Tab-10 — статус проекта

## Release 3.0.0 — pre-publication checkpoint, 2026-09-13

Пользователь подтвердил выпуск. Свежий полный `pnpm run verify:all` на версии
**3.0.0: 1249/1249 PASS**, без failed/skipped/todo/interrupted; 449 файлов
сохранили идентичность во время проверки. [Релизное evidence](audit/evidence/release-3.0.0-local.json).
Следующий шаг этого checkpoint: commit/push main по D32, hosted CI и GET-only
exact-SHA smoke web/API/proxy. Публикация пока не заявлена. Ниже — предыдущая
приёмка и её сохраняющиеся WebKit/device/AT ограничения.


Обновлено: **2026-09-13**. Текущий локальный кандидат D+E+F и BUG-017 принят
основным gate **1249/1249**. Предыдущая версия под тестом2.1.0, base615169c; это dirty
кандидат, не новый опубликованный release. Публичная2.1.0 известна из прежнего
exact-SHA smoke и в этой приёмке заново не проверялась.

## Текущая приёмка

- `pnpm run verify:all`: quality1122, PostgreSQL66, browser57
  (48 desktop/mobile journeys +9foundation), cleanup4; ноль ошибок/пропусков.
- F16 файлов и отдельное исправление WaveB period fixture проверены независимым
  review. Snapshot447 файлов не изменился во время полного gate.
- BUG-017:409 вместо500 при судействе из второй сессии; verified_local.
- Дополнительно Playwright Firefox155.0:7/7. WebKit26.6:7 падений native runtime
  при создании страницы до проверок приложения. Общий compatibility lane failed,
  исходники/сборка689 файлов сохранены, disposable resources удалены.
- GAP-011/TECH-002 остаются in_progress для WebKit, последних двух версий
  браузеров, реальных iOS/Android/safe-area/keyboard и screen-reader acceptance.
  Axe22 Chromium +11 Firefox reports без violations; incomplete не объявлены PASS.

[Полное локальное evidence](audit/evidence/wave-f-local.json),
[ограничения совместимости](audit/evidence/wave-f-compatibility.json),
[очередь и handoff](test-plans/OPS-004-coordinator-handoff-2026-09-13.md).
Оригинальное dirty-дерево сохраняется отдельно. Пользователь явно подтвердил выпуск3.0.0; root version обновлена. Новый локальный gate, commit/push и exact-SHA public/CI проверка ещё предстоят. Прежнее ожидание approval снято этим подтверждением.

Ниже сохранены исторические этапы; их прежние pending/counts не заменяют текущую
приёмку выше. Q-OPS-003 и независимый negative probe SEC-001 остаются отдельными
известными ограничениями, не скрываются общим зелёным gate.

## История этапов и прежние снимки

Выполняется принятый план завершения PRD v2 волнами A–F:
[очередь и критерии приёмки](test-plans/OPS-004-completion-waves.md).
Волны A и B опубликованы. Для B GET-only smoke подтвердил
`8f36941b283a678105558656b1fb3b343546d999`, version `2.0.0` у web/API/proxy;
GitHub CI `34728440590` завершился success во всех четырёх jobs.
Функциональные сценарии проверены на локальных синтетических данных;
public smoke подтверждает идентичность релиза и доступность, без мутаций.

Wave B GAP-002/003/004: `verified_local`, полный `verify:all` — 1010/1010
(quality 945, PostgreSQL 42, browser 19, cleanup 4), без failed/skipped/todo/interrupted.
Повторный browser gate с проверкой загруженной карточки — 19/19.
Desktop/390 profile, rankings и history return просмотрены.
[Обезличенные доказательства](audit/evidence/wave-b-local.json).
Исходные 186 файлов сохранены без изменений.

## Волна D принята локально — кандидат 3.0.0

GAP-006 `verified_local`: настройки и invalidation/regeneration сетки, seed/BYE
swaps, organizer-owned start/stop/cancel/dissolve, V2 SE/DE 3/5/8, persisted
summary с current/next, duration, results, top-3 и персональным highlight. Причина
остановки вводится и сохраняется; stopped tournament не получает places/top-3,
а D33 void исключается из статистики без разрушения bracket places.

GAP-007 `verified_local`: team create/detail/edit, welcome, invite history и
respond, captain transfer, member removal, leave, automatic archive и использование
active own team в event picker. Privacy-safe DTO и transactional PostgreSQL tests
проверяют current/former/pending access, captain invariants и atomic
block→captain reassignment/archive.

Первый полный aggregate прошёл **1133/1133**. Последующий rendered review обнаружил
ложную подсказку о следующем auto-BYE матче в завершённом турнире; regression был
Red, исправление прошло 17/17 focused tests и web typecheck. Финальный aggregate
после исправления прошёл **1135/1135**: quality 1034, PostgreSQL 56, browser 41
(32 journeys + 9 foundation), cleanup 4, без failed/skipped/todo/interrupted.
Desktop и 390px исправленного terminal state, а также landscape bracket просмотрены.
[Доказательства](audit/evidence/wave-d-local.json). Исходные 186 файлов сохранены
без изменений. Публичного Wave D release нет; root остаётся на 2.1.0 до отдельно
одобренного direct release 3.0.0.

## Волна C принята локально — кандидат 2.1.0

GAP-005 verified_local: полный `verify:all` **1056/1056** (quality980,
PostgreSQL47, browser25, cleanup4), ноль ошибок/пропусков. 16 compiled browser
journeys включают создание 2×2, неявку/реванш, коррекцию/Undo/передачу судейства
и отдельные сессии создателя и судьи. Desktop/390 captures просмотрены.
[Доказательства](audit/evidence/wave-c-local.json). Публикация подтверждена: main615169c, CI34730792219 all four jobs success, GET-only exact-SHA smoke web/API/proxy; Neon ledger5 и новые поля подтверждены read-only.
Это утверждение описывало состояние после Wave C и теперь частично superseded:
GAP-006/007 локально проверены в Wave D; GAP-008..011
и полный TECH-002 остаются в очереди E–F.

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

Следующий локальный шаг — завершить и проверить consent delta Wave E, затем
последовательно выполнить aggregate/browser acceptance E и отдельную Wave F.
Публикация требует отдельно одобренного изменения версии, hosted CI и exact-SHA
public smoke. До подтверждения root-версия остаётся 2.1.0; последнее публичное
evidence также относится к 2.1.0.
Одноразовый reset по D31 не повторяется: применяются только immutable forward
migrations.
Новые продуктовые решения принимаются только через
[OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) и [DECISIONS.md](DECISIONS.md).

## Визуальный статус

Current production — временный visual regression baseline до отдельно
согласованного redesign. Figma-работа 2026-07-25 сохранена как historical
reference и не является source of truth. Подтверждённые a11y/layout defects
production не нормализуются и остаются в `GAP-011` (ADR D22).
