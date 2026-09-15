# RESULTS — целевая спецификация

Статус пакета: **READY_FOR_REVIEW**. Это спецификация будущего изменения, не реализация и не принятая каноническая задача. Базовая визуальная система и права Tab-10 сохраняются.

## Общие инварианты

- Не расширять видимость истории, профилей и событий; server guards остаются источником прав.
- `userId` и историческая judge session не доказывают владение текущей auth-session. Score/undo/finish/release требуют действующего active judge.
- Creator-only start по D18 сохраняется; свободный слот сначала захватывается через acquire.
- D10 сохраняется: email/avatar не редактируются, аватар — существующий статический preset.
- Pending invitation после read остаётся actionable; terminal notification не получает actions/popup.
- Tutorial не входит в историю, статистику, рейтинг и rival; завершение onboarding меняется только явным D34 action.
- Не удалять ни одну из пяти метрик Home, rival/revenge, ranking period, recent events, profile или notifications.

## T-RESULTS-HISTORY-001 — различимая и воспроизводимая история

**Поддерживаемые задачи:** найти матч по сопернику, сузить период/роль/результат/тип, продолжить список, открыть детали и вернуться.

**Before:** `evidence/runtime/history-search-390.png`, `evidence/runtime/history-pagination-error-360.png`.

**After:** `wireframes.html#history-390` и `wireframes.html#history-1440`; renders `evidence/target-wireframes-390.png`, `evidence/target-wireframes-1440.png`.

**Информация и действия:**

1. Заголовок и существующая кнопка `Фильтры`.
2. Поле `Поиск по сопернику или турниру` + primary `Найти`.
3. Applied-condition chips в одной области: `Соперник: …`, `Роль: …`, `Результат: …`, `Тип: …`, `Период: …`; общий secondary `Сбросить`.
4. Строка события: title; для match — `counterpartyLabel`, дата/время Europe/Moscow, `1×1|2×2`, роль; затем score/result и status. Для tournament — название, дата, формат, роль, place/result при наличии.
5. `Показать ещё` остаётся отдельным full-width secondary; pending меняет label на `Загрузка…`, старые строки не скрывает; ошибка следующей страницы расположена рядом с кнопкой и даёт `Повторить`.

**Contract delta:** добавить в history match item один display-only `counterpartyLabel` (для 2v2 — противоположная сторона, с корректным long-text wrapping). `occurredAt`, `roles`, `format`, score/result/status уже существуют. Данные вычисляются только внутри уже разрешённой сервером строки; новый endpoint и новые права не нужны.

**URL/Back:** `q`, `role`, `result`, `eventType`, `from`, `to` синхронизируются с query string через replace при apply/reset. Opaque cursor в URL не помещается. Refresh/direct link восстанавливают первый page того же набора; detail→Back сохраняет actor-scoped loaded pages/cursor как сейчас. При actor switch return snapshot игнорируется.

**Размеры:** существующий page max-width; controls используют текущие tokens; touch target не менее 44×44. На 390/360 поле и CTA могут занимать одну строку только при сохранении 44px и readable input; иначе CTA переносится на следующую. Строка не обрезает имя многоточием до потери различимости — допускает 2 строки.

**Keyboard/focus:** tab order `Фильтры → Поиск → Найти → chips/reset → rows → Показать ещё`. Dialog возвращает focus в `Фильтры`. После pagination retry focus остаётся на `Повторить/Показать ещё`; список не перехватывает focus. Back возвращает focus к открытой строке при её наличии.

**States:** initial loading заменяет только list; empty отличает `истории нет` от `ничего не найдено`; initial error имеет `Повторить`; page error сохраняет строки; long names/dates wrap; 360px и 200% browser zoom требуют отдельной проверки.

**Given/When/Then:**

- Given 22 завершённых событий и search by opponent, When результаты показаны, Then каждая match row называет counterparty и оставляет видимыми date/role/format/result/status.
- Given applied filters, When страница reload/direct-open, Then query воспроизводит тот же первый набор.
- Given загружена следующая page, When detail→Back, Then строки, cursor и focus target восстановлены.
- Given next-page 503, When ошибка показана, Then предыдущие строки остаются и retry использует тот же cursor один раз.
- Given другой actor, When открывается history, Then snapshot предыдущего actor не виден.

**Verification:** contract tests, HistoryPage focused tests, PostgreSQL cursor/date integration, Chromium 390/1440/360 keyboard/long text; WebKit/physical mobile/spoken AT отдельно.

## T-RESULTS-PROFILE-001 — локализованная ошибка редактирования

**Поддерживаемые задачи:** изменить разрешённые поля, понять ошибку, исправить, пережить reauth, завершить другую сессию.

**Before:** `evidence/runtime/profile-validation-error-390.png`.

**After:** `wireframes.html#profile-390` и общий desktop render.

**Структура:** top-level summary alert остаётся для server/general failure, но конкретная validation error показывается под первым неверным полем. Поля получают limits из канонического client schema: имя/фамилия 100, организация/должность 200; дата — валидная календарная дата. `Email` и avatar note остаются read-only.

**Invalid state:** input имеет `aria-invalid=true`, `aria-describedby=<field-error-id>`; error text называет правило и текущую длину при length error. После failed submit focus один раз переводится в первое invalid field; typing не вызывает повторного focus jump. Draft не очищается.

**Pending:** submit/cancel и editable fields, относящиеся к отправленному payload, disabled; read-only profile/sessions остаются видимы. Success обновляет authoritative profile и закрывает form. General 5xx сохраняет draft и focus на summary retry context.

