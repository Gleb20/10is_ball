# Рабочий процесс и трассировка

Этот процесс обязателен для изменений продукта после baseline-аудита 2026-09-06.

## 1. До изменения

1. Найти или создать стабильный backlog ID формата `<AREA>-NNN` в
   [BACKLOG.md](BACKLOG.md). Допустимые области: `SEC`, `BUG`, `GAP`, `DATA`,
   `OPS`, `TECH`. ID не переиспользуются.
2. Зафиксировать type, priority, status, evidence, actual, expected, repro, risk,
   dependencies и verification. Для product gap добавить requirement/acceptance ID.
3. Проверить [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md). Если результат зависит от
   нерешённого продукта, поставить `blocked_decision`, не угадывать.
4. Для решения с долгосрочным эффектом сначала добавить ADR в
   [DECISIONS.md](DECISIONS.md), затем согласовать PRD и acceptance.

## 1.1. Жизненный цикл backlog item

Используется только эта последовательность:

`confirmed → ready → in_progress → verified_local → verified_prod → done`

| Status | Gate |
|---|---|
| `confirmed` | finding/gap имеет воспроизводимое evidence; приоритет и risk записаны |
| `ready` | expected behaviour/acceptance согласованы, dependencies позволяют начать |
| `in_progress` | Red/reproduction и реализация действительно начаты |
| `verified_local` | релевантные local checks прошли; skipped/remaining gates перечислены |
| `verified_prod` | тот же release artifact подтверждён production smoke/evidence без скрытия residual risk |
| `done` | docs/traceability/changelog синхронизированы, residual work вынесен в новые IDs |
| `blocked_decision` | работа требует ответа пользователя/ADR; после решения возвращается в `ready` |

Внешняя зависимость (например, действие владельца Neon) записывается в
`Dependencies`: отдельного статуса для неё нет. Нельзя перескакивать
через gates или считать `verified_local` доказательством production. Для чисто
локального work item переход `verified_prod` требует явно записанного подтверждения,
что production scope отсутствует; иначе item остаётся `verified_local`.

### Ускоренный solo-main режим по D32

До прямой отмены пользователем работа ведётся в `main`: после пропорциональной
локальной проверки агент коммитит и сразу пушит тематический diff в
`origin/main`. Feature branches и pull requests не являются обязательным этапом.
Force-push, переписывание истории и смешивание чужих изменений запрещены.

Каждый push в `main` сразу запускает параллельные native Git deploy Render и
Vercel на текущий disposable public stand. Они не ждут повторного CI этого SHA;
CI идёт параллельно и остаётся наблюдаемым сигналом. Render применяет только
immutable forward migrations. После схождения провайдеров выполняется локальная
read-only команда `pnpm smoke:public`, которая сама получает SHA из
`origin/main` и проверяет одинаковые SHA/version web и API.

Это разрешение не распространяется на tag/version bump, mutating public E2E,
down-migration, автоматический restore, повторный reset/recreate, DNS, billing,
access-control changes или будущий production с ценными данными. Такие операции
требуют отдельного явного разрешения.

## 1.2. Оркестрация разработки

Для независимых содержательных задач используйте [ORCHESTRATION.md](ORCHESTRATION.md). Главный агент владеет приёмкой и интеграцией; каждый файл имеет одного writer. Текущая очередь завершения продукта: [OPS-004 completion waves](test-plans/OPS-004-completion-waves.md).

## 2. Во время изменения

- Делать минимальный тематический diff; не смешивать чужие изменения.
- Сначала создать или актуализировать воспроизводящий тест, затем исправить код.
- Не ослаблять тест или требование ради зелёного CI без отдельного ADR.
- Изменение публичного route/schema одновременно отражать в as-built API/DB и
  целевом contract, если это сознательное изменение продукта.
- Для security/correctness исправления явно проверить негативный сценарий и
  соседние роли/состояния.

## 3. Definition of done

Backlog item переводится из `verified_prod` в `done` только когда:

1. expected behaviour подтверждено указанной verification;
2. релевантные unit/integration/API/component/E2E проверки проходят;
3. нет нового незадокументированного расхождения PRD ↔ код ↔ API/DB;
4. обновлены [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md),
   [PROJECT_STATUS.md](PROJECT_STATUS.md) и traceability;
5. в начало [CHANGELOG_DEV.md](CHANGELOG_DEV.md) добавлена запись с датой,
   backlog/ADR/AT IDs, изменёнными файлами и фактическими проверками;
6. записаны URL/version/commit/time production smoke либо явно доказано, что
   production scope у этого item отсутствует.

`Тест проходит` не равнозначно `capability verified`: для пользовательского флоу
нужна проверка на соответствующем уровне, а для критического веб-флоу — browser
или E2E evidence.

## 4. Непрерывный журнал

[CHANGELOG_DEV.md](CHANGELOG_DEV.md) — обратная хронология: новая запись всегда
добавляется сверху и не переписывает старые факты. Исправление ошибочной старой
записи оформляется новой записью со ссылкой на дату/решение; исторический текст
можно пометить `superseded`, но не превращать его задним числом в подтверждённый
факт.

Минимальный шаблон:

```md
## YYYY-MM-DD — краткий результат
- Scope: BACKLOG-ID, ADR/REQ/AT IDs
- Changed: относительные пути
- Verified: команды и результат; browser/prod smoke, если был
- Docs: какие канонические документы синхронизированы
- Remaining: известные ограничения или `none`
```

Baseline-аудиты в `docs/audits/` immutable: после публикации их не исправляют.
Новые данные идут в backlog/changelog или в новый датированный аудит.

## 5. Матрица обновлений

| Изменение | Обязательные документы |
|---|---|
| Требование/поведение | PRD, acceptance, traceability, ADR при решении |
| API route/payload/error | API as-built, API spec, tests, backlog/changelog |
| Таблица/колонка/invariant | data model as-built, target data model, migration evidence |
| Деплой/env/secret procedure | deployment as-built, DEPLOY, security backlog |
| UI-флоу/a11y | capability matrix, acceptance, A11Y checklist при необходимости |
| Исправленный дефект | backlog status/evidence/verification, changelog, project status |
| Новое неизвестное | OPEN_QUESTIONS; backlog `blocked_decision`, если блокирует |

## 6. Отдельные test plans

Для небольшого исправления достаточно verification в backlog и acceptance
scenario. Отдельный test plan нужен для миграции данных, конкурентного изменения,
security-ротации или multi-step release; при появлении он создаётся в
`docs/test-plans/` и связывается с backlog ID. Сам каталог заранее не считается
обязательным источником истины.
