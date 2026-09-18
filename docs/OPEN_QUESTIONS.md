# Открытые вопросы продукта и эксплуатации

Активная часть содержит только вопросы, ответ на которые нельзя достоверно
получить из текущего репозитория. Реализация, зависящая от ответа, должна ссылаться
на ID вопроса. Закрытые ID сохраняются в конце для traceability и ссылаются на ADR
либо операционное evidence.

## Q-OPS-003 — Данные и восстановление

Текущий production объявлен не содержащим ценных данных, требующих сохранения V1
DE (D25). Для будущих данных остаётся решить: когда они становятся ценными, какой
допустим RPO/RTO, где хранится backup и как подтверждается restore. Бесплатная
схема сейчас не доказывает ежедневный backup/restore. Одноразовый reset
disposable public stand для OPS-004 явно разрешён 2026-09-07 в D31; любой
последующий reset или работа с будущими ценными данными требует нового решения.

## Q-UX-001 — Закрытие окна во время построения сетки

- **Status:** open; UX-аудит, BUG-022. Не блокирует подготовительную GAP-012, где политика не меняется.
- **Evidence:** F-CMP-SUP-002: Close выглядит активным, но во время pending его callback и Escape игнорируются; footer уже disabled.
- **Question:** позволить закрыть окно, сохранив операцию и видимый progress на странице, либо честно заблокировать закрытие на ограниченное ожидание с определённым выходом при зависании?
- **Recommendation:** первый вариант для построения сетки; «Закрыть» не обещает отмену серверной операции. Single-flight остаётся на странице. Не распространять автоматически на все Dialog.
- **Decision input:** пользовательское прохождение/обсуждение после пилота; [точная рамка](audits/2026-09-13-ux-ui/dialog-target.md). До решения BUG-022 не ready; новая возможность отменить запрос на сервере не предлагается.

## Q-UX-002 — Модель необязательного аватара команды

- **Status:** open; GAP-025, F-TEAM-001. Не блокирует GAP-022/BUG-034/035.
- **Evidence:** PRD TEAM-001/003 предусматривает аватар, текущие UI/data/API поля отсутствуют. [TEAM correction](audits/2026-09-13-ux-ui/team-correction.md), [независимое review](audits/2026-09-13-ux-ui/social-review.json).
- **Question:** применять к командам существующий каталог готовых аватаров либо отдельно проектировать пользовательские изображения? D10 регулирует пользователей/гостей и автоматически не решает эту развилку.
- **Recommendation:** ограниченный существующий каталог без upload/storage как минимальная реализация; до принятия не менять PRD, данные или права. Это functional gap, а не визуальный ребрендинг.

## Q-UX-003 — Минимальный admin recovery по точному ID матча

- **Status:** open; GAP-028, F-ADMIN-004. Не блокирует каталог/историю аккаунтов.
- **Evidence:** обычный active detail корректно закрыт D17; D23 force-close разрешён active admin, но UI не имеет точки входа для чужого матча. Один direct API сценарий подтверждён в ADMIN A-RUN-007.
- **Question:** разрешить отдельный exact-ID read только id/kind/status/version и допустимого действия, без title/игроков/счёта/событий, либо оставить этот UI seam отложенным?
- **Recommendation:** минимальный lookup, без глобального live каталога. Даже title исключён из-за возможных имён. До ответа новое право чтения не принято; D17 не ослаблять. Вопрос задан пользователю, ответ пока не получен.

## Q-UX-004 — Переиспользуемый гость

- **Status:** open; gate этапов 5/7. Текущий MATCH-003 создаёт одноразового гостя.
- **Question:** кто владеет повторно используемой идентичностью, как разрешаются
  совпадения имени, будущая привязка к аккаунту, история и права видимости?
- **Boundary:** единое поле поиска не создаёт гостя автоматически при опечатке;
  существующая история не сливается без решения и миграционной приёмки.

## Q-UX-005 — Запомненное значение пользовательского счёта

- **Status:** open; gate этапа 5. Есть запрос на presets 11/21/custom.
- **Question:** custom value действует только в текущей форме, на устройстве или
  для пользователя между сессиями; как обновляется при разных форматах?
- **Boundary:** presets и цифровая клавиатура могут проектироваться без
  персистентности; хранение значения требует отдельного решения.

## Q-UX-006 — Момент создания, захвата судьи и старта

- **Status:** open; gate этапов 5/6.
- **Question:** разрешён ли объединённый create → acquire → start, кто становится
  судьёй и что происходит при частичном отказе или занятом слоте?
- **Boundary:** один active judge, actor session и существующие start rights
  остаются; видимое сокращение экранов само по себе не разрешает новую мутацию.

## Q-UX-007 — Повтор матча после результата

- **Status:** open; gate этапа 6.
- **Question:** replay создаёт новый матч с прежним составом/правилами или иной
  объект; когда допустимы изменения игроков, гостей, результата и турнира?
