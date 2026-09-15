# MATCH — целевая спецификация

Структурная спецификация, не redesign. Сохраняются текущие компоненты, токены, bottom navigation, контракты, права и все функции. Схемы: `wireframes.html`; рендеры: `evidence/wireframe-create-390.png`, `evidence/wireframe-detail-390.png`, `evidence/wireframe-create-1440.png`, `evidence/wireframe-detail-1440.png`.

## T-MATCH-CREATE

**Поддерживаемые задачи:** ручные 1v1/2v2; оператор вне состава и создатель-игрок; registered/guest participants; команды, недавние и частые соперники; свои правила; optional judge; voluntary invitations; challenge/revenge prefill.

**До:** `evidence/m01-create-before-top-390.png` и `evidence/m02-quick-choices-390.png`. На 390px первая группа состава начинается на y=956.5, ниже viewport 844px. Rules/help и unscoped shortcuts предшествуют основной задаче комплектации.

**После, порядок блоков:**

1. Context: page title; challenge/revenge note when applicable; editable match title as secondary metadata.
2. Format and creator role: 1×1/2×2; `Создатель играет` only for manual flow. Changing format requests confirmation only when it would discard populated slots.
3. `Состав` card: Side A and Side B visibly separated; each required slot has Player/Guest mode and its input.
4. Row-scoped shortcuts: while a registered slot is active, show `Недавние`, `Частые`, and `Мои команды` with label `Заполнить: <slot/side>`. Team choice shows the exact eligible members and destination slots before apply. It never overwrites a nonempty slot without confirmation.
5. `Правила` disclosure, initially summarized with defaults (`до 11 · сухая 5:0 · первая подача вручную`) and expanded for editing. On wide desktop it may be a side column; DOM/focus order remains roster then rules.
6. `Согласования`: optional judge and unchecked `Пригласить выбранных игроков`; concise statement that replies do not block start.
7. Sticky/local action row: primary `Создать матч`; secondary `Отмена`. Pending freezes every payload-dependent control (BUG-026) and preserves submitted values.

**Подписи и controls:** Сохранить существующие Button, FilterBar, TextField, Autocomplete и Alert. Использовать явные headings `Сторона A`, `Сторона B`, `Правила`, `Согласования`. Не кодировать сторону только цветом. Guest hint остаётся `Имя Фамилия`; registered search после BUG-023 принимает оба порядка имени.

**Размеры и ритм:** Существующие content max-width и tokens. 390px: одна колонка, page inset 16px, внутренний gap 12–16px, touch target не менее 44px, action row над bottom navigation и safe area. Desktop: roster 2fr + rules/agreements 1fr только если каждый input остаётся не уже 280px; иначе одна колонка. Длинные имена переносятся без скрытия выбранной личности.

**Условные состояния:**

- Manual: creator unchecked by default; player selection does not create invitation.
- Challenge/revenge: creator fixed in roster and purposeful invite checked; the user can review/change allowed rules.
- 1v1 hides partner/opponent2 without retaining invisible submitted values.
- Loading/error/retry uses shared BUG-025 contract without clearing entered draft.
- Empty shortcuts state does not reserve a blank panel.
- Invalid duplicate/self/inactive/busy participant errors are attached to the slot and summarized at submit.
- Pending follows BUG-026; autocomplete focus/popup follows BUG-018; search order follows BUG-023.

**Keyboard/touch/URL:** Focus order следует видимому порядку блоков. Открытый slot владеет одним popup; Escape закрывает его и возвращает focus; выбор оставляет focus в том же slot. Browser Back из нетронутой формы работает обычно; dirty draft следует существующей политике discard-confirmation, если она будет отдельно принята. MATCH-015 сохраняется: server-side draft persistence нет.

**Сохранённые возможности:** все перечисленные задачи; custom numeric rules; manual/random/rally; optional judge; voluntary invite semantics; API payload и participant invariants.

**Нерешённые вопросы:** отсутствуют. Target уточняет принятый GAP-013 и shared BUGs, не меняя product rules.

## T-MATCH-DETAIL

**Поддерживаемые задачи:** понять status/score/participants/rules/invitations; refresh; creator start/edit/cancel; current judge score/stop/no-show; participant read-only; finished revenge/void по правам; back.

**До:** `evidence/m03-waiting-creator-390.png`, `evidence/m06-waiting-creator-1440.png` и принятый pilot `../pilot/evidence/p24-finished-390.png`.

**После, информационная иерархия:**

1. Header: match title, compact status, Refresh as secondary icon/button.
2. Score/state card: score is primary; format and rules summary; judge state; Side A/B roster grouped rather than interleaved.
3. Role/state action card directly after score:
   - waiting creator: primary `Начать матч`; secondary `Изменить`; judge entry becomes `Открыть счёт` when occupied; `Зафиксировать неявку`; destructive `Отменить матч` separated.
   - waiting current judge: primary `Судить`; secondary `Открыть счёт`; `Зафиксировать неявку`.
   - waiting participant: primary `Открыть счёт`; disabled judge takeover is explanatory text, not a competing CTA.
   - in progress creator/current judge: `Открыть счёт` or `Судить` according to ownership, then stop/no-show; cancel remains a separated creator-only destructive action.
   - finished/stopped eligible participant: primary `Реванш`; creator who was not a participant gets `Новый матч`; eligible void remains separated and destructive.
