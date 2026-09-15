# COMPONENTS post-GAP 012 candidate recheck

## Итог

На чистой review-копии GAP 012 r3, собранной поверх `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221`, повторно подтверждены все семь прежних runtime findings `F-CMP-001..005` и `F-CMP-SUP-001..002`. `F-CMP-SUP-003` повышен из source hypothesis до runtime defect с high confidence: реальная ошибка начисления очка остаётся `rgb(176, 0, 32)` на `rgb(15, 17, 21)`, то есть `2.58:1`.

В новых GAP 012 consumers найдены ещё два bounded component-contract дефекта: UserPicker не отличает pending directory от готового пустого списка и остаётся активным после ошибки; во время create/override mutation зависимые policy/selection controls остаются изменяемыми после отправки payload. Нативное override-подтверждение, cancel без POST, сохранение выбора после ошибки, значения новых checkbox и persisted creator-absent/no-invitations policy прошли.

Это **candidate-only evidence**, а не финальная приёмка GAP 012: на старте аудита полный browser gate ещё выполнялся независимо. App bytes не менялись; canonical backlog и исходные frozen packages не затронуты.

## Матрица повторной проверки

| Finding | Candidate verdict | Ключевое actual evidence |
|---|---|---|
| `F-CMP-001` | REPRODUCED, P1 high | Player A сообщает `aria-activedescendant="_r_c_-option-0"`, active option имеет `id=null`; `document.getElementById(...)` отсутствует |
| `F-CMP-002` | REPRODUCED, P2 high | desktop option `y=1039.39` при viewport bottom `1000`; fixed nav начинается `y=937.81`; touch390 в проскролленном состоянии не перекрыт |
| `F-CMP-003` | REPRODUCED, P2 high | create Enter: id `_r_c_→_r_e_`, focus `false`; edit directory resolve: `_r_m_→_r_q_`, focus потерян |
| `F-CMP-004` | REPRODUCED, P2 high | focused raw Autocomplete input имеет собственный `3px` outline внутри rounded wrapper; radio input также получает raw outline |
| `F-CMP-005` | REPRODUCED, P3 high | selected+focused card: `2px` border + `1px` box-shadow + `2px` outer outline |
| `F-CMP-SUP-001` | REPRODUCED, P2 high | controlled bracket 503 оставляет Dialog открытым; page Alert под overlay, геометрически пересекается с modal |
| `F-CMP-SUP-002` | REPRODUCED, P2 high | pending Close: `disabled=false`, `cursor=pointer`, focus-visible; click и Escape не закрывают Dialog |
| `F-CMP-SUP-003` | RUNTIME-CONFIRMED, P2 high | controlled point-write 503 создаёт настоящий `.judge-error`; вычисленный contrast `2.58:1` |

Основной raw evidence: [runtime-states.json](evidence/runtime-states.json). Representative viewport captures: [desktop Autocomplete](evidence/screenshots/match-create-option-active-1440.png), [touch390 Autocomplete](evidence/screenshots/match-create-option-touch-390.png), [edit remount](evidence/screenshots/match-edit-player-a-1440.png), [radio-card](evidence/screenshots/bracket-selected-focused-1440.png), [pending Dialog](evidence/screenshots/bracket-pending-dialog-1440.png), [скрытая ошибка Dialog](evidence/screenshots/bracket-error-occluded-1440.png), [dark judge error](evidence/screenshots/judge-error-dark-1440.png).

## F-CMP-R-001 — UserPicker не сообщает pending и оставляет недоступный directory интерактивным

