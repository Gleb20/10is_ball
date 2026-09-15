# Аудит общих состояний компонентов

## Итог

На замороженной версии `3.0.0` / `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221` подтверждены **5 находок: 1×P1, 3×P2, 1×P3; P0 нет**. Наиболее значимый разрыв — сломанная связь `aria-activedescendant` в vendored `ic-kit` Autocomplete. Отдельно клавиатурный выбор страдает от перекрытия fixed navigation и от потери фокуса после Enter.

Проверка не меняла приложение, canonical backlog или публичный стенд. Все данные synthetic, база одноразовая. `runtime-states.json`: 33 актуальных screenshots, 27 state snapshots, 10/10 horizontal-overflow checks, 0 page errors, 0 неожиданных console errors. Восемь ожидаемых console diagnostics — шесть намеренных 401 при auth/session probes и два `net::ERR_FAILED` от специально удержанных и прерванных pending requests.

## F-CMP-001 — Autocomplete ссылается на несуществующую активную опцию

- **Kind / priority / confidence:** `runtime_defect`; **P1**, high. Основной клавиатурный путь визуально работает, но DOM не предоставляет существующий target для объявляемой активной опции; это создаёт высокий риск неверного AT feedback. Фактическая spoken-фраза не проверялась.
- **Where:** `/matches/new`, `ic-kit Autocomplete`, active user, open+keyboard-active, desktop 1440×900; общий корень в vendored компоненте.
- **Actual / expected:** input сообщает `aria-activedescendant="_r_8_-option-0"`, тогда как активный `li[role=option]` имеет `id=null`. Ожидается существующий уникальный `id`, совпадающий с `aria-activedescendant`, при каждом изменении active index.
- **Reproduction:** войти synthetic active user → открыть «Новый матч» → в поле «Соперник» ввести часть длинного имени → `ArrowDown` → инспектировать combobox и активный option.
- **Evidence:** [полный кадр](evidence/screenshots/light-1440-autocomplete-keyboard-option.png), `runtime-states.json` states `light/autocomplete/open-keyboard-focus` и `light/autocomplete/keyboard-active-option`; `packages/ic-kit/dist/ic-kit.js:8620-8635` не назначает `id` option, но `:8884-8889` формирует ссылку на него.
- **Impact / frequency:** подтверждено 1/1 открытий с keyboard active option; потенциально затрагивает каждый Autocomplete. Spoken output не прослушивался, поэтому точная фраза AT неизвестна, но DOM-ссылка детерминированно неразрешима.
- **Overlap:** `GAP-011`, A11Y checklist open spoken-AT breadth; отдельного принятого требования на неверную семантику нет.
- **Smallest remedy:** в `ic-kit` назначить каждому option `id={`${comboboxId}-option-${index}`}` и сохранить текущие `role=option`, `aria-selected`, disabled behavior, mouse/touch selection и listbox ownership. Добавить component test: active descendant существует и меняется на ArrowUp/Down.
- **Target / validation:** [T-CMP-AUTO-001](target-spec.md#t-cmp-auto-001--autocomplete-клавиатура-и-видимость), согласованный с [WAI-ARIA APG Combobox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/); нужен Chromium accessibility snapshot и spoken AT spot-check. Reviewer verdict: pending.

## F-CMP-002 — Клавиатурная active option скрывается fixed navigation

- **Kind / priority / confidence:** `runtime_defect`; **P2**, high для проверенной геометрии. Пользователь не видит текущий вариант и вынужден менять scroll без уверенности, какой Enter будет выбран.
- **Where:** `/matches/new`, Autocomplete + `BottomNav`, active user, open+active option, desktop 1440×900.
- **Actual / expected:** focused input имеет viewport `y=870…914`, fixed navigation занимает нижнюю область примерно `y=838…900`, active option начинается с `y=939`. Поле частично перекрыто, а активная опция полностью за viewport; когда она видима, её единственный cue — `rgba(7,7,7,0.03)` без outline/marker. Ожидается видимый focused control и текущий option с collision-aware размещением, scroll reserve и устойчивым active cue, отличным от выбранного.
- **Reproduction:** открыть `/matches/new` без ручного позиционирования → сфокусировать «Соперник» у нижнего края → ввести запрос → `ArrowDown`. Первый option получает `data-active=true`, но находится ниже viewport; close-up самого элемента фиксирует перекрывающую nav.
- **Evidence:** [полный кадр](evidence/screenshots/light-1440-autocomplete-keyboard-option.png), [перекрытие close-up](evidence/screenshots/light-autocomplete-keyboard-option-occluded-closeup.png), runtime rects в `runtime-states.json`.
- **Impact / frequency:** 1/1 в воспроизведённой позиции; зависит от scroll/viewport, поэтому глобальная частота неизвестна.
- **Overlap:** `GAP-011`; A11Y checklist отдельно предупреждает, что обычный full-page capture не доказывает fixed-nav geometry — здесь вывод дополнительно опирается на `getBoundingClientRect`.
- **Smallest remedy:** сохранить fixed nav, но дать main/focus targets нижний reserve (`scroll-padding`/`scroll-margin` не меньше nav+safe-area) и в Autocomplete реализовать collision strategy: flip menu вверх или clamp высоту со scroll так, чтобы active option всегда `scrollIntoView({block:"nearest"})` внутри доступной области.
- **Target / validation:** [T-CMP-AUTO-001](target-spec.md#t-cmp-auto-001--autocomplete-клавиатура-и-видимость); проверка 390/768/1440, keyboard Tab+ArrowDown, long list, bottom safe-area. Reviewer verdict: pending.

## F-CMP-003 — Выбор Autocomplete по Enter перемонтирует поле и теряет фокус

- **Kind / priority / confidence:** `runtime_defect`; **P2**, high. После выбора нельзя непрерывно проверить/очистить значение или продолжить с ожидаемой позиции клавиатуры.
- **Where:** `/matches/new` SlotEditor и judge picker; аналогичный seam в `/matches/:id` editor; active user, chosen option.
- **Actual / expected:** до Enter input id `_r_8_`, после — `_r_a_`, `focus=false`, `document.activeElement=body`. Ожидается закрытое menu, выбранное значение и фокус в том же combobox (или на заранее документированном следующем control).
- **Reproduction:** в «Соперник» ввести запрос → `ArrowDown` → `Enter` → проверить active element и component id.
- **Evidence:** [после выбора](evidence/screenshots/light-1440-autocomplete-chosen-focus-lost.png), runtime state `light/autocomplete/chosen-option-focus-lost-to-body`; value-dependent keys в `MatchCreatePage.tsx:78-85,399-406` и `MatchDetailPage.tsx:103-110`.
- **Impact / frequency:** 1/1 keyboard selections в проверенном slot; source pattern повторён в трёх consumers.
- **Overlap:** `GAP-011`; продуктовые права/данные не затрагиваются.
- **Smallest remedy:** убрать выбранное `userId` из React `key` (оставить стабильный identity slot/judge) либо явно вернуть focus после controlled update. Сохранить clearable behavior, controlled value, default label, формат user/guest и validation.
- **Target / validation:** [T-CMP-AUTO-001](target-spec.md#t-cmp-auto-001--autocomplete-клавиатура-и-видимость); component/browser regression на Enter и click. Reviewer verdict: pending.

## F-CMP-004 — Глобальный focus ring рисуется на внутреннем input, а не на геометрии компонента

- **Kind / priority / confidence:** `runtime_defect`; **P2**, high. Focus заметен, но TextField/Autocomplete получают две рамки, а круглый radio — квадратную; это создаёт ложное ощущение вложенного поля и непоследовательную клавиатурную ориентацию.
- **Where:** login TextField, match TextField/Autocomplete, admin readonly TextField, judge native radio; light и dark shells; pointer и keyboard focus.
- **Actual / expected:** raw text input получает `3px` purple outline с `border-radius:0`, одновременно округлый visual wrapper `radius:10px` меняет border на `2px`. Judge radio получает квадратный `3px` outline вокруг кругового control. Ожидается один контрастный indicator на визуальной границе интерактивного компонента, согласованный с её radius.
- **Reproduction:** click email на `/login` или Tab к полю; аналогично Tab к radio в judge pre-start state.
- **Evidence:** [TextField close-up](evidence/screenshots/auth-input-pointer-focus-closeup.png), [readonly close-up](evidence/screenshots/admin-readonly-focus-closeup.png), [dark radio](evidence/screenshots/dark-390-radio-selected-focus.png); computed styles в runtime states; kit подавляет raw input outline, а app override `styles.css:1330-1333` возвращает его для всех descendants.
- **Impact / frequency:** воспроизведено на 4 классах контекста: auth, autocomplete, readonly admin, judge radio. Native select остаётся хорошим контрольным примером одной округлой рамки: [select close-up](evidence/screenshots/light-native-select-focus-closeup.png).
- **Overlap:** `GAP-011`; не отменяет требование видимого focus.
- **Smallest remedy:** не удалять focus indicator. Для composite TextField/Autocomplete перенести единственный `3px` ring на wrapper через `:has(input:focus-visible)` или kit API, подавив raw outline только при эквивалентной wrapper-индикации. Для radio подсветить 44px label/control shape, сохранив native semantics.
- **Target / validation:** [T-CMP-FOCUS-001](target-spec.md#t-cmp-focus-001--единая-геометрия-focusselected); light/dark, pointer/keyboard, error, readonly, selected и disabled matrix. Reviewer verdict: pending.

## F-CMP-005 — Radio-card кодирует selected+focus тремя одинаковыми контурами

- **Kind / priority / confidence:** `runtime_defect`; **P3**, high. Выбор доступен и различим, но граница выглядит как артефакт, а пользователь не получает ясного различия «выбрано» против «сейчас в фокусе».
- **Where:** bracket algorithm dialog, `BracketAlgorithmDialog`, selected radio + keyboard focus, 390 и 1440.
- **Actual / expected:** выбранная card одновременно имеет `2px` border, `1px` same-color box-shadow и `2px` outer outline. Ожидается устойчивый selected cue (border + tonal fill/check) и ровно один отдельный outer focus ring.
- **Reproduction:** открыть диалог алгоритма сетки → клавиатурой сфокусировать уже выбранную «Компактная сетка».
- **Evidence:** [1440 close-up](evidence/screenshots/light-radio-card-selected-focus-closeup.png), [390](evidence/screenshots/light-390-radio-card-selected-focus.png); runtime states; `BracketAlgorithmDialog.css:47-55`.
- **Impact / frequency:** 2/2 viewport captures; ограничено этому card pattern.
- **Overlap:** `GAP-011`; при следующей реализации повторно сверить актуальность, потому что tournament surface может изменяться параллельно.
- **Smallest remedy:** убрать selected box-shadow-дубль, оставить selected border/tonal surface и один внешний focus outline с offset; не менять radio semantics, disabled reason или выбор алгоритма.
- **Target / validation:** [T-CMP-FOCUS-001](target-spec.md#t-cmp-focus-001--единая-геометрия-focusselected); visual regression 390/1440 и keyboard focus. Reviewer verdict: pending.

## Снятая гипотеза: BottomNav и `aria-current`

Первичный state snapshot сохранил active class, но не собирал атрибут `aria-current`; вывод `null` был бы недоказан. Реальный компонент использует `NavLink` из `react-router-dom` `6.30.4`. Его реализация задаёт default `aria-current="page"` и выводит его из того же `isActive`, который передаётся в callback `className` (`react-router-dom/dist/index.js:804,851,865`). Поэтому active class, созданный callback в `layout.tsx:49-58`, не подтверждает semantic omission. Candidate полностью снят, рекомендация дублировать автоматическое поведение удалена; `BottomNav` остаётся в findings только как перекрывающая поверхность `F-CMP-002`.

## Ограничения и отрицательные результаты

- Не выполнялись: physical iOS/Android, real touch gestures, virtual keyboard, Safari/WebKit, Firefox, Edge, VoiceOver/TalkBack, OS/browser autofill и native select popup capture.
- CSS zoom 200% — прокси, не browser UI zoom и не OS text scale. Горизонтального overflow на этом прокси нет.
- Dialog focus trap/return/Escape уже описаны canonical evidence, но в этом независимом component-прогоне не повторялись и здесь не объявляются PASS.
- Ни source review, ни Chromium accessibility attributes не доказывают фактическую spoken фразу AT; `F-CMP-001` основан на объективно отсутствующем DOM target.
- Findings — вход для синтеза coordinator; они не создают новые canonical backlog IDs сами по себе.