4. `Согласования` only in waiting and only when rows exist; each row carries kind/side/status and its own allowed response/reinvite.
5. `Журнал очков` after actions; empty state is compact and does not displace the start/judge decision.
6. `Назад` is navigation, not equal visual weight with the task CTA.

**Role/state contract:** Использовать наблюдаемую matrix из `evidence/m06-role-action-matrix.json`. Target не даёт participant, judge или outsider прав creator/admin. Start остаётся creator-only, invitation responses его не блокируют. Судейский score surface остаётся в JUDGE.

**Loading/error/recovery:** Skeleton или текущий shared loading state сохраняет layout. Refresh доступен при recoverable error. 403 не раскрывает title/roster. Stale mutation возвращает current server state и оставляет ясное решение о retry; automatic mutation replay запрещён.

**Keyboard/touch:** Первый focus — page heading, далее refresh, primary action, secondary actions, agreements, log, back. Закрытие dialog возвращает focus инициатору. Destructive actions всегда требуют отдельный dialog. Touch targets не менее 44px; mobile action card не перекрывается bottom navigation.

**Сохранённые возможности:** текущий action set, status visibility rules, score link, invitations, empty log, stop/no-show/cancel/void, revenge, refresh/back.

**Нерешённые вопросы:** Admin recovery исключён до решения `T-MATCH-ADMIN-RECOVERY`.

## T-MATCH-EDIT-INVITE

**Поддерживаемые задачи:** edit title/rules/valid roster до старта; понимать эффект для существующих и новых invitations.

**До:** `evidence/m04-edit-dialog-before-1440.png`, `evidence/m04-after-roster-edit-1440.png`.

**После:** Сохранить dialog и sticky footer. Поставить состав перед правилами, как в T-MATCH-CREATE. При замене зарегистрированного игрока показать над Save явное резюме:

- `Борис Бета будет удалён; его ожидающее приглашение будет отменено.`
- `Глеб Дельта будет добавлен без приглашения. После сохранения его можно пригласить отдельно.`

После сохранения блок согласований показывает creator-only строку для каждого допустимого зарегистрированного участника без действующего приглашения и одно явное действие `Пригласить`. Оно создаёт invitation через существующий авторизованный lifecycle API и заменяется статусом pending. Declined/expired строки сохраняют `Пригласить снова`. Accepted invitations неизменённых участников остаются accepted. Гости не получают account invitations. Ответы по-прежнему не блокируют Start.

**Pending/error:** Все payload controls и close/destructive escape paths следуют shared pending policy; при error dialog остаётся открытым со значениями и actionable message. Stale roster/version refresh показывает server state до retry.

**Нерешённые вопросы:** отсутствуют. Edit никогда не отправляет replacement invitations автоматически; фиксированный UI seam — явное row-scoped действие на detail.

## T-MATCH-CANCEL

**Поддерживаемые задачи:** creator/admin явно отменяет eligible standalone; optional reason; no-op close; conflict recovery.

**До:** `evidence/m04-cancel-confirm-390.png`.

**После:** Title dialog — `Отменить матч?`; body — `Матч «<title>» будет отменён без победителя и без влияния на статистику. Судейская сессия и занятость игроков будут освобождены.` Добавить multiline `Причина (необязательно)` на существующих input tokens. Buttons: secondary `Не отменять`, destructive/primary `Отменить матч`. Не использовать `аннулирован`: эта подпись зарезервирована для MATCH-016 void.

Close/X/Escape/`Не отменять` не отправляет request и возвращает focus. Confirm один раз отправляет существующий expectedVersion/idempotency contract. Pending блокирует field, close и обе actions. Success показывает `Отменён`; stale/conflict сохраняет dialog context, обновляет canonical state и объясняет следующее действие. Unauthorized не раскрывает и не включает action.

**Сохранённые возможности:** actor/state/tournament restrictions, optional reason, no winner/stats, judge/player release, idempotency, explicit confirmation.

**Нерешённые вопросы:** отсутствуют.

## T-MATCH-ADMIN-RECOVERY

**Статус:** `blocked_decision`.

**Наблюдаемый конфликт:** MATCH-017/D23/AT-MATCH-CANCEL-002 дают active admin право cancel чужого active standalone, а D17 ограничивает visibility active match организатором, участниками и current judge. Текущий detail применяет D17 и возвращает admin 403 (`evidence/m06-waiting-active-admin-outside-context-1440.png`).

**Требуется решение:** определить минимальную discovery/disclosure boundary для admin recovery. Безопасный candidate: отдельный admin lookup по точному match ID или incident context, который раскрывает только status/version/creator и последствия cancel и не добавляет active matches в общие списки. Это предложение, а не принятый target.

**Acceptance после решения:** active admin достигает cancel eligible standalone; outsider/participant/judge — нет; глобальное перечисление live events не появляется без явного решения; 403 и audit behavior остаются покрыты contract tests.
