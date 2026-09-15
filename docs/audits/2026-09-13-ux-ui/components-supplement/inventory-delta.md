# Дополнение к инвентарю общих компонентов

## Рамка

- Пакет: `COMPONENTS-SUPPLEMENT`; это только delta к замороженному `../components/`, а не повторный аудит его 33 screenshots.
- Baseline: версия `3.0.0`, SHA `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221`.
- Runtime: production build на `http://localhost:4517`, API `4518`, отдельный одноразовый PostgreSQL `127.0.0.1:32997`; только synthetic tournament/guests.
- Browser: headless Chromium `153.0.8010.12`; `1440×900` и `390×844`. Keyboard и mouse проверены отдельно; 390 touch — Playwright `hasTouch/isMobile` emulation, не физическое устройство.
- Метод: source review + browser interaction + полные DOM attributes/computed styles/geometry/focus sequences в `evidence/runtime-states.json`.

## Delta-матрица

| Семейство / состояние | 1440 | 390 | Ввод | Итог / evidence |
|---|---|---|---|---|
| Checkbox checked / unchecked / focus | checked и unchecked; keyboard focus; mouse toggle | unchecked после tap | keyboard, mouse, touch emulation | PASS: `checkbox-*`; raw states `light/checkbox/*` |
| Checkbox disabled / indeterminate | N/A | N/A | — | В текущих шести consumers нет `disabled`; `indeterminate` нигде не задаётся. Source basis: `TournamentsPage.tsx:89`, `TournamentDetailPage.tsx:491,504`, `NotificationsPage.tsx:257`, `MatchCreatePage.tsx:346`, `MatchDetailPage.tsx:812` |
| Radio-card selected / unselected | Оба состояния до и после `ArrowRight`; focus следует за выбором | Геометрия 390 уже есть в исходном пакете, здесь не дублировалась | keyboard | PASS: `dialog-1440-radio-arrow-and-trap.png`; raw `light/radio-card/*after-arrow` |
| Radio-card disabled | Оба native radio действительно `disabled` в pending | Pending geometry не повторялась | keyboard + held request | PARTIAL/FAIL: input semantics есть, но cards визуально остаются обычными; входит в `F-CMP-SUP-002` |
| Dialog Tab / Shift+Tab trap | first Close → Shift+Tab → last Confirm → Tab → first Close | — | keyboard | PASS: focus sequence `CMP-SUP-03` |
| Dialog Escape / focus return | Escape закрывает; focus возвращается на opener | post-error close возвращает на opener | keyboard; mouse после error | PASS вне pending; pending policy см. ниже |
| Dialog async pending | Radios и actions disabled; focus recovered на Close | геометрия error-пути | keyboard | FAIL: Close выглядит enabled, но click/Escape не закрывают — `F-CMP-SUP-002` |
| Dialog async error | Alert создаётся вне modal; dialog остаётся открытым | Alert полностью скрыт modal/overlay в видимой области | synthetic HTTP 503 | FAIL: `F-CMP-SUP-001`; `dialog-*-error-hidden-behind-modal.png` |
| Skeleton loading | Два rectangular skeleton, Refresh disabled | То же; horizontal overflow отсутствует | held GET, без mutation | PASS: `skeleton-1440-loading.png`, `skeleton-390-loading.png` |
| Alert error | Tonal error виден | Tonal error виден; horizontal overflow отсутствует | synthetic HTTP 503 | PASS для standalone AsyncState: `alert-*.png`; contrast `6.36:1` |
| Tabs | N/A | N/A | — | `ui.tsx:2-31` не импортирует/экспортирует Tabs; consumers в `apps/web/src` отсутствуют |
| Tooltip | N/A | N/A | — | `ui.tsx:2-31` не импортирует/экспортирует Tooltip; consumers отсутствуют |
| Snackbar | N/A | N/A | — | `ui.tsx:2-31` не импортирует/экспортирует Snackbar; consumers отсутствуют |
| Menu | N/A | N/A | — | `ui.tsx:2-31` не импортирует/экспортирует Menu; judge «Ещё» — custom `role=group`, не menu |

## Контрастный delta

Метод — WCAG 2.x relative luminance. Runtime-пары учитывают computed rgba и последовательную alpha-композицию фонов по DOM; source-derived dark пары используют точные текущие CSS-цвета и два computed состояния из замороженного исходного пакета. Для обычного текста применён ориентир `4.5:1`, для значимого focus/selected cue — `3:1`; это ограниченная выборка, не заявление о полном WCAG conforming.

| Shell / пара | Effective fg / bg | Ratio | Итог |
|---|---|---:|---|
| Light ordinary text | `rgb(24.36 24.36 24.36)` / white | `17.69:1` | PASS |
| Light secondary text | `#5c6370` / white | `6.05:1` | PASS |
| Light tonal error | `#aa1313` / `#fde8e8` | `6.36:1` | PASS |
| Light radio-card focus ring | `#2563eb` / white | `5.17:1` | PASS |
| Light radio-card selected border | `#2563eb` / white | `5.17:1` | PASS |
| Dark ordinary text | `#f5f5f5` / `#0f1115` | `17.33:1` | SOURCE CHECK ≥ threshold; not a new browser PASS |
| Dark secondary text, 75% alpha composed | `rgb(187.5 188 189)` / `#0f1115` | `9.95:1` | SOURCE + frozen-runtime reference ≥ threshold; not a new browser PASS |
| Dark generic `.error` text | `#b00020` / `#0f1115` | `2.58:1` | SOURCE CHECK < threshold: hypothesis `F-CMP-SUP-003`, runtime recheck required |
| Dark focus ring | `#cba5f8` / `#0f1115` | `9.25:1` | SOURCE + frozen-runtime reference ≥ threshold; not a new browser PASS |
| Dark selected/serving border | `#5b9fff` / `#1a1d24` | `6.30:1` | SOURCE + frozen-runtime reference ≥ threshold; not a new browser PASS |

Normative references used only for the thresholds: [WCAG 2.2 SC 1.4.3](https://www.w3.org/TR/WCAG22/#contrast-minimum) and [Understanding SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast).

## Explicit recheck list after candidate

- Autocomplete touch, empty and error states (`SC-C02`). Do not infer them from the original keyboard findings.
- Mutable form branches from the coordinator-named `GAP 012` candidate (not present as a canonical backlog ID on this frozen baseline); use the accepted post-candidate baseline and fresh deterministic fixtures.
- Dialog pending/error after `F-CMP-SUP-001/002` candidate: visible in-modal error, truthful close semantics, retry/recovery, keyboard and 390 touch emulation.
- Dark judge `.error` in a fresh non-stale runtime state after the contrast candidate; retain the source calculation as baseline evidence.
- Physical iOS/Android touch, virtual keyboard, VoiceOver/TalkBack, real autofill and native select popup remain separate device/browser work. None were faked here.
