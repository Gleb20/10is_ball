# COMPONENTS supplement — отчёт

## Итог

Ограниченный delta-run закрыл проверяемые пробелы checkbox/radio/Dialog и representative Alert/Skeleton на том же baseline. `CMP-SUP-01`–`03` и `05` проходят в своей рамке; `CMP-SUP-04` воспроизводит две новые проблемы Dialog. Контрастный срез добавляет одну source-derived проблему тёмной оболочки. Итого: `3` новых findings (`3×P2`, один source-derived), P0/P1 нет.

Исходный пакет `../components/` не изменён и не переинтерпретирован. Его пять findings сохраняются отдельно.

## Прогоны

| Run | Сценарий | Роль / viewport / ввод | Результат | Evidence |
|---|---|---|---|---|
| `CMP-SUP-01` | `SC-C03` checkbox | admin, 1440, keyboard+mouse | PASS | checked/unchecked/focus и mouse toggle; `checkbox-1440-*` |
| `CMP-SUP-02` | `SC-C03` checkbox touch | admin, 390, touch emulation | PASS | tap меняет checked; overflow PASS; `checkbox-390-*` |
| `CMP-SUP-03` | `SC-C03/04` radio+Dialog | admin organizer, 1440, keyboard | PASS | ArrowRight, trap both directions, Escape, return; 7 focus checkpoints |
| `CMP-SUP-04` | `SC-C04` pending/error | admin organizer, 1440→390, keyboard+mouse | FAIL | `F-CMP-SUP-001/002`; persisted bracket не создавался, synthetic 503 |
| `CMP-SUP-05` | async primitives | admin, 1440+390, held/failing GET | PASS | visible Skeleton then standalone Alert; both 390 overflow checks PASS |

## Findings

### F-CMP-SUP-001 — Ошибка подтверждения скрыта за оставшимся открытым Dialog

- Kind: `runtime_defect`; Priority: **P2**; confidence: high; frequency: observed `1/1` frozen deterministic run.
- Where: `/tournaments/:id`, `BracketAlgorithmDialog`, organizer, failed bracket generation, 1440 and 390.
- Actual: после 503 `runAction` создаёт `Alert` в странице под portal (`TournamentDetailPage.tsx:340-367, 570-572`), а Dialog остаётся открыт. Raw check: `alertInsideModal=false`, `activeInsideModal=true`; modal/overlay стоят над центром Alert. На 390 сообщение не видно в активной viewport-области.
- Expected: ошибка и recovery action доступны в активном модальном контексте либо Dialog закрывается и фокус возвращается к видимому Alert/retry.
- Reproduction: открыть «Построить сетку» с четырьмя synthetic guests → подтвердить → получить controlled 503 → Dialog остаётся поверх page Alert.
- Evidence: `CMP-SUP-04`; `dialog-1440-error-hidden-behind-modal.png`, `dialog-390-error-hidden-behind-modal.png`; raw check `async-error-available-in-active-dialog-context` and state `light/dialog/error-alert-outside-dialog`.
- Impact: sighted keyboard/touch user получает завершившийся pending без видимого объяснения или пути восстановления внутри текущего context; повторное подтверждение выглядит допустимым.
- Existing overlap: не дублирует `F-CMP-001`–`005`; это новый async-error contract.
- Smallest remedy: передать action error в Dialog и показать там live Alert + retry/confirm recovery, либо закрыть Dialog on failure и сфокусировать page Alert; не менять tournament permissions/algorithm.
- Affected screens/root cause: любой Dialog, чья mutation error рендерится только в parent page. Validation: controlled failure at 390/1440, keyboard focus remains with visible error/retry, no duplicate write.

### F-CMP-SUP-002 — Pending делает Close интерактивным на вид, но действие молча игнорируется

