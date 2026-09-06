# Документация Tab-10

Документация разделена на целевое поведение, фактическое состояние и историю. Не
смешивайте эти слои: наличие требования не означает, что оно реализовано.

## С чего начать

1. [PROJECT_STATUS.md](PROJECT_STATUS.md) — короткий честный снимок состояния.
2. [audits/2026-09-06-baseline.md](audits/2026-09-06-baseline.md) — неизменяемая
   исходная точка аудита.
3. [BACKLOG.md](BACKLOG.md) — живой приоритизированный список работ.
4. [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md) — покрытие продукта по возможностям.
5. [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) — решения, которых нет в репозитории.
6. [WORKFLOW.md](WORKFLOW.md) — как менять код, требования, тесты и журнал вместе.

## Иерархия источников истины

При конфликте используйте следующий порядок:

1. принятые ADR в [DECISIONS.md](DECISIONS.md);
2. функциональные требования в [requirements/04_PRD.md](requirements/04_PRD.md)
   и проверяемые сценарии в
   [requirements/11_ACCEPTANCE_TEST_CATALOG.md](requirements/11_ACCEPTANCE_TEST_CATALOG.md);
3. целевые data/API contracts в
   [requirements/07_DATA_MODEL.md](requirements/07_DATA_MODEL.md) и
   [requirements/08_API_SPEC.md](requirements/08_API_SPEC.md);
4. целевые UI flow/state в
   [requirements/05_UX_FLOWS.md](requirements/05_UX_FLOWS.md);
5. delivery gates в
   [requirements/10_TDD_STRATEGY.md](requirements/10_TDD_STRATEGY.md).

Фактические контракты текущего кода описывают [architecture/](architecture/), а
текущие риски/готовность — [BACKLOG.md](BACKLOG.md) и
[PROJECT_STATUS.md](PROJECT_STATUS.md). Они являются evidence, но не
переопределяют целевое поведение. Планы, changelog и manifest историчны.

Если ADR и PRD расходятся, ADR задаёт решение, а несогласованность документов
считается дефектом документации. Если код расходится с целевым поведением, код не
становится новым требованием автоматически: это либо backlog item, либо отдельное
решение через ADR.

## Карта документов

| Область | Канонический документ |
|---|---|
| Статус и следующий этап | [PROJECT_STATUS.md](PROJECT_STATUS.md) |
| Живой backlog | [BACKLOG.md](BACKLOG.md) |
| Возможности продукта | [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md) |
| Нерешённые вопросы | [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) |
| Архитектура as-built | [architecture/AS_BUILT.md](architecture/AS_BUILT.md) |
| API as-built | [architecture/API_AS_BUILT.md](architecture/API_AS_BUILT.md) |
| Данные as-built | [architecture/DATA_MODEL_AS_BUILT.md](architecture/DATA_MODEL_AS_BUILT.md) |
| Деплой as-built | [operations/DEPLOYMENT_AS_BUILT.md](operations/DEPLOYMENT_AS_BUILT.md) |
| Audit evidence (JSON/screenshots) | [audit/evidence/](audit/evidence/) |
| Активный incident plan | [SEC-001 credential rotation](test-plans/SEC-001-credential-rotation.md) |
| Инструкция по бесплатному деплою | [DEPLOY.md](DEPLOY.md) |
| Продуктовые решения | [DECISIONS.md](DECISIONS.md) |
| Техническая хронология | [CHANGELOG_DEV.md](CHANGELOG_DEV.md) |
| Требования и acceptance | [requirements/00_README.md](requirements/00_README.md) |
| Трассировка требований | [requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md](requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md) |
| Accessibility checklist | [A11Y_CHECKLIST.md](A11Y_CHECKLIST.md) |
| Версионирование | [VERSIONING.md](VERSIONING.md) |

## Статусы и термины

- Capability: `verified`, `partial`, `broken`, `missing`, `unknown`.
- Backlog: `confirmed` → `ready` → `in_progress` → `verified_local` →
  `verified_prod` → `done`; `blocked_decision` — боковая ветка до принятого ADR.
- Приоритет: `P0` — риск безопасности/целостности или релиз-блокер; `P1` —
  основной пользовательский сценарий существенно нарушен; `P2` — важный пробел
  или качество; `P3` — улучшение без немедленного риска.

Current production — временный visual regression baseline до отдельно
согласованного redesign. Figma-файл из истории проекта не authoritative и служит
только reference. Подтверждённые a11y/layout defects production остаются backlog:
baseline фиксирует регрессии, а не объявляет дефекты нормой (ADR D22).