- **Boundary:** завершённый результат не перезаписывается; D24/D33 сохраняются.

## Q-UX-008 — Десятисекундный Undo и архив результата

- **Status:** open; gate этапа 6.
- **Question:** является ли предложенный таймер новым reversible lifecycle или
  только presentation action, что гарантирует сервер при reload/гонке/void?
- **Boundary:** без решения нет удаления/отложенной записи результата;
  D24 immutable audit и D33 downstream history сохраняются.

## Q-UX-009 — История ведущих при передаче телефона

- **Status:** open; gate этапа 6.
- **Question:** какие уже достоверно записанные сведения о ведущем показывать в
  истории и как объяснять передачу одного телефона между людьми?
- **Boundary:** входящий аккаунт, D7 и JUDGE-001 не меняются: один active judge
  и одна защищённая session. UI не обещает определить другого человека по
  факту передачи телефона и не создаёт новое право судить.

## Q-UX-010 — Дата будущего турнира

- **Status:** open; gate этапа 7.
- **Question:** является ли пожелание о будущей дате только текстом/планом или
  изменяет schedule, уведомления, таймзону и разрешённые переходы?
- **Boundary:** текущее событие не получает новое поле или контракт до решения.

## Q-UX-011 — Возврат игровых приглашений и вызовов в UI

- **Status:** open; gate для GAP-018 после временного D37.
- **Question:** когда и в каких ролях снова показывать match/tournament invites,
  challenge/revenge и ответы на старые pending записи; какие состояния и
  уведомления должны снова стать actionable?
- **Boundary:** D37 сейчас скрывает UI, но не меняет API/rows; ни autoaccept,
  ни миграция старых записей не выводятся из будущего возврата автоматически.

## Закрытые вопросы

### Q-ONB-001 — Завершение onboarding после учебного матча

**Closed 2026-09-13 by D34.** Учебный матч возвращает на последний persisted шаг; пользователь завершает обучение явно.

### Q-MATCH-003 — Void турнирного матча с downstream-результатами

**Closed 2026-09-09 by ADR D33.** Void компенсирует только статистику самого
целевого матча и добавляет immutable audit. Уже выполненное продвижение,
`bracket_json`/version, downstream matches/results/stats и notifications остаются
неизменными; cascade/replacement/repair flow не создаётся.

### Q-OPS-002 — Production release policy

**Closed 2026-09-07 by ADR D29, superseded for the current stand by D31.** Merge
в защищённый `main` публикуется native Git integrations Render/Vercel после
обязательного PR/main CI. GitHub выполняет read-only bounded monitor, а web/API
обязаны в итоге сообщить одинаковые SHA/version.

### Q-OPS-004 — Аккаунты и границы production-тестирования

**Closed 2026-09-07 by ADR D29, superseded for the current stand by D31.**
Изменяющие browser/E2E сценарии выполняются только локально/в CI на disposable
PostgreSQL. Public stand получает только read-only health/readiness/release/
proxy/OpenAPI smoke; test accounts для release gate не требуются.

### Q-OPS-001 — Статус ротации credential

**Closed 2026-09-06 by SEC-001 production execution evidence.** Neon control
plane завершил reset роли, Render использует новый credential и `SEED_ADMIN=0`,
26 admin-сессий отозваны, health после deploy зелёный. Connected Neon tool не
поддержал independent query по retained old URI; этот verification residual
остаётся в SEC-001 и не возвращает сам вопрос в active state. Secret values не
зафиксированы. См.
[`audit/evidence/sec-001-production-rotation.json`](audit/evidence/sec-001-production-rotation.json).

### Q-MATCH-001 — Права на cancel

**Closed 2026-09-06 by ADR D23.** Active standalone в `waiting`, `in_progress` или
`pending_confirmation` отменяет только active admin или creator; reason optional;
participant/judge не получает право автоматически; UI confirmation обязателен.

### Q-MATCH-002 — Авторизация void

**Closed 2026-09-06 by ADR D24.** Finished/stopped match void выполняет только
active admin или creator, без второго approver и с опциональной причиной. Это soft
invalidation с immutable audit, idempotent stats compensation и explicit UI
confirmation; hard delete запрещён.

### Q-DATA-001 — Судьба legacy V1 double-elimination

**Closed 2026-09-06 by ADR D25.** Migration/read/play preservation V1 DE не нужна;
legacy input fail closed в bounded time. Это не является разрешением на
production reset/recreate.

### Q-PRODUCT-001 — Порядок завершения MVP

**Closed 2026-09-06 by ADR D26.** Полный PRD v2 остаётся functional target;
неimplemented capability считается in-scope gap, пока отдельный ADR явно не
перенесёт его в future scope с одновременным обновлением PRD/acceptance.