- Kind: `runtime_defect`; Priority: **P2**; confidence: high; frequency: observed `1/1` frozen deterministic run.
- Where: `BracketAlgorithmDialog`, pending generate, 1440; same control present at 390.
- Actual: radios/actions получают native `disabled`, observer переносит focus на 48×48 Close. Close остаётся `disabled=false`, `tabIndex=0`, `cursor=pointer`, focus ring visible, но `onClose={() => !busy && onCancel()}` отбрасывает click и Escape. Cards также не получают существующий `.bracket-algo-card--disabled` class и визуально выглядят selectable.
- Expected: pending semantics согласованы с affordance: либо Close действительно закрывает/cancels safely, либо control removed/disabled and dialog exposes progress plus deliberate non-dismissible state; disabled radio cards visually distinguishable.
- Reproduction: открыть Dialog → keyboard confirm while POST is held → focus moves to Close → click Close or press Escape → Dialog remains with no feedback.
- Evidence: `CMP-SUP-04`; `dialog-1440-pending-disabled.png`; states `light/dialog/close-appears-enabled-during-pending`, `light/radio-card/disabled-pending-*`; failed check `enabled-looking-close-is-inert-during-pending`.
- Impact: an indefinitely slow request presents the only focused control as operable but it does nothing; disabled option state is visually ambiguous.
- Existing overlap: related to shared focus handling but not the geometric issue in `F-CMP-004/005`.
- Smallest remedy: define one pending dismissal policy in shared Dialog/caller; synchronize native disabled/aria/cursor/style and ensure focus lands on an honest target. Preserve single-flight and no duplicate mutation.
- Validation: keyboard and pointer click, Escape, pending completion/error, 390 touch emulation; assert focus never lands on an inert enabled-looking action.

### F-CMP-SUP-003 — Generic error red has only 2.58:1 against the immersive judge background

- Kind: `expert_hypothesis` from deterministic source/runtime color evidence; Priority: **P2**; confidence: medium until a fresh post-candidate runtime error is captured.
- Where: dark judge shell, `<p class="error judge-error" role="alert">` (`JudgePage.tsx:1184-1188`).
- Actual: `.error` is 14px `#b00020` (`styles.css:516-519`) on immersive `#0f1115`; computed relative-luminance ratio is `2.58:1`. The dark shell does not override this token.
- Expected: normal-size error text meets the `4.5:1` audit threshold and remains visibly distinct without relying on hue alone.
- Evidence: `evidence/runtime-states.json` contrast `dark/text/error-generic`; source background/text declarations; original frozen runtime reference confirms the same dark shell/focus palette. No stale match flow was replayed.
- Impact: important correction/network failure text can be difficult to read precisely when action recovery matters most.
- Existing overlap: no original contrast finding; do not merge into `F-CMP-004` focus geometry.
- Smallest remedy: scoped dark error token/color with at least 4.5:1 against all actual judge backgrounds; keep light `.error` behavior unchanged.
- Validation: fresh synthetic runtime error in setup and in-progress shells, computed foreground/background including alpha, 390 landscape/portrait; manual non-text/error-icon review remains separate.

## Contrast limits

Ten key pairs were calculated: five from this runtime and five dark pairs from exact CSS plus named frozen-runtime references. The five light runtime pairs meet the selected threshold; four dark source/reference pairs calculate above it, while generic dark error calculates below it. Source/reference calculations are not promoted to current-browser PASS. This is not a blanket WCAG pass: gradients, images, every interactive state, forced-colors, native controls, physical devices and spoken AT were not covered. Full values, alpha layers and formula are in `evidence/runtime-states.json`.

## Good patterns to preserve

- Dialog keyboard trap wraps in both directions and Escape returns focus to the exact opener outside pending.
- Native radio arrow behavior updates both focus and selection; checked/unchecked checkbox toggles work with keyboard, mouse and 390 touch emulation.
- Standalone AsyncState exposes real Skeleton/Alert, with no horizontal overflow at 390.
- Measured light primary/secondary/error and focus/selected cues meet the scoped thresholds; dark primary/secondary/focus/serving source/reference calculations are favorable but remain reference evidence.

## Limits and deferred work

- No user session was performed; consequences are expert/runtime assessments, not user quotes.
- No real autofill, physical touch, virtual keyboard, spoken AT or native popup was synthesized.
- Autocomplete touch/empty/error and mutable forms from the coordinator-named `GAP 012` candidate (not a canonical ID on this baseline) are explicitly deferred until the candidate baseline; see `inventory-delta.md`.
- Dark error is source-derived and deliberately remains medium-confidence until a fresh runtime error state is captured. No stale match-flow audit was repeated.
