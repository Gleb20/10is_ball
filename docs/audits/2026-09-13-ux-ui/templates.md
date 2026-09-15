# Протокол исследования и шаблоны

Это рабочие формы. В принятом отчёте не оставлять незаполненных полей: использовать unknown/N/A с причиной. Для повторяемого паттерна достаточно одной полной формы и ссылки из затронутых сценариев.

## Work order дочерней задачи

```text
PACKAGE / canonical ID:
GOAL: один проверяемый выход
BASELINE: checkout + HEAD + source manifest + build/fixture identity
SOURCES: AGENTS, current REQ/AT/ADR, source pointers, accepted pilot
WRITE SCOPE: точные paths; один writer; запреты
DEPENDENCIES: уже готовые inputs, gates ещё не пройдены
SCENARIOS: SC IDs, роли, состояния, viewport
METHOD: source / browser / user session; что этот метод не доказывает
ACCEPTANCE: обязательные артефакты и критерии
VERIFY: команды, browser/DB/port ownership, evidence policy
RETURN: READY_FOR_REVIEW / PARTIAL / BLOCKED; evidence, limits, next action
```

## Прогон сценария

```text
Run ID / SC ID / UTC time:
Baseline / dirty delta / runtime build:
Browser/version / viewport / input method / role:
Fixture precondition (synthetic; без credentials):
User task (цель без названий кнопок и подсказанного пути):
Observable success (UI + persisted state для критических действий):
Actual steps / branches / exit and recovery:
Result: PASS / FAIL / NOT_TESTED / N/A + explanation
Wrong first action / returns / uncertainty / help needed:
Evidence paths / source or REQ/AT pointer:
Environment limitation / related findings:
```

## Находка

```text
ID: F-<PACKAGE>-NNN; canonical backlog ID после синтеза
Title: проблема и пользовательское последствие
Kind: runtime_defect / expert_hypothesis / user_observation / accepted_change
Where: route, component, role, state, viewport
Actual / expected:
Reproduction: precondition, steps, observed result
Evidence: screenshot or trace + run ID + source baseline
Impact: что не получается/непонятно/дорого и почему
Priority P0–P3 + rationale; confidence high/medium/low + basis
Frequency: observed count/context OR unknown
Existing requirement / acceptance / ADR / old backlog overlap:
Smallest remedy; preserved functions and constraints:
Affected screens / shared root cause / dependencies:
Target spec link / validation needed / reviewer verdict:
```

Визуальное отличие без пользовательского последствия не объявляется дефектом. Историческая находка заново воспроизводится. Не выводить мотивы из количества кликов.

## Целевой экран / компонент

```text
Spec ID and supported tasks:
Before: annotated evidence screenshot
After: annotated structural wireframe at 390px and desktop
Primary information and action; secondary discovery path:
Block order, labels, control variants, alignment, wrapping:
Widths/gaps/target sizes via existing tokens or explicit values:
Conditional visibility by role/state; selected/disabled/error/pending:
Keyboard focus entry/order/return; touch; URL/back behaviour:
Loading/empty/failure/recovery; long content and narrow viewport:
Shared pattern to reuse; allowed context-specific differences:
Preserved capabilities; unresolved decisions (must be empty for ready):
```

Схема не меняет фирменный стиль. Не назначать новый компонент, если существующий исправляется/настраивается. Если выбор компонента принципиален, назвать его в ready-задаче.

## Реализационная задача (канонический backlog)

```text
### AREA-NNN — наблюдаемый результат
**Type:**
**Priority:**
**Status:**
**Evidence:**
**Expected:**
**Actual:**
**Repro:**
**Risk:**
**Verification:**
**Dependencies:**
Scenario / Epic / Story / Sprint:
User outcome / Non-goals:
Inputs: findings, REQ/AT/ADR, baseline, target spec, source seams
Actual / Expected (однозначно):
Roles and permissions:
States and edge cases:
API/types/data: конкретные изменения либо none
Constraints and forbidden shortcuts:
Dependencies and owner/write scope:
Subtasks: numbered, each with input/output/check
Acceptance: Given / When / Then incl negative cases
Verify: focused checks; integration/DB/browser/full gate по риску
Evidence required:
Documentation updates / rollback:
Risks / open decisions (empty for ready):
```

Имена обязательных полей Type, Priority, Status, Evidence, Expected, Actual, Repro, Risk, Verification и Dependencies сохранять отдельно и буквально: check-docs проверяет их, объединённый заголовок `Actual / Repro` не заменяет два поля.

Нельзя выдавать реализацию с формулировками «улучшить», «удобнее», «сделать красиво» без проверяемого результата. Любая задача, зависящая от непринятого правила/IA, blocked_decision. Finding не равно отдельная задача: сначала объединить общую причину; не размножать fix каждого вызова одного компонента.

## Reviewer

Проверить: baseline совпадает; repro и evidence существуют; автор не выдаёт source-review за browser/user-test; функции сохранены; права не расширены; вывод имеет последствие; target не противоречит другим пакетам; требования и acceptance согласованы; ready-задача однозначна; приоритет не завышен; состояние компонента проверено в relevant shells.

Вердикт: PASS / REWORK / INCOMPLETE. Для каждого замечания: blocking? → точное место → почему → минимальная корректировка → способ проверки. После исправления проверять затронутый delta, не повторять всё без причины.

## Сессия с пользователем (после экспертного прохода)

Сначала нейтральное задание на исходной версии без демонстрации предлагаемого решения. Не подсказывать названия кнопок. После попытки: что ожидал увидеть; что означало состояние; что помешало; как решал раньше. Затем показать target-схему и попросить объяснить следующий шаг и найти дополнительную функцию. Отмечать помощь исследователя. Эмоции/цитаты только со слов человека; предположения отдельно. Не обещать процент улучшения на одном участнике.

## HTML flow-report

Использовать локальный userflow/report-template.html: отдельный автономный отчёт на пакет; шаги/primary CTA/ветви, screen inventory, anti-pattern PASS/WARN/FAIL/NOT TESTED с evidence, открытые вопросы. В отчёте разделить as-is и proposed. Удалить template placeholders; никаких внешних зависимостей или реальных персональных данных.
