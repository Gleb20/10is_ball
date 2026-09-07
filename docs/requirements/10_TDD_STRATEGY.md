# TDD Strategy — Tab-10

## 1. Обязательный цикл

Для каждой новой функции:
1. **Red:** написать минимальный падающий тест наблюдаемого поведения.
2. **Green:** реализовать наименьший объём кода для прохождения.
3. **Refactor:** улучшить дизайн при зелёных тестах.
4. Запустить весь релевантный набор.
5. Обновить матрицу требований.

Запрещено писать «запасную» функциональность без теста и требования.

## 2. Пирамида тестов

### Unit
Большинство тестов. Pure domain logic:
- правила победы;
- подача;
- Undo reducer;
- ranking comparator;
- tournament transitions;
- bracket seeding;
- invitation expiry;
- team captain selection;
- password policy.

### Integration
Обязательный release lane работает с реальной PostgreSQL `16.15`:
- транзакции очка и Undo;
- unique judge lock;
- optimistic version;
- repositories;
- session revoke;
- статистические запросы;
- migrations.

### API/Component
- auth и authorization;
- validation;
- status codes/error codes;
- idempotency;
- state transitions;
- response schemas.

### E2E
Только критичные пути:
- admin creates user → first login;
- match creation → judging → confirmation;
- judge handover;
- tournament creation → bracket → finish;
- team invitation;
- challenge/revenge;
- restore after page reload.

## 3. Test design rules

- Given/When/Then или Arrange/Act/Assert.
- Один тест — одно бизнес-утверждение.
- Название описывает правило, а не метод.
- Не mock-ать собственную domain logic.
- Mock только внешнюю границу; в MVP внешних границ почти нет.
- Clock, RNG и ID generator инъецируются.
- Не использовать `sleep`.
- Тестовые данные создаются builders/factories.
- Не переиспользовать глобально мутируемые fixtures.
- Проверять состояние БД после критичных операций.

## 4. Domain invariants как первая очередь

Перед UI реализовать и покрыть:
- match state machine;
- tournament state machine;
- judge exclusivity;
- participant concurrency;
- invitation lifecycle;
- team captain invariant;
- auth/admin lifecycle.

## 5. Property-based / parameterized tests

Использовать для:
- произвольных счетов и winner rules;
- deuce progression;
- Undo после последовательности очков;
- bracket sizes 3–64;
- нечётных сеток;
- ranking sorting;
- password policy.

## 6. Mutation testing

Точечно для:
- winner calculation;
- serve rotation;
- ranking tie-break;
- permission predicates;
- tournament transition guards.

Цель — убедиться, что тесты ловят изменение операторов и условий.

## 7. Contract tests frontend/backend

- OpenAPI генерируется/валидируется в CI.
- Frontend использует generated types или проверяемую схему.
- Breaking API change требует обновления тестов и спецификации в одном PR.

## 8. Database testing

- PostgreSQL/migration/concurrency suites запускаются на чистой disposable
  PostgreSQL `16.15`; контейнер использует tmpfs и всегда удаляется в `finally` и
  по сигналу.
- PGlite остаётся быстрым hermetic слоем, но не заменяет обязательный PostgreSQL
  lane и запускается явно через `dev:pglite` при локальной разработке.
- Миграции проверяются с нуля, на точной historical adoption schema и как
  sequential upgrade; catalog profile включает enum, columns/defaults/nullability,
  constraints и indexes.
- Проверяется forward-fix/recovery стратегия. Down-migrations и automatic
  production restore запрещены.
- Запрещены SQLite substitutes для PostgreSQL-specific поведения.

## 9. Frontend TDD

Приоритет:
- component tests для состояний;
- interaction tests по ролям пользователя;
- не тестировать внутреннюю структуру компонентов;
- accessibility queries вместо CSS selectors;
- visual regression точечно для judge mode, bracket и empty states.

## 10. CI gates

Каждый PR и повторно точный merge SHA выполняют три независимые required lanes:

1. `quality`: audit, lint, typecheck, hermetic unit/component/PGlite и build;
2. `postgres-integration`: fresh/adoption/upgrade migration и concurrency checks;
3. `browser-prodlike`: compiled API/web, PostgreSQL `16.15`, same-origin proxy и
   Playwright-managed Chromium на desktop/mobile.

`release-gate` проверяет, что все три результата именно `success`, без
`skipped`/`neutral`. Тестовые reporters требуют ненулевое число tests и `0 failed`,
`0 skipped`, `0 todo`. Merge запрещён при любом другом результате. После merge
D31 разрешает native Git deploy текущего disposable public stand; GitHub
вручную выполняет только bounded read-only exact-SHA smoke после deploy.

## 11. Bug workflow

Любой баг:
1. воспроизвести падающим тестом;
2. убедиться, что тест падает на текущем коде;
3. исправить минимально;
4. оставить тест как regression test;
5. проверить родственные boundary cases.

## 12. Definition of Ready

Задача готова к разработке, если:
- есть requirement ID;
- сформулировано наблюдаемое поведение;
- перечислены сценарии;
- определены ограничения и ошибки;
- понятен слой теста;
- нет скрытого внешнего dependency.

## 13. Definition of Done

- тест написан до кода;
- полный набор зелёный;
- нет flaky поведения;
- schema/API docs обновлены;
- audit/security implications проверены;
- requirement-test mapping обновлён.
