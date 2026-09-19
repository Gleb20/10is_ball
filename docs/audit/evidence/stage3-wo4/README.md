# Stage 3 WO4 — принятый inventory и локальный StatusChip sample

GAP-034 / AT-UI-STATUS-001. База: HEAD `550d3680a08a8faf4e1e4afbfcc373c942f155d0` + принятый WO3 R2 manifest SHA-256 `54860798d7c0744a838e7d1b299a2f44ea34f03c7e6176f7663afe51adc030fd`. [Отдельное разрешение координатора](/Users/liubavskii/Desktop/work/Codex/tab10/artifacts/ux-implementation-2026-09-18/stage3-wo4-target-acceptance-and-authorization.md) приняло target, но не реализацию, весь GAP-034 или этап 3. Перед изменением сохранён snapshot `/private/tmp/tab10-wo4-before-dkn8cp8t` и вновь сверены 124/124 базовых хеша. Позднейшая сверка и rollback trial записаны в `freeze-manifest.json`.

## Принятый вход и неизменные копии

[Первичный отчёт/target](inventory/inventory-target.md), [схема](inventory/status-chip-target.svg), [runtime](inventory/runtime.json), [контракт Chip](inventory/chip-contract.json), [receipt](inventory/receipt.json), 47 исходных снимков, script и логи скопированы побайтово из принятой папки `/private/tmp/tab10-wo4-preliminary`. [Хеши каждого файла](inventory-hashes.json) сохраняют принятую основу; новые артефакты лежат отдельно в `implementation/`. Исходные WO1–3 evidence/README и старый WO4 inventory не редактировались. В исходном отчёте абсолютные ссылки `/private/tmp` описывают место прогона; локальные кадры находятся рядом с его копией.

## Изменение

Только `apps/web/src/patterns.tsx`: публичное `startIcon={false}` и выделенный class у общего `StatusChip`; `apps/web/src/styles.css`: курсор наследует родителя, hover самого chip использует те же фон/рамку/текст. `pointer-events`, выделение текста, vendor, HomePage и остальные шесть прямых consumer страниц не изменены. В карточке-ссылке курсор остаётся `pointer`, переход и фокус остаются у ссылки; standalone badge имеет курсор своего контейнера. Локальные Chip Team/Profile, Judge serve/status и знаки сетки не затронуты.

Существующие `patterns.test.tsx` и `HomePage.test.tsx` уже покрывают текст статуса, Home карточку, фильтры, `winnerSide` при совпадающих именах, pending/empty/error и D37 preview. Тест, утверждающий лишь наличие нового prop/class, не добавлялся; observable CSS/DOM контракт проверен в Chromium.

## Браузер и составной контраст

Временная production-сборка из текущего source открыта через локальный `vite preview`. Все `/api/v1/*` ответы — синтетические перехваты; это не проверка серверных прав или persistence. [Полный runtime](implementation/runtime.json), [автоматическая сводка и пары контраста](implementation/verification.json), [скрипт](implementation/browser.mjs), [лог](implementation/browser.log) и 63 снимка сохранены. Всего 36 контекстов; каждый из 7 прямых consumers проверен на 360/390/1440 (21 контекст). Длинные названия и «Нужна перегенерация» проверены на узкой ширине.

108 общих chip: все без caret, `role=null`, `tabIndex=-1`, высота 24 px; курсор равен курсору родителя. 108/108 hover проверок показали неизменные computed background/border/color после наведения. У 52 пар, имевшихся в принятом inventory на тех же ширинах, совпали label, цвет, фон и высота. Keyboard Tab на семи разделах при 390 не дал ни одного chip tab stop; карточки-ссылки получили фокус. Клик по chip-площади Home/Matches сохранил переход всей карточки; standalone MatchDetail остался на текущем URL. Во всех 36 контекстах маркер виден, page errors/unknown API/горизонтального overflow нет. [Home](implementation/home-390.png), [MatchDetail](implementation/match-detail-390.png), [Admin](implementation/admin-chip-390.png), [длинный турнирный статус 360](implementation/tournaments-chip-360.png).

Контраст вычислен из фактических computed RGBA фона chip и всех фоновых слоёв его предков, затем прозрачный foreground составлен с результатом. В проверенных DOM нет background-image или opacity-слоёв, требующих иного метода. Получены четыре пары: purple 7.79:1, neutral 14.44:1, red 6.36:1, green 4.90:1; ниже 4.5:1 нет. Палитра не менялась. Home loading/empty/error, OS dark preference (обычный UI остаётся light), immersive Judge, bracket fate/champion, Team/Profile локальные chips и Auth eye сопоставлены с прежним synthetic runtime; доменная приёмка этих экранов не заявляется.

## Проверки и границы

- Focused `pnpm --filter @tab10/web exec vitest run src/patterns.test.tsx src/pages/HomePage.test.tsx`: 18/18, [лог](implementation/focused-tests.log).
- `pnpm --filter @tab10/web typecheck`: PASS, [лог](implementation/typecheck.log).
- `pnpm --filter @tab10/web test`: 287/287 в 42 файлах, [лог](implementation/web-tests.log).
- `pnpm --filter @tab10/web exec vite build --outDir /private/tmp/tab10-wo4-check/dist`: PASS, [лог](implementation/build.log). Сборка размещена только во временной папке.
- Coverage integrity и docs links/path/anchors, `git diff --check`: результаты в [логах](implementation/) и `freeze-manifest.json` после завершения ворот.

Full Stage 3 CI/compiled-browser/PostgreSQL, физический iPhone, WebKit, screen reader, реальные роли/API права и persistence не проверены. 47 первоначальных и 63 новых кадров — synthetic локальная эмуляция. Другие consumer изменения GAP-034 принадлежат этапам 6/8/9/10/11. Версия, commit, push и публикация не выполнялись.

## Работа независимого reviewer

Сверить `freeze-manifest.json` и WO4-only patch с базой R2; проверить CSS inheritance внутри ссылки и на standalone badge, отсутствие собственного hover/caret, сохранение текста/tone/высоты и возврата по карточке на [Home](implementation/home-390.png), [MatchDetail](implementation/match-detail-390.png), [Admin](implementation/admin-chip-390.png). Проверить 7 consumers по `implementation/verification.json`, составной контраст и unchanged local chips, затем точность статусов BACKLOG/PROJECT_STATUS/coverage. Не выводить из mock браузера права или завершение остальных этапов. При REWORK вернуть только WO4 delta; не менять frozen WO1–3 или принятый inventory.
