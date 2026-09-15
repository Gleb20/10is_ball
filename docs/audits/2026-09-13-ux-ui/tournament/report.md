# TOURNAMENT: ограниченный UX/UI-аудит

Статус пакета: **READY_FOR_REVIEW; requirement coverage PARTIAL**. Приложение не изменено. Аудит выполнен 2026-09-14 на frozen `9f71b9f` + GAP-012 r6 (`8e876257…`), который принят локально 1257/1257, но не опубликован. Это экспертный проход с собственным Chromium/PostgreSQL runtime; пользовательское исследование не проводилось.

## Итог

Основной турнирный контур работоспособен и последователен: organizer без участия создаёт SE/DE, direct/consent roster сохраняет точные роли и источники добавления, V2 сетки 3/5/8 показывают BYE, participant видит следующий и текущий матч, finished результат совпадает с persisted state. Scoped admin не получает organizer lifecycle controls; participant/outsider write/read guards подтверждены 403; post-start add отклонён без частичной мутации.

Найдено пять P2: три воспроизведённых runtime-проблемы и две экспертные гипотезы. P0/P1 нет. Самый дорогой общий seam — защита переходов жизненного цикла: cancel, dissolve и generated-withdraw сейчас выполняются с первого нажатия, хотя их последствия выходят за рамки одной строки интерфейса. Второй структурный seam — комната показывает нулевые «Итоги» до завершения, в том числе withdrawn человека, и тем самым смешивает текущую работу с историческим результатом.

## Findings

| ID | Наблюдение и последствие | Приоритет / уверенность | Точный target |
|---|---|---|---|
| F-TOURNAMENT-001 | Cancel и dissolve мутируют state без dialog; случайное касание отменяет комнату или удаляет подготовленную расстановку | P2 / high | Именованный Dialog с последствиями; mutation только после confirm |
| F-TOURNAMENT-002 | Participant выходит после генерации без предупреждения; persisted status сразу `needs_regeneration` | P2 / high | Dialog только для generated state; до генерации быстрый выход сохранить |
| F-TOURNAMENT-003 | «Итоги» с тире/нулями видны в collecting/generated/in-progress и включают withdrawn историю | P2 / high | Показывать summary только в terminal states; stopped без выдуманных мест |
| F-TOURNAMENT-004 | Zoom начинается с 100%; «уменьшить» disabled, поэтому DE8 нельзя свернуть для обзора | P2 / medium | Добавить в существующий control ровно 75%; scroll/keyboard оставить |
| F-TOURNAMENT-005 | Default direct add требует native confirm без consent/regeneration/admin consequence | P2 / medium | Убрать confirm только у organizer + consent=false + collecting |

Полные формы: [findings.json](findings.json). Все пять относятся к каноническому work item `TECH-006`; новые backlog IDs в этом ограниченном writer scope не создавались. При синтезе F-001/002 должны стать одной implementation task общего confirmation/pending seam, а F-003/004/005 — отдельными проверяемыми subtasks, если root примет target.

## Что проверено

- Creation 390×844: title, formats, organizer participates, consent default, direct roster, guests, generated V2.
- Topology: SE/DE на 3/5/8, compact/power-of-two, visible BYE, 360×800 и 844×390 без document overflow.
- Bracket input: focus ring 3px, Arrow/Home/End, scroll to exact max, 100→125%; role links/buttons.
- Consent: accepted/pending/declined/expired/withdrawn, team membership, manual override notification, post-bracket regeneration confirmation.
- Roles: organizer, active participant, scoped admin, outsider; UI visibility и authoritative 403/400.
- Journey: next match → current match → advanced next match; stop reason; cancelled/stopped/finished summaries.
- Critical mutations checked both in UI and subsequent GET against disposable PostgreSQL 16.15.

[runs.csv](runs.csv) — единственная таблица результатов; [runtime-observations.json](evidence/runtime-observations.json) — machine-readable наблюдения; [requirement coverage](requirement-coverage-delta.md) не переносит чужой technical PASS в собственный UX PASS.

## Что сознательно не объявлено проверенным

- Нет сессии с реальным человеком, physical iPhone/Android, WebKit, spoken screen reader или browser UI zoom 200%.
- Max64/min-boundary, concurrent active-match race, no-show/manual-loss и legacy V1 DE не повторялись собственным browser-run; они помечены REUSED_TECHNICAL/PARTIAL.
- Ручной swap seeds не выполнялся; проверено сохранение prefix после поздних добавлений и accepted technical evidence.
- Network failure внутри build/stop dialog не инжектировался. BUG-021/022 остаются открытым dedup и не получили новый finding.
- BUG-018/019/020/023 не перепроверялись клавиатурой в picker; tournament journeys использовали touch/mouse. Их нельзя считать исправленными.

## Инструментальные ошибки, не findings

В подготовительных попытках: macOS sandbox запретил первый launch Chromium; один ранний прогон оставил одинаковые synthetic labels после остановки до browser launch; локатор ожидал старое aria-name band; mapping участника ожидал другое DTO-поле; scorer сначала не учитывал преимущество в два очка. В финальной серии были отдельно отброшены попытки с `127.0.0.1` вместо preview `localhost` и с двумя неточными ожидаемыми русскими строками error/status. Эти случаи исправляли только harness, не приложение; accepted evidence полностью перезаписан последним завершённым прогоном.

Пять console records объяснимы: три 401 — bootstrap-проверка `/auth/me` до login, 403 — ожидаемый outsider GET, ещё один 401 — такой же login bootstrap. Неожиданных pageerror нет.

## Целевая структура

[Target spec](target-spec.md) сохраняет текущую модель ролей, API, status machine, data и все функции. [Annotated before/after](annotated-before-after.html) показывает ровно два viewport: 390 и desktop. Это не редизайн бренда: меняются порядок/видимость блоков, условия подтверждения и один уровень существующего zoom.

Рекомендуемый порядок реализации после независимого review:

1. Общий Dialog/pending/error contract для cancel, dissolve и generated-withdraw, совместимый с BUG-021/022.
2. Terminal-only visibility «Итогов».
3. Сужение direct-add confirm matrix без изменения consent/admin/generated branches.
4. Zoom 75% с проверкой читаемости, focus и всех bands.

## Вердикт автора

`READY_FOR_REVIEW`, но не `ACCEPTED` и не полный acceptance TOURNAMENT. Reviewer должен сверить severity, что F-001/002 объединены по shared seam без смешения разных текстов/guards, что terminal summary не скрывает stopped/cancelled context, а 75% не делает карточки нечитаемыми. До такого review приложение и canonical backlog не менять.