**Reauth:** тот же actor возвращается на `/profile` с тем же in-memory draft; mutation не replay. Другой actor получает чистое состояние и не видит draft. Session revoke остаётся отдельным confirm Dialog; текущую session можно закончить только logout.

**Given/When/Then:**

- Given 201 chars in organization, When submit, Then no network mutation is needed, field error is associated and focused, draft stays.
- Given server rejects a canonical value, When response arrives, Then draft stays and mapped field/general error is visible without auto retry.
- Given runtime 401, When same actor authenticates, Then draft is preserved and submit attempts remain one.
- Given different actor authenticates, Then previous draft and protected response are cleared.
- Given revoke another session, When confirm pending, Then both dialog actions are disabled; success removes exactly that row.

**Verification:** schema tests, ProfilePage/auth-recovery tests, live Chromium 390/1440 keyboard/pending/error; spoken AT separately.

## T-RESULTS-NOTIF-001 — согласованный read/actionable lifecycle

**Поддерживаемые задачи:** увидеть требующие внимания события, прочитать, принять/отклонить, понять terminal reason.

**Before:** `evidence/runtime/notifications-actual-after-read-390.png`, `evidence/runtime/notifications-history-390.png`.

**After:** `wireframes.html#notifications-390`.

**Фильтр:** effective actual row = `actionable === true OR (lifecycle === new AND readAt == null)`. После успешного read-visible local state обновляет `readAt`; non-actionable new получает effective `read` и сразу выходит из Actual. Pending invitation остаётся, получает `Прочитано`, сохраняет accept/decline. Terminal `expired|cancelled|declined|accepted` находится только в history mode и показывает reason/time без действий.

**Labels:** checkbox label заменить на явно описательный `Требуют внимания`, если независимый review подтвердит, что это не меняет продуктовый смысл; иначе оставить `Актуальные` и добавить короткую note `непрочитанные и приглашения с действием`. Это единственный `blocked_decision` в пакете: copy choice, не поведение. Реализация functional fix от решения copy не зависит.

**Pending/error:** read-visible не блокирует invitation actions; action mutation single-flight disables только action buttons. Ошибка action остаётся у карточки/группы и не удаляет row. Refresh не требуется для корректности, только для server refresh.

**Given/When/Then:**

- Given unread non-actionable new row, When batch read succeeds, Then label becomes `Прочитано` and row immediately leaves checked Actual.
- Given unread pending invitation, When batch read succeeds, Then badge/read state clears but accept/decline remain.
- Given TTL/source deletion/decline, Then history retains reason/time, no actions, no popup.
- Given actor switch during response, Then old rows/redirects never enter new actor state.

**Verification:** NotificationsPage component tests including local read-visible transition, API lifecycle tests, Chromium 390 pending/read/terminal/stale destination; expired fresh-login popup. Physical mobile and spoken AT separately.

## T-RESULTS-HOME-001 — действие у стола и честный статус судьи

**Поддерживаемые задачи:** быстро продолжить активное событие или начать новое; затем проверить уведомления, личные результаты и историю.

**Before:** `evidence/runtime/home-results-390.png`, `evidence/runtime/home-results-1440.png`.

**After:** `wireframes.html#home-390` и `wireframes.html#home-1440`.

**Order (GAP-015 refinement):** greeting/refresh → active standalone/tournament or `Начать` → notification/profile entries → compact personal block with all five metrics + rival/revenge → ranking with selected period → recent five → all history. Empty active state contains `Начать`; do not duplicate competing primary CTAs.

**Judge semantics:** Home DTO separates `currentJudgeName/judgeSlotStatus` from `actorHistoricalRole`. If `activeJudge=null` after release, card says `Слот судьи свободен · Ранее судили`; it links only to detail. Detail requires `Судить`/acquire before any judge mutation. If another auth session of the same user owns the slot, this session still does not receive score rights. If current session owns it, detail exposes the existing continue judge flow.

**Responsive hierarchy:** on 390/360 active card and its status are above fold after heading; metrics remain a compact 2-column grid below entries. On desktop the same reading order remains in the centered app shell; no separate dashboard IA. Long sides/winner/judge wrap before status chip.

**Given/When/Then:**

- Given populated Home, Then five metrics, rival/revenge, ranking period, recent five, notifications and profile all remain present after reorder.
- Given current judge session, When opening active card, Then existing judge continuation is available.
- Given released judge and `activeJudge=null`, Then Home says slot free/former relation, detail first offers acquire, and no score request is possible before it.
- Given historical judge userId matches but auth-session does not, Then no ownership is inferred.
- Given no active event, Then one primary `Начать` is presented with explanatory empty text.

**Verification:** Home DTO contract tests for current/foreign/released/same-user-different-session cases; browser 390/1440/360 order/focus/long text/loading/empty/error. No API authorization change.

## Screens without target delta

Ranking periods, team scope, podium/list, own/public profile privacy/challenge, session revocation, tutorial isolation and terminal notification history passed the scoped evidence. Their existing behavior is a preservation constraint, not a redesign target.

## Untested requirements

- Physical mobile device, WebKit layout/behavior, spoken screen reader and true browser 200% zoom: **NOT_TESTED**.
- DST/week boundary fixture for rankings: **NOT_TESTED** in this RESULTS run (existing tests are not reclassified as this browser evidence).
- Guest contribution to ranking and browser-rendered empty Home: **NOT_TESTED** here; focused existing tests only where recorded.

## Unresolved decisions

- Optional copy only: `Актуальные` versus `Требуют внимания`. Functional lifecycle target is unblocked and concrete; coordinator may retain current label to avoid a product-copy decision.
