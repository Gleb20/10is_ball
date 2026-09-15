# Как запустить ограниченный пакет исследования

Применяется после независимого PASS пилота. Это инструкция исполнения work order, не новый backlog. Координатор подставляет PACKAGE, frozen export и собственные порты. Все сведения в финальном пакете — по-русски, кроме идентификаторов/технических контрактов.

## Источник и среда

1. Работать в своей Codex worktree. Не редактировать исходный dirty checkout пользователя и coordinator clone. Сверить HEAD с base_head frozen manifest. Если worktree не совпадает, создать отдельную чистую временную копию от точного base_head; не переносить чужую dirty работу.
2. Применить frozen tracked.patch и копировать только files/ по manifest. Проверить каждый file hash и candidate-source.json323paths. Runtime source =9f71b9f+GAP012r6,3.0.0,notpublished. Canonical docs base не объявлять сегодняшним production.
3. Node24.20.0 `/Users/liubavskii/.local/share/mise/installs/node/24.20.0/bin`, pnpm9.15.0. Собственный build с NODE_ENV=production. NODE_ENV=test может собрать непригодный frontend, такой результат не является аудитом.
4. Собственные web/API/DBproject/port/browser, не 4617/4618/33007. Disposable PostgreSQL; runtime role tab10_runtime_test, миграции migrationowner. Использовать существующие `scripts/verify/lib.mjs`, `run-prodlike-e2e.mjs` как источник setup/cleanup, но его hardcoded3101/4273 не запускать параллельно пакетам без изменения локального audit-harness. Не менять продуктовые scripts для исследования. Обычный audit не требует повторять1257 тестов.
5. Synthetic users/roles/fixtures через собственный API/одноразовый seed. [fixtures.md](fixtures.md) различает active, password-change, onboarding, consent и judge. Не сохранять пароли, storage/cookies, env/connection strings в evidence. Admin для bootstrap/ролевых сценариев, обычные users для пользовательских задач.
6. Скрипт/harness вне application scope; опубликованный replay содержит только безопасные placeholders и путь к подготовке fixtures, не реальные credentials. Закрыть ownprocesses/DB после freezesnapshot. Не вызывать gitcommit/push/deploy.

## Исследование и экономия

Прочитать work-orders/templates/scenarios, свои requirements из requirement-coverage.csv, accepted pilot и известные BUG018–023/GAP013. Проверять собственные ветви, а не повторять полностью родительский пилот. Допустима ссылка на pilot evidence с точным runID и ограничением; это reuse, не новый собственный run. Общие component findings объединяются по причине, не число страниц. Не запускать дополнительные чаты или агентов внутри пакета без необходимости; три параллельные работы распределяет координатор.

Сначала провести целевой browser проход на новой базе. Использовать независимый контекст на субъекта, проверять видимые страницы и persisted state критических действий. Затем source для объяснения/точного seam. Снять viewportPNG нужного состояния; открыть глазами ключевые PNG перед передачей. Fullpage/DOMскрытый текст не доказывают визуальное состояние. Сначала дождаться наблюдаемой готовности/прокрутки, а не sleeping. Ограничить locator timeout; неверный локатор/неожиданный direct route — ошибка инструмента, не пользователя.

Scope включает роли/состояния/desktop1440/mobile390, narrow360/keyboard/focus/error/recovery по применимости. Physical mobile/WebKit/spokenAT/browserzoom200 проверять если доступны; иначе конкретное NOT_TESTED, безCSSzoomподмены и без blanketPASS. [Внешние критерии](standards.md) отделяют WCAG minima от более сильных UX целей.

## Обязательный выход

Только `docs/audits/2026-09-13-ux-ui/PACKAGE_LOWER/**`: report.md, runs.csv, findings.json, target-spec.md, flow-report.html, requirement-coverage-delta.csv, evidence/, handoff.md, manifest.sha256. Возможны дополнительные structural wireframes/replay, если нужны. Canonical BACKLOG/STATUS/DECISIONS не менять: coordinator singlewriter. Каждая находка из templates: место/роль/state, repro+evidence, последствие, тип основания, priority/confidence, dependencies, точное remedy и сохранённые функции. Все поля заполнять, unknown с причиной вместо выдумки.

Target предложения не обязаны совпасть с пилотом: аргументированное улучшение допустимо, явные противоречия выносятся coordinator. Для значительных экранов схемыbefore/after390+desktop с аннотациями. В handoff дать кандидаты в задачи с автономными образами результата/GWT/крайними случаями, без новых canonical IDs. `requirement-coverage-delta.csv` сопоставляет каждую свою REQ строку конкретному run/evidence либо ограничению, не blanket PASS по посещению страницы.

Перед freeze выполнить локальные пути/ссылки, явные viewport/contrast measurements; manifest всех payload files исключает самого себя, self SHA сообщить отдельно. Никаких «готово» при скрытых blockers. Return READY_FOR_REVIEW/PARTIAL, exact paths, commandresults, newfindings/dedup/limits/cleanup. Время автоматизации не является пользовательским временем; интервью/эмоции без человека не проводились.
