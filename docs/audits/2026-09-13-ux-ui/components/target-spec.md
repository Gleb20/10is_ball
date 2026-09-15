# Целевая спецификация общих компонентов

Спецификация не меняет фирменный стиль, IA, роли или продуктовые правила. Она описывает минимальные корректировки существующих компонентов. Все размеры — существующие токены, если эквивалент уже есть; новые literals нужны только как fallback.

## T-CMP-AUTO-001 — Autocomplete: клавиатура и видимость

**Поддерживаемая задача:** найти и выбрать человека клавиатурой, мышью или touch, не потеряв текущий контекст. Семантическая опора — [WAI-ARIA APG Combobox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/): DOM focus остаётся на combobox, active option задаётся через разрешимый `aria-activedescendant`, Enter принимает значение и закрывает popup. Частичное перекрытие из `F-CMP-002` фиксируется как геометрическая UX-проблема и само по себе не объявляется нарушением [WCAG Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).

### Before

```text
desktop 1440×900, нижний край viewport
┌──────────────────────── form ───────────────────────┐
│ Соперник                                             │
│ ┌──────── raw input с внутренней квадратной рамкой ┐ │ ← focus
│ └──────────────────────────────────────────────────┘ │
├──────────── fixed BottomNav y≈838…900 ──────────────┤ ← перекрывает input
│ Главная   История   Начать   Рейтинг   Профиль       │
└─────────────────────────────────────────────────────┘
  option[data-active] y≈939…975                         ← вне viewport

DOM: input aria-activedescendant="…-option-0"
     li[data-active=true] id=null
Enter: input id меняется, focus → body
```

### After — 390px

```text
┌────────────── 390px viewport ──────────────┐
│ Соперник                                   │
│ ╔════════ focused wrapper, radius 10 ════╗ │  min-height 44
│ ║ ОченьДлинная…                          ║ │
│ ╚════════════════════════════════════════╝ │
│ ┌──────── listbox, max-height clamped ───┐ │
│ │ ▌ Александра…                ACTIVE   │ │  min-height 44
│ │   Александр…                          │ │
│ │   …                         scroll ↕  │ │
│ └────────────────────────────────────────┘ │
│          reserve ≥ nav + safe-area         │
├──────────── fixed BottomNav ───────────────┤
└────────────────────────────────────────────┘
```

### After — desktop

```text
center column ≤ existing 560px
┌────────────────────────────────────────────┐
│ focused Autocomplete                       │
│ ┌────────────────────────────────────────┐ │
│ │ query                                  │ │
│ └────────────────────────────────────────┘ │
│ ┌──────────────── listbox ───────────────┐ │
│ │ ▌ active option                       │ │ ← always inside available viewport
│ │   other option                        │ │
│ └────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
If available space below < menu minimum: flip above; otherwise clamp+scroll.
```

### Контракт состояний

| State | Визуально | DOM / keyboard | Геометрия |
|---|---|---|---|
| focused, closed | один ring на wrapper | focus остаётся в combobox | control min-height 44px |
| open, no active | menu видим, chosen отдельно | `aria-expanded=true`, active descendant отсутствует | menu не пересекает fixed nav |
| open, active | tonal fill **и** ведущий marker/inset line; не только 3% gray | `aria-activedescendant` равен существующему option `id`; ArrowUp/Down меняет оба | active option min-height 44px и scrolls nearest |
| chosen | label/value видимы | Enter/click закрывает menu, focus остаётся в combobox; `aria-selected=true` только у выбранного | без layout jump/remount |
| empty/error | явный текст + доступный recovery | listbox/status имеет объявляемое сообщение | menu остаётся в available region |
| disabled/readonly | существующие tokens | не открывает menu; semantics сохраняются | размер не меняется |

**Primary action:** ввод и выбор option. **Secondary:** clear action остаётся доступным по текущему контракту. Long label переносится не более чем по доступной ширине; listbox получает внутренний scroll. Back/URL behavior не меняются.

**Связанные findings:** `F-CMP-001`, `F-CMP-002`, `F-CMP-003`. **Неразрешённые решения:** нет.

## T-CMP-FOCUS-001 — Единая геометрия focus/selected

**Поддерживаемая задача:** видеть, какой control принимает ввод, не путать focus с selected, error или readonly. Рамка остаётся видимой по [WCAG 2.2 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html).

### Before / After — TextField и Autocomplete

```text
BEFORE                              AFTER
╔ outer wrapper border ═══════╗     ╔ 3px focus ring, radius=wrapper ═╗
║ ┌ raw input rectangle ────┐ ║     ║  one visual control             ║
║ └ 3px square outline ─────┘ ║     ╚══════════════════════════════════╝
╚══════════════════════════════╝     raw input outline: none only because
две рамки, разные radius              wrapper has an equivalent indicator
```

- Wrapper: существующий `radius:10px`, content min-height `44px`; ring `3px` + `2px` offset или семантически эквивалентный project token.
- Error+focus: error label/border остаются; focus ring не заменяется error color и не скрывает её.
- Readonly: существующий readonly background сохраняется, copy/selection разрешены; один ring показывает keyboard/pointer focus.
- Disabled: ring отсутствует, control не фокусируется, ослабленный token сохраняется.
- Dark shell: тот же один ring, но текущий light token `#cba5f8` либо его существующий semantic alias.

### Before / After — radio и selectable card

```text
390px и desktop
BEFORE                              AFTER
▣ tiny circular radio               ┌─ 44px label hit area ───────────┐
└ square outline                    │ ◉ label                         │
                                    └ rounded outer focus ring ───────┘

╔ selected border ═╗                ┌ selected border + tonal fill ──┐
╠ same-color shadow ╣   →            │ title / description             │
╚ outer focus ring ╝                └ one outer focus ring ──────────┘
```

| State | Selected cue | Focus cue | Запрещено |
|---|---|---|---|
| unselected | neutral border/surface | один внешний ring | квадратный ring на круглом radio |
| selected | primary border + tonal fill или check | тот же один внешний ring дополнительно | три одинаковых контура |
| disabled | subdued surface + reason | не фокусируется | полагаться только на opacity без причины |

Сохраняются native radio semantics, click/touch по всей label, disabled reason, algorithm value и текущая цветовая система. **Связанные findings:** `F-CMP-004`, `F-CMP-005`. **Неразрешённые решения:** нет.

## Приёмочная матрица после реализации

1. Chromium + Firefox: 390×844, 768×1024, 1440×900; отдельный 360px и существующий judge landscape.
2. Keyboard: Tab/Shift+Tab, ArrowUp/Down, Enter, Escape, clear; focus не попадает в `body` после выбора.
3. Semantics: каждый `aria-activedescendant` существует; native radio/combobox roles сохранены. Автоматический `NavLink aria-current=page` не менять.
4. Geometry: active option и focused control не пересекаются с fixed nav; 10/10 текущих overflow checks остаются PASS.
5. Visual states: light/dark, default/hover/active/focus/selected/error/readonly/disabled/pending; один focus ring на геометрии control.
6. Touch: эмуляция плюс отдельный physical-device residual; spoken AT — отдельный spot-check, не подменяемый DOM inspection.