- **Kind / priority / confidence:** `runtime_defect`; **P2**, high; observed `1/1` held request и `1/1` controlled failure.
- **Where:** scoped admin `/tournaments/:id`, новый registered-player UserPicker, desktop 1440.
- **Actual:** при удержанном initial directory GET combobox `disabled=false`, options `0`, role=status отсутствует. После controlled 503 появляется `role=alert`, но combobox остаётся enabled и focused; retry action отсутствует.
- **Expected:** pending явно отличим от ready-empty и исключает ложный выбор; error связывается с control, предоставляет retry либо честно блокирует недоступный picker.
- **Impact:** пустой список выглядит как валидный результат, а после ошибки control продолжает обещать действие, которого данные не поддерживают.
- **Overlap:** отдельная подтверждённая coordinator finding `F-PREP-001` / reserved `BUG 023` покрывает order-independent поиск по visible label. Здесь не создаётся её duplicate: этот finding ограничен loading/error contract.
- **Evidence:** [pending](evidence/screenshots/admin-picker-pending-1440.png), [error](evidence/screenshots/admin-picker-error-1440.png), states `ADMIN-PICKER-PENDING/ERROR`.
- **Smallest remedy:** передавать в UserPicker explicit `loading/error/retry`; показывать status, `aria-busy`, и согласованно disable/read-only picker до ready; сохранить существующие exclude rules.

## F-CMP-R-002 — In-flight mutation не замораживает зависимые policy/selection controls

- **Kind / priority / confidence:** `runtime_defect`; **P2**, high для observed state, medium для частоты пользовательского рассогласования.
- **Where:** `/matches/new` checkbox «Создатель играет» / «Пригласить выбранных игроков» и scoped admin override UserPicker.
- **Actual:** при удержанном match POST submit disabled, но оба policy checkbox остаются enabled. При удержанном override POST action button disabled, но picker остаётся enabled с выбранным значением. Запрос уже содержит предыдущий payload, поэтому последующая визуальная правка не может повлиять на in-flight mutation.
- **Expected:** все controls, определяющие уже отправленный payload, заморожены до success/error либо UI явно показывает immutable submitted snapshot.
- **Impact:** пользователь может увидеть состояние формы, отличное от реально применяемой политики/участника, и принять его за сохранённое.
- **Evidence:** [match pending](evidence/screenshots/match-create-pending-1440.png), [override pending](evidence/screenshots/admin-override-pending-1440.png), states `MC-PENDING-1440` и `ADMIN-OVERRIDE-PENDING`.
- **Smallest remedy:** единый pending boundary для submit-dependent fields; disable policy checkbox и UserPicker вместе с action, сохранив значения для recovery после error.

## Что прошло и должно быть сохранено

- Manual match create по умолчанию: creator participation `false`, invitations `false`, Player A видим.
- Checkbox keyboard round-trip сохраняет focus и возвращает исходное unchecked состояние; tournament consent toggle также keyboard-operable.
- Browser submit и API readback подтвердили: creator отсутствует в participants, `sendPlayerInvitations=false` сохранён.
- Override warning содержит имя, турнир, manual consent override и немедленную regeneration consequence; dismiss даёт `0` participant POST.
- После controlled override error выбор сохранён, action снова доступен.
- Touch390 option полностью видим над BottomNav и выбирается tap; 360 и 390 captures не имеют horizontal overflow.
- Все четыре намеренных failure diagnostics отделены от неожиданных; неожиданных console errors/page errors — `0`.

## Ограничения

- Не выполнялись physical iOS/Android, virtual keyboard, Safari/WebKit, Firefox/Edge, VoiceOver/TalkBack и spoken-AT spot-check.
- Browser UI zoom 200% **NOT_TESTED**: headless Playwright context не предоставляет честный механизм управления browser zoom. CSS `zoom` намеренно не использовался и не объявляется заменой.
- Touch390 — Chromium mobile/touch emulation; ввод текста после tap выполнялся automation text injection, не экранной клавиатурой устройства.
- Проверка ошибки судьи ограничена одним synthetic point-write 503; полный прежний match scenario не повторялся.
- Контрастный вывод относится к фактически снятой паре foreground/background; это не blanket WCAG pass.
- Полный CI не выполнялся по согласованному scope; выполнены candidate build, hash verification, migrations и bounded runtime checks.
