# TOURNAMENT target specification

Статус: предложение, готовое к независимому review; приложение не изменено. Основание: F-TOURNAMENT-001…005. Сохраняются текущие цвета, типографика, компоненты, 44px touch targets, single-column shell, API/status/data/permissions и все существующие функции.

## T-TOURNAMENT-ROSTER — состав как первичная работа

Поддерживаемая задача: organizer заполняет комнату и доводит её до готовой сетки.

До: [direct roster 390](evidence/screenshots/t01-roster-ready-390.png), [consent states 390](evidence/screenshots/t02-consent-roster-states-390.png). После: [annotated 390/desktop](annotated-before-after.html).

Порядок в `collecting`/`needs_regeneration`:

1. Заголовок, status chip и format.
2. Компактная карточка «Настройки и правила» с текущей сводкой и существующим «Изменить» только для organizer.
3. Policy note: direct или consent, без изменения текста/семантики D35.
4. «Участники (N)»: active roster; затем pending/declined invitations; затем существующие add registered/guest controls по текущим правам.
5. Основное действие после состава: `Построить сетку` или `Перестроить сетку`. Algorithm Dialog сохраняется.
6. «Управление турниром» после основной работы: destructive cancel как danger/secondary action с подтверждением T-LIFECYCLE.

В direct `consent=false + collecting + organizer` выбор stable user ID и `Добавить в состав` сразу выполняют ровно один существующий POST. Native confirm отсутствует только в этой клетке. Confirm обязателен при `requireConsent=true`, scoped-admin override или `bracket_generated/needs_regeneration`; текст сохраняет имя человека, название турнира, consent override и/или regeneration consequence. Guest add не меняется.

390/360: одна колонка, существующие page/card spacing и ширины; BottomNav reserve сохраняется. Desktop: тот же порядок и текущий max-width shell, без dashboard grid. Long names переносятся; action label не обрезается. Picker состояния loading/empty/error/pending и keyboard/focus принадлежат BUG-018/019/020/023 и не форкаются.

## T-TOURNAMENT-ROOM — операционная комната по статусу

| Статус | Первичная информация | Primary action | Summary |
|---|---|---|---|
| collecting | правила, policy, roster/invitations | построить сетку | скрыт |
| needs_regeneration | причина готовности + roster | перестроить сетку | скрыт |
| bracket_generated | roster, сетка, собственный следующий матч | старт (organizer) | скрыт |
| in_progress | текущие матчи, собственный current/next, сетка | открыть/судить допустимый матч | скрыт |
| stopped | причина, сетка на момент остановки | открыть сыгранный матч | виден; места остаются `—`, если не определены |
| finished | чемпион, сетка, сыгранные матчи | открыть матч | виден с top3/places/points |
| cancelled | статус и сообщение отмены | нет | виден только если DTO содержит содержательный terminal context; пустую таблицу не показывать |

`Итоги` не рендерятся в collecting, needs_regeneration, bracket_generated или in_progress, даже если DTO уже содержит нулевой summary. Withdrawn участники остаются в authoritative history, но не возвращаются в active roster. В terminal summary они показываются только по действующему серверному result contract; клиент не пересчитывает места.

Organizer, participant и scoped-admin видят один и тот же статус/summary contract; controls остаются role-scoped. Outsider initial 403 остаётся полноэкранным retryable error. Refresh сохраняет текущую route и не очищает известный tournament при transient refresh error.

## T-TOURNAMENT-LIFECYCLE — защищённые переходы жизненного цикла

Использовать существующий `Dialog`, не native confirm.

- `Отменить турнир`: title «Отменить турнир?»; body называет турнир и сообщает «Продолжить этот турнир будет нельзя»; primary danger `Отменить турнир`; secondary `Оставить турнир`; Escape/close = no mutation.
- `Распустить сетку`: title «Распустить сетку?»; body «Состав сохранится, текущая сетка и расстановка будут удалены»; primary `Распустить сетку`; secondary `Оставить сетку`.
- Participant withdraw при `bracket_generated`: title «Выйти из турнира?»; body называет турнир и сообщает «Организатору придётся перестроить сетку»; primary `Выйти`; secondary `Остаться`.
- Participant withdraw в `collecting`: существующее быстрое действие без modal. После `in_progress` action по-прежнему отсутствует/отклоняется сервером.

Focus: opening moves focus to dialog heading/first safe control per existing pattern; Tab is trapped; Escape closes; close returns focus to exact trigger. Pending disables both repeat confirm and outside trigger; content and named consequence remain visible. Known failure stays inside open dialog with retry/cancel per BUG-021/022. Success closes dialog, announces result and refreshes authoritative state. Unknown network outcome does not invite blind repeat; refresh/reconcile first.

No API/type/data changes. Authorization remains server-side; visibility never substitutes a guard.

## T-TOURNAMENT-BRACKET — обзор и навигация сетки

Existing zoom values become exactly `75%, 100%, 125%, 150%` with 25-point steps. Default remains 100%. Minus is enabled at 100 and disabled at 75; plus disabled at 150. The visible text remains the current percentage and the controls retain band-specific accessible names.

At 75% cards preserve player name, seed, score/status, BYE explanation and match-open action. If text no longer meets current readable size, the implementation fails acceptance; do not solve it by hiding content. Arrow buttons move one viewport segment; Home/End reach exact bounds; focused scroll region keeps the existing 3px visible outline. Horizontal scroll remains the only spatial navigation; no mini-map, pinch gesture, new renderer or topology change.

Check separately for Winners, Losers and third-place bands at SE/DE 3/5/8, 360×800, 390×844, 844×390 and 1440×900. No page-level horizontal overflow; band scroll may overflow.

## Loading, empty, error and recovery

- Initial tournament load: current skeleton, then content or role-appropriate error with Refresh.
- Roster empty: current explanatory state plus add controls; build disabled until server minimum.
- Mutation known failure: preserve current tournament and input; action-local error near the initiating block/Dialog.
- Mutation pending: freeze submitted target/action, block duplicate invocation, do not hide consequence text.
- Stale session/401: existing auth recovery; do not show destructive success.
- 403: current «Недостаточно прав» initial error or action-local error when context is already known.

## Preserved capabilities and exclusions

Preserved: SE/DE, compact/power-of-two, organizer participation, direct/consent policy, team additions/notifications, guest/registered roster, invitation terminal states, seed swap/prefix, BYE, V1 read compatibility, start/current/next/judge links, stop reason, cancel/dissolve/withdraw, finished/stopped results, role and concurrency guards.

Excluded: new tournament format, bracket minimap, automatic seeding, invite policy change, undo cancel, schema/API migration, broad admin powers, brand redesign, duplicate Autocomplete implementation. Open decisions: none for review of this target; acceptance of each implementation task remains a separate coordinator decision.
