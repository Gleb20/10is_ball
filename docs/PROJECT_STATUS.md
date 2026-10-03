# Tab-10 — статус проекта

## Локально принятая программа интерфейса — 6.0.0

Полный CI **1881/1881** прошёл без failed/skipped/todo/interrupted:
компоненты/контракты, реальный disposable PostgreSQL и compiled браузер на desktop,
390 и 360 px. [Доказательства](audit/evidence/interface-completion-6/receipt.json).
Реализованы игровой черновик и атомарный старт, безопасное ведение и результат,
обновлённая сетка, гости с историей, дата турнира, аватары команд и ограниченное
admin recovery. Сверка всех 236 атомов — в
[реестре](audits/2026-09-13-ux-ui/implementation/completion-results.json).

Публикация 6.0.0 и exact-SHA parity ещё должны быть подтверждены. Физический iPhone,
невоспроизведённый Google Maps и WebKit/assistive technology указаны как ограничения;
это не утверждение, что пользовательская проверка на устройстве уже проведена.

## Опубликованный тестовый прод — 5.0.1, 2026-10-03

Версия **5.0.1** / `ed7fc113948387a6953b3a50cc7776248506051d` принята
по exact-SHA read-only public smoke 7/7, Vercel READY, Render live и всем четырём
GitHub CI jobs `37126838079`. Correlated reset UI включён после доказанного
server-first drain. Публичные reset/fixture мутации не выполнялись.
[Release](audit/evidence/stage12-enablement/client-release.json),
[smoke](audit/evidence/stage12-enablement/client-public-smoke.json).

На момент выпуска 5.0.1 решения D40 ещё ожидали реализации. Этот исторический
остаток закрыт локальной приёмкой 6.0.0 выше; публичное подтверждение новой версии
проверяется отдельно. Исторические кандидаты ниже сохраняются как журнал решений.

## Этап 12 — server-first выпуск проверен, включение UI 5.0.1

5.0.0 / `fd199db464b0a291209f92f528ebcfbad3e7056b` опубликован на Vercel
и Render. Четыре job GitHub CI `37124327468` завершились успешно; публичный
read-only smoke прошёл 7/7. Neon подтвердил восьмую миграцию 0007 и новые
receipt/pointer структуры. Старый Render deployment deactivated; после
консервативного окна остановки проверка Neon 13:01:50Z показала ноль старых
соединений и ноль открытых клиентских транзакций.

PATCH 5.0.1 включает `ADMIN_PASSWORD_RESET_ENABLED` и опубликован; exact-SHA
приёмка и публичные доказательства приведены в разделе опубликованного стенда выше.
Исходники API, схема и автомат состояний клиента не изменены. Web tests 452/452,
типы, сборка и docs audit прошли; один существующий тест уведомлений получил
ожидание начала запроса перед разрешением Promise. Доказательства
первого выпуска: [server release](audit/evidence/stage12-enablement/server-release.json),
[public smoke](audit/evidence/stage12-enablement/server-public-smoke.json),
[drain](audit/evidence/stage12-enablement/server-drain.json).

## Исторический снимок до публикации 5.0.0 — 2026-10-03

Следующий блок сохраняет состояние до выпуска. Его ограничения публикации и Neon
заменены проверенным server-first статусом выше; сведения о локальных тестах актуальны.

BUG-038 реализует коррелированный сброс пароля администратора: строгий UUID
`Idempotency-Key`, compare-and-set по последнему применённому request, безопасные
state/receipt GET без секрета, атомарные password/session/issue/audit/notification
записи и детерминированный порядок с login/first-change/change-password. Старый
POST без ключа теперь fail closed; поэтому первый выпуск имеет MAJOR-версию
**5.0.0**.

Включённый только для disposable local candidate UI прошёл compiled
production-like сценарий на 1440/390/360: 3/3 browser tests плюс 9/9 migration
foundation, реальный PostgreSQL, ровно один POST, HTTP 200 и последующий exact
receipt GET. Снимки сохранены до выдачи временного пароля. После проверки
source-controlled gate возвращён в `false`. Финальный удерживаемый кандидат
прошёл `pnpm run ci`: **1605/1605** без failed/skipped/todo/interrupted
(cleanup 4, quality 1376, PostgreSQL 96, browser 129). Evidence находится в
[`stage12-final-candidate`](audit/evidence/stage12-final-candidate/README.md).

Статус BUG-038 — `verified_local`. Публичный стенд не изменялся, migration 0007
на Neon не применялась. Первый server-first release обязан сохранить reset UI
disabled. Stage 12 остаётся незавершённым до доказанного вывода legacy fleet и
отдельного 5.0.1 enablement с повторной проверкой exact SHA/public parity.

## Этапы 5–7 — интегрированный локальный кандидат 4.3.0, 2026-10-03

Кандидат объединяет roster-first создание матча (GAP-013), безопасные Stage 6
judge seams (GAP-023 и ограниченная часть GAP-032) и pre-generation scope A
турнира (GAP-019/GAP-021). D38 сохранён: custom score и вручную изменённый
порог сухой победы живут только в текущей форме; новый reusable guest,
create/acquire/start, replay, ten-second Undo/archive и future scheduling не
добавлены. Полный GAP-019 остаётся `in_progress` до Stage 8.

До финальной заморозки focused component пакет прошёл 116/116. Exact compiled
Stage 5–7 browser пакет прошёл 12/12 journeys плюс 9/9 migration foundation на
1440/390/360, включая authoritative POST+GET, asymmetrical 2×2, 844 landscape и
CSS zoom 200%. Correction value probes дали 7.09–17.79:1, выбранный Guest — не
ниже 4.5:1. Финальная Stage 6 регрессия отдельно сохраняет полное отображение
допустимого длинного имени без пробелов и реалистичного имени с пробелами,
совпадение строк счёта и отсутствие горизонтальной обрезки. Один диагностический
reflow запуск поймал измерение до стабилизации layout; после ожидания fonts/two
animation frames одинаковый runtime прошёл во всех трёх проектах. Финальный
exact-tree `pnpm run ci` прошёл **1563/1563** без failed, skipped, todo или
interrupted: cleanup foundation 4/4, quality 1343/1343, disposable PostgreSQL
90/90 и compiled production-like browser 126/126 (117 сценариев + 9 foundation).
Результаты и визуальные свидетельства сохранены в [Stage 5–7 candidate
evidence](audit/evidence/stage567-final-candidate/receipt.json). После заморозки
Terra вернула PASS без P1/P2, а root повторно проверил 33 source и 26 evidence
hashes, exact forward/rollback и репрезентативные кадры. [Финальная локальная
приёмка](audit/evidence/stage567-final-acceptance.json) перевела 44 точно
закрытых атома этапов 5–7 в `verified_local`; реестр сохранил 236 строк, 82
эпизода и 38 expert ID.

Версия 4.3.0 опубликована на SHA
`43f4b2425cc0c79b5ad6cf192abb5802c3559e50`: GitHub CI run `37117863589`
прошёл все четыре jobs, Vercel вышел в READY, Render — в live, read-only public
smoke прошёл 7/7 с одинаковыми version/SHA на web, API и proxy.
Physical iPhone/touch, browser UI zoom, pinned WebKit, spoken AT и published
device parity для 4.3.0 не проверялись; synthetic pointer move/cancel не выдаётся
за физический touch test.

## Этап 14 — интегрированный локальный кандидат 4.2.0, 2026-10-03

На точной базе опубликованной версии 4.1.2
`220c4df18ed31ad3e741a282513545c4ef987fbc` сведены принятые Stage 9/10/11:
list-first Teams с безопасными настройками и подтверждениями, History с обеими
сторонами и поиском по каждому участнику, admin catalog/account card с безопасной
страничной историей действий. GAP-022/024/026/027 и BUG-034/035 получили
`verified_local`; Stage 6 в этот кандидат не входит.

Focused web прошёл 88/88. После исправления маршрутизации нового PostgreSQL-теста
zero-skip quality lane прошёл 1323/1323, PGlite cursor regression — 8/8,
disposable PostgreSQL — 90/90, cleanup foundation — 4/4. Compiled production-like
browser прошёл исходную матрицу 12/12 плюс 9/9
foundation на 1440/390/360; обязательная коррекция узкой History затем прошла
3/3 плюс 9/9, включая длинные имена 2×2, отдельный счёт сторон, admin delete и
360 CSS zoom 200%. Coverage остаётся ровно 236 атомов: сохранены семь ранее
принятых строк 4.1.2 и добавлены семь evidence-bound результатов Stage 9/10/11.

Первый локальный `pnpm run ci` до этой коррекции не считается зелёным:
cleanup 4/4 прошёл, но quality формально завершился 1278/1279 из-за ошибочного
включения `gap-026.postgres.integration.test.ts` без тестовой PostgreSQL; прогон
остановился до PostgreSQL и browser lanes. Ошибка конфигурации исправлена, а
финальный exact R2 `pnpm run ci` прошёл **1531/1531** без failed, skipped, todo
или interrupted: cleanup 4/4, quality 1323/1323, PostgreSQL 90/90 и compiled
browser 114/114 (105 сценариев + 9 foundation). Terra проверила frozen R2,
включая границу PostgreSQL offset ±15:59 и разделение fast/PG lanes, и вернула
PASS без P1/P2. Последовательность, source manifest и синтетические визуальные
свидетельства зафиксированы в [Stage 14 receipt](audit/evidence/stage14-final-candidate/receipt.json).
Exact-tree hosted CI остаётся обязательным gate выпуска.
Physical iPhone, pinned WebKit, browser UI zoom, spoken AT и published parity не
проверены. Commit, push, tag и deploy не выполнялись.

## Этап 4 — локальный кандидат 4.1.2, 2026-10-03

Опубликованный тестовый прод Vercel + Render + Neon подтверждён read-only smoke
как версия **4.1.1** на
точном application SHA `8b9d2650f7991e121052634ace758f5991ef25b5`: web, API,
proxy и readiness согласованы. Первичные `429`/timeout при проверке сохранены как
transient observations без доказанной причины; инфраструктура не менялась.

На этой опубликованной базе собран локальный PATCH-кандидат **4.1.2** для Stage 4:
BUG-029 score recovery, BUG-031 correction focus и BUG-039 absolute correction
recovery. В общий кандидат также встроены принятые R2 пакеты Stage 13
(GAP-014/016) и Stage 10 (BUG-036/037); GAP-024 остаётся открытым.

Единый финальный `pnpm run ci` прошёл **1442/1442** без failed, skipped, todo
или interrupted: cleanup foundation 4/4, quality 1275/1275, disposable PostgreSQL
84/84 и compiled production-like browser 79/79 (70 сценариев + 9 foundation).
Все 44 файла frozen source совпали с manifest после gate; Terra проверила полный
44-file delta и вернула PASS, root forward/reverse manifest review также PASS.
BUG-029/031/039, BUG-036/037 и GAP-014/016 получили `verified_local`. GAP-024
остаётся открытым. Локальная одноразовая БД удалена; данные опубликованного
тестового прода не сбрасывались и не использовались как fixtures. Frozen R2 и
диагностические evidence не переписывались. Физический iPhone, pinned WebKit и
spoken AT не проверены. Commit, push, tag, deploy и публичные мутации не
выполнялись; кандидат остаётся unreleased.

## Исторический локальный aggregate candidate этапа 3, 2026-09-19

WO1 R2, WO2 R2, WO3 R2, ограниченный WO4 common sample и последующая
регрессия позднего каталога сведены на точной базе
`550d3680a08a8faf4e1e4afbfcc373c942f155d0`. Версия локального кандидата была
`4.1.1`; на момент этого исторического checkpoint публичный стенд оставался на
`4.1.0` и том же base SHA. Финальная
проверка качества исправленного дерева прошла 1193/1193. PostgreSQL 72/72 был
проверен в агрегате до frontend-only коррекции; сервер, схема и миграции после
него не менялись.

Единственный полный `pnpm run ci` не считается успешным: cleanup 4/4, quality
1188/1188 и PostgreSQL 72/72 прошли, но macOS sandbox запретил запуск Chromium,
поэтому browser lane завершился 0/60. Полная команда не повторялась. Вне sandbox
исторический прогон до последней коррекции прошёл 60/60 браузерных сценариев и
9/9 foundation. Первый полный прогон исправленного дерева прошёл 59/60 и 9/9:
один desktop GAP-012 timeout ожидания первой option не воспроизвёлся на mobile
и не получил доказанной причины. Финальный разрешённый прогон исходного порядка
на свежем disposable PostgreSQL прошёл 60/60 и 9/9. Пассивная диагностика в
реальных desktop/mobile fixtures сохранила query, identity поля и выбор без
blur, преждевременного закрытия или page error. Этот зелёный прогон не объясняет
причину более раннего таймаута и не делает его доказанно harmless, pre-existing
или fixed.

Адресная матрица GAP-012 на одном disposable PostgreSQL и compiled desktop
Chromium прошла 4/4 плюс 9/9 foundation. Управляемая вставка трёх групп
рекомендаций высотой 476 px проверила ответ до фокуса, между фокусом и вводом,
по событию ввода и после `fill`. В двух последних фазах список монтировался при
поле за 12 px boundary, затем штатный scroll возвращал поле в видимую область;
query, identity поля и выбор сохранились. Это не доказывает отсутствие редкой
гонки. Один boolean helper (`vendorDOMShapeMatches`) оказался непригоден: он
требовал `data-readonly` у редактируемого поля; raw geometry и порядок событий
сохранены с явным ограничением в
[матрице](audit/evidence/stage3-final-regression/gap012-filled-matrix/README.md).

Coverage сохраняет 236 атомов и согласует 23 строки этапа 3: 19 локальных
overlay и четыре явных остатка. BUG-018/020/021/023/024/025/026/027/028 получили
`verified_local`; BUG-019 остаётся `in_progress` из-за physical
keyboard/safe-area и нерешённой причины таймаута; BUG-022 остаётся
`blocked_decision` по Q-UX-001; BUG-040 — `confirmed` до воспроизведения на
физическом iPhone; GAP-034 остаётся `in_progress` за пределами общего
`StatusChip`. Физический iPhone, WebKit и spoken AT не проверялись. Commit,
push, tag, публикация и публичные мутации не выполнялись.

## Этап 3 WO3 R2 — адресная коррекция версии сетки, 2026-09-19

После Terra REWORK для frozen WO3 R1 добавлена [ограниченная проверка](audit/evidence/stage3-wo3-r2/README.md): подтверждённый POST версии N больше не принимает readback GET с отсутствующей, нечисловой или более старой версией. Red: 2 failed / 11 passed; focused Green: 13/13, весь web 287/287, typecheck и аудит документов прошли. Диалог и запрет повторного POST сохраняются до явного GET с актуальной версией. WO3 R1 визуальный пакет и предыдущие evidence остаются неизменными. Эта R2 позже принята Terra/root как локальный checkpoint; общий Stage 3 CI остаётся впереди, а WO4 уже получил отдельное разрешение.

## Этап 3 WO3 — локальный кандидат для независимой приёмки, 2026-09-19

На принятой точной базе WO2 R2 подготовлен ограниченный WO3 для BUG-021/024/026:
отправленные поля матча и ручного включения не меняются во время запроса;
подготовка судьи сохраняет подтверждённый старт и не повторяет неизвестный
setup; ошибка сетки находится в открытом Dialog, а неизвестный исход не
разрешает второй POST даже после проверки состояния или повторного открытия.
Ошибка Judge и подписи ручной коррекции читаемы на тёмном фоне. [Evidence]
(audit/evidence/stage3-wo3/README.md): meaningful Red, focused 66/66, весь web
suite 284/284, typecheck, build и production-preview Chromium Green на
синтетическом mocked API. Контраст текста Judge 7.50:1, подписей 15.47:1.

Это проверка клиентского состояния и чтения из синтетического in-memory store,
не доказательство PostgreSQL persistence. Эта база позже принята Terra/root; полный
Stage 3 CI, физический iPhone, WebKit и spoken AT не проверены. WO4, версия,
commit/push и публикация не выполнялись. Отдельное предсуществующее наблюдение
dev StrictMode записано как открытый BUG-041; аналогичный production-дефект не
доказан. WO1 и WO2 R2 приняты как локальный
checkpoint; исторические записи ниже отражают их состояние на момент создания.

## Этап 3 WO2 R2 — адресная коррекция для review, 2026-09-19

Terra вернула WO2 R1 на доработку: повторная синхронная ошибка несовпадения с
тем же текстом не возвращала фокус Alert. Отдельный [R2 Red/Green]
(audit/evidence/stage3-wo2-r2/README.md) подтвердил это в тесте и Chromium;
после адресного изменения каждый явный неуспешный submit фокусирует одно
сообщение, редактирование не крадёт фокус. Независимый замер всех четырёх полей
обнаружил Email 14 px при паролях 16 px; теперь все поля AuthLayout имеют минимум
16 px. Focused auth/reauth/guard 20/20, весь web suite 272/272 в 42 файлах,
typecheck, build и Chromium 360 Green прошли; эта R2 позже принята Terra/root.

Это не доказательство причины или устранения persistent zoom на физическом
iPhone; BUG-040, autofill, WebKit, системная клавиатура/VisualViewport и spoken
AT остаются непроверенными. WO2 R1 и WO1 evidence не перезаписывались;
совокупный Stage 3 CI, commit/push/version/deploy не выполнялись.

## Этап 3 WO2 — локальный кандидат для независимого review, 2026-09-19

После Terra PASS и root-приёмки WO1 R2 реализован ограниченный WO2 для Login и
обязательной смены первого пароля. [Real API Red/Green](audit/evidence/stage3-wo2/README.md)
на одноразовой in-memory PGlite подтвердил: прежний Exit оставлял текущий
`/auth/me` 200 без logout POST; новый посылает один POST, текущая сессия получает
401, вторая сессия того же пользователя остаётся 200, Back ведёт на Login.
Формы получили встроенное независимое раскрытие паролей, единую защиту
ожидания, доступные сообщения об ошибках и перевод известных причин политики.
Существующее восстановление внутреннего route/query/hash и safe in-memory draft
после reauth того же actor сохранено; другой actor получает чистую форму.

Focused auth/reauth/guard tests 18/18, весь web suite 270/270, typecheck и
production build прошли. Локальный Chromium проверил 10 состояний Login и
FirstPassword на 360/390/1440, CSS zoom 200% и OS dark preference, плюс два
held-request сценария. App по-прежнему фиксирует light theme; CSS zoom не
подтверждает persistent iPhone zoom. Autofill, physical iPhone/keyboard/safe
area, WebKit и spoken AT не проверены. BUG-040 остаётся открытым; Judge
landscape/rotation — этап 6. Эта база позже принята Terra/root; совокупный Stage 3 CI, commit/push,
версия и публикация ещё не выполнялись.

## Этап 3 WO1 R2 — кандидат после замечания Terra, 2026-09-19

R1 получил `REWORK` за короткую обрезающую область, где popup сохранял
`top: 0`, активная опция была скрыта, а ручная прокрутка центрировала поле.
Адресный R2 повторил этот Red на настоящем Autocomplete и исправил размещение:
при недостатке места внутри локального контейнера список использует доступную
область окна; после одной попытки прокрутки границы измеряются заново.
[R2 evidence](audit/evidence/stage3-wo1-r2/README.md) содержит clip rects,
проверку вложенного Dialog, семь page/Dialog viewport cases, состояние
поля/выбора/radio на 360 px и CSS zoom reflow. Web tests 261/261, typecheck и
build прошли с сохранёнными логами. Эта R2 позже принята Terra/root; полный
Stage 3 CI, device/AT проверки, commit и публикация не выполнялись.

## Этап 3 WO1 — локальный кандидат, 2026-09-18

На принятой базе `550d3680a08a8faf4e1e4afbfcc373c942f155d0` подготовлено
ограниченное исправление BUG-018/019/020/023/025 и AUTH-004/a01: выбор игрока,
поиск слов имени, геометрия списка, фокус и состояния каталога/передачи
судейства. Fresh Red и локальный Chromium Green с измерениями 360/390/desktop,
прокручиваемым диалогом, турнирным/командным picker и judge handover записаны
в [evidence WO1](audit/evidence/stage3-wo1/geometry.json). Web tests 261/261,
typecheck и production build прошли. Этот R1 был историческим кандидатом; после Terra REWORK адресный R2 принят Terra/root как локальный checkpoint. Общий Stage 3 gate остаётся впереди; commit/push/deploy не выполнялись.
Физический iPhone, WebKit, системная клавиатура и spoken AT не проверялись.

## Этап 2 D36 — завершённая публикация 4.1.0, 2026-09-18

После первоначального выпуска corrective test-only commit
`550d3680a08a8faf4e1e4afbfcc373c942f155d0` опубликован в `main`.
Hosted CI `35388043867` для точного SHA завершился `success` во всех четырёх
jobs, включая compiled browser и Release gate. Read-only public smoke подтвердил
тот же SHA и 4.1.0 на web/API/proxy за 19 попыток/96188 ms; Render `/ready`
вернул `database=ok`. [Терминальный receipt](audit/evidence/stage2-terminal-release-receipt.json).
Первая неуспешная CI попытка ниже остаётся историческим фактом. Read-only
проверка выпуска не является приёмкой пользовательских сценариев на публичных
данных; GAP-030/031 и device/AT ограничения остаются открытыми.

## Этап 2 D36 — исторический первый выпуск 4.1.0, 2026-09-18

Application commit `0279657b227bd6ca10116376bec0e2e11561ab4b`
fast-forward опубликован в `main` через штатные Render/Vercel Git-интеграции.
Read-only `pnpm run smoke:public` подтвердил тот же SHA и версию 4.1.0 на
Vercel web/proxy и Render API (14 попыток, 70276 ms); прямой `/ready` вернул
`status=ready`, `checks.database=ok` и тот же release. Публичная проверка
подтверждает идентичность и доступность выпуска, а не выполнение пользовательских
сценариев на публичных данных. [Публичный receipt](audit/evidence/stage2-public.json).
GAP-015 и 23 атома этапа 2 сохраняют `verified_local`; GAP-030/031 остаются
`in_progress` по ограничениям ниже. Публичные мутации, ручная миграция и seed не
проводились.
Hosted CI run `35385224009` для application SHA завершился `failure`:
Quality и PostgreSQL integration прошли, browser lane — 58/60 из-за двух
strict-locator ошибок одного теста AT-HOME-003 на desktop/390; Release gate
корректно отклонил выпуск. [Диагноз и локальный Red/Green](audit/evidence/stage2-ci-correction.json)
фиксируют тестовое уточнение и свежий compiled browser 69/69 на отдельной
одноразовой БД. Corrective commit и новый hosted CI ожидают review; техническая
приёмка публикации ещё не завершена.

## Этап 2 D36 — исторический локальный checkpoint до выпуска 4.1.0, 2026-09-18

[Финальный receipt](audits/2026-09-13-ux-ui/implementation/stage2-final-evidence/stage2-final-receipt.json)
связывает base `e3b22876d6a60f88658c7628bf12a95a92466894`, frozen R2 v2
manifest `54e922b791dcbdb4c0594a691f108cf48c82627c68c1ccc37c4fc0081d9bdf8c`,
Terra PASS, root scope/visual/rollback PASS и единый `pnpm run ci` **1291/1291**:
cleanup 4, quality 1146, PostgreSQL 72, compiled browser 69. Ноль failed,
skipped, todo или interrupted; все 74 source hashes совпали после CI. R1 и
первый R2 freeze сохранены неизменными, commit/push/deploy не выполнялись.

Текущая часть GAP-015 принята `verified_local`; GAP-030 остаётся `in_progress`
из-за Browser Back из Judge, который оставляет судейский слот занятым (явный
Home release подтверждён сервером). GAP-031 остаётся `in_progress` только из-за
невоспроизведённого HOME-003 Maps/iPhone; принятые 23 пользовательских атома
этапа 2 имеют evidence-bound `verified_local`. Совместимый
`activeEvents.tournament` сохраняет `topThree` одного выбранного чужого
активного турнира admin без включения чужого каталога в `currentTasks` и без
full-detail fanout. Физический iPhone, WebKit, spoken AT и пользовательская
приёмка не проводились. Публичный стенд остаётся на 4.0.0; 4.1.0 не опубликован.

## Этап 2 D36 — исторический R1 кандидат до R2 приёмки, 2026-09-18

В worktree от опубликованной базы `e3b22876d6a60f88658c7628bf12a95a92466894`
подготовлены GAP-030/031 и актуальная часть GAP-015: Home как глобальный вход,
текущие дела по роли, прямые создание матча/турнира, фильтр «Только мои» до
ограничения пятью, контекстный возврат из истории и сетки. Совместимый
`activeEvents` сохранён, добавлены `currentTasks`/`recentRole`; новых миграций нет.
Версия 4.1.0 — локальный кандидат. Публичный стенд остаётся на 4.0.0, пока
координатор не примет diff и не разрешит публикацию. Статусы GAP-030/031/015
`in_progress`; независимый review ещё не зафиксирован. Compiled Chromium
desktop/390 + 9 migration foundation прошёл 67/67 на изолированном PostgreSQL.
Явная кнопка Home из Judge освобождает слот; Browser Back в обоих браузерных
проектах оставил слот активным и записан как остаточный край GAP-030.
[Локальный receipt этапа](audits/2026-09-13-ux-ui/implementation/stage2-evidence/stage2-local-receipt.json)
разделяет финальные quality/browser lanes, PostgreSQL после API-дельты и
предшествующий неуспешный агрегат. Финальный `verify:fast` — 1141/1141.

## GAP-029, этап 1 verified_prod — 2026-09-18

Опубликованная версия 4.0.0 на базе документационного stage 0 скрывает игровые и
турнирные приглашения, вызовы и реванши во всём новом UI. Ручной матч не
отправляет приглашения; турнир создаётся без consent policy. Team invitations,
judge handover, старые API и pending записи сохранены. Новый web использует
`notificationView=available` для списка, Home и `read-visible`; без параметра
старые клиенты сохраняют прежнее чтение собственных notification IDs. FAQ и
onboarding copy согласованы с временной доступностью.

Fresh `pnpm run ci`: 1264/1264, 0 failed/skipped/todo/interrupted; quality1129,
PostgreSQL72, browser59 (50 Chromium journeys desktop/390), cleanup4.
[Локальный gate](audit/evidence/gap029-stage1-local.json) и
[итоговый receipt](audit/evidence/gap029-stage1-final.json) связывают frozen R1,
Terra PASS и просмотр десяти compiled desktop/390 кадров. Шесть строк GAP-029
в атомарном реестре имеют `verified_local` с точным evidence overlay; остальные
строки не изменены. Координатор принял stage 1 локально. Пустая рамка быстрых
подсказок на MatchCreate существовала на исходной базе и остаётся в GAP-013.
Первые два диагностических прогона: sandbox заблокировал запуск Chromium, затем
старый E2E request matcher не учитывал opt-in query; после исправления matcher
полный gate прошёл. Commit `6b43d340fd9c11409ee70f378650436c3c569d72`
fast-forward опубликован в `main`: read-only public smoke подтвердил 4.0.0 и
exact SHA на web/API/proxy за 2 попытки/6903 ms, Render `/ready` показал
`checks.database=ok`; Vercel commit status — `success`.
GitHub CI 35367073709 для того же SHA завершился `success` во всех четырёх jobs.
[Публичный receipt](audit/evidence/gap029-stage1-public.json). Пользовательская
приёмка на телефоне ещё не проводилась. Серверная пагинация уведомлений и
последующие страницы AT-UI-INV-002 остаются будущим контрактом.

## Интерфейсная программа, этап 0 accepted_local — 2026-09-18

На чистом исходном SHA `17a69cacde94c12b7b754e8909dae12cc73a700f`
принята локально документационная база D36/D37. [Receipt](audits/2026-09-13-ux-ui/implementation/stage0-acceptance.json)
отделяет эту приёмку от runtime этапов 1–14. Новый
[план](test-plans/TECH-008-interface-programme.md) и
[атомарный реестр](audits/2026-09-13-ux-ui/implementation/coverage.csv)
сопоставляют 82 уникальных эпизода и 38 экспертных ID; это покрытие источников,
а не готовность 82 функций или runtime acceptance. Прежние 35 ready / 3 blocked
ниже — исторический экспертный checkpoint до нового overlay. Качественный
feedback одного автора с prior exposure не доказывает U01/U03/U05, API/DB
сохранность или физическое исправление zoom; оригиналы 19+25 кадров не включены
в репозиторий. [Visual receipt](audits/2026-09-13-ux-ui/implementation/sources/primary-visual-receipt.json)
фиксирует просмотр всех 44 кадров Luna и две независимые spot checks координатора:
видимые состояния согласуются с отчётами, а касания/runtime/zoom этим не доказаны.
После независимого review реестр содержит 236 атомарных строк: GAP-019 разделён
на последовательные stage 7/8 subscopes одной задачи, а UI-001/GAP-034
получили межэкранный status/icon inventory в stage 3. `ready` GAP-013/017/019
относится только к ограниченным исполнимым частям; идеи за Q-UX-004–010
ожидают решений, runtime acceptance по новым AT не проводилась.
На момент этапа 0 пять tabs и invitation UI оставались as-built до этапов 1/2. TECH-007
`verified_local` для правила обязательного SemVer при будущем разрешённом выпуске;
TECH-008 остаётся `in_progress` до завершения программы. Стадия 0
не меняет версию 3.0.0, runtime и публичный стенд. Q-UX-001..011 остаются
решающими воротами для зависимых механик. GAP-011/TECH-002 проверяются заново
после соответствующего этапа.

## UX/UI исследование — 2026-09-15

TECH-006 выполняется на опубликованной GAP012-r6 базе: local1257/1257, independent Terra/root acceptance, hosted CI и exact-SHA public smoke. Пилот и COMPONENTS/AUTH/MATCH/JUDGE/TOURNAMENT/TEAM/RESULTS/ADMIN приняты с обязательными corrections и явными ограничениями. Дополнительная ручная коррекция, reset-контракт и финальный экспертный синтез приняты. [Исследование и ограничения](audits/2026-09-13-ux-ui/README.md), [финальное review](audits/2026-09-13-ux-ui/final-review.json).

35 постановок готовы к будущей реализации, включая проверенные target-контракты восстановления счёта и сброса пароля. BUG-022/GAP-025/GAP-028 зависят от Q-UX-001/002/003. Central coverage:108 требований,72 scenario/device rows; это учёт проверок и ограничений, не blanket PASS. Пользовательское прохождение ещё не проведено. [Обзор](audits/2026-09-13-ux-ui/review-index.html), [очередь инкрементов](audits/2026-09-13-ux-ui/delivery-map.md).

Координатор лично воспроизвёл BUG-029(P1): после сохранения очка и потери ответа интерфейс предлагает повторить; новое нажатие создаёт второе очко. Это не автоматическое дублирование. Принят точный recovery target с проверкой ключа, версии и отдельной судьбой очереди. [Приёмка core](audits/2026-09-13-ux-ui/core-review.json), [турниры/команды](audits/2026-09-13-ux-ui/social-review.json). UI-рекомендации не реализованы; исходный dirty checkout сохранён.

## GAP-012 опубликован для UX-тестирования — 2026-09-15

Application commit `682c98066ad80e2373a7893cc71482003e9eee42` опубликован native Git-интеграциями на [публичном стенде](https://tab-10.vercel.app). Render API, Vercel web/proxy и `/ready` подтвердили exact SHA, версию3.0.0 и готовую БД; `pnpm run smoke:public` прошёл за10 попыток/49062ms. GitHub CI34926424343: Quality, PostgreSQL integration, compiled browser production-like и Release gate завершились success. Vercel deployment6451307944 завершён success; Render control-plane ID недоступен без CLI/MCP, поэтому его live-состояние подтверждено runtime exact-SHA health/readiness. [Redacted evidence](audit/evidence/gap012-public.json).

Migration0006 применялась только штатным startup `--mode=apply`; reset/seed/down-migration/public E2E не выполнялись. Миграция аддитивна, исторический upgrade и сохранение legacy rows проверены локально в PostgreSQL gate. Публичный row-count не запрашивался: отсутствие потери данных подтверждается forward-only путём, readiness и тестами миграции, а не отдельной выборкой пользовательских данных. Чистый local exact-SHA стенд работает на `http://localhost:5174`; сохранённая локальная PostgreSQL и исходный dirty checkout не сбрасывались.

## Публичная версия 3.0.0 — 2026-09-13

Релиз D+E+F и BUG-017 опубликован на [публичном стенде](https://tab-10.vercel.app).
Commit `165aecdaaa2eba6ffa5fd9d39926bca155016c95`: Render live, Vercel READY;
GET-only smoke подтвердил3.0.0 и одинаковый SHA у web/API/proxy.
GitHub CI34746947853: все4 jobs success. Локально1249/1249 без пропусков.
[Подтверждение публикации](audit/evidence/release-3.0.0-public.json).

GAP-011/TECH-002 остаются in_progress: WebKit native crash, физические мобильные
устройства, spoken AT и полная матрица версий браузеров ещё не приняты.
Следующий ограниченный QA-этап: совместимый WebKit runner, затем устройства/AT;
перед каждой задачей повторно подтвердить актуальность остатка. Q-OPS-003 и
SEC-001 negative probe сохраняются. Публичные данные не использовались как E2E fixture.
Ниже — исторические checkpoints. Эта запись фиксирует проверенный code commit;
последующий commit с evidence меняет только документацию, без новой версии.

## Исторический локальный checkpoint после 3.0.0 — GAP-012

Ниже сохранено предпубликационное состояние, superseded публикацией 2026-09-15 выше. D35 отделяет
владельца standalone match от игровых slots: manual setup по умолчанию создаёт
A-vs-B оператором C без автоматических invitations и без consent gate на start.
Tournament creation сохраняет immutable consent policy; organizer/active admin
получает отдельно подтверждённый registered-user add, а post-bracket add до старта
атомарно перестраивает сетку с сохранением seed prefix. Новый migration ledger —
`0006_gap_012_game_setup.sql`. Focused API/OpenAPI/PGlite/component и real
PostgreSQL concurrency и fresh full gate1257/1257 прошли;50 browser journeys подтверждены на desktop/390. Independent Terra review и приёмка координатора PASS. [Evidence](audit/evidence/gap012-local.json).
Версия остаётся 3.0.0; прежнее отсутствие разрешения на commit/push/deploy снято отдельной задачей публикации.


## Release 3.0.0 — pre-publication checkpoint, 2026-09-13

Пользователь подтвердил выпуск. Свежий полный `pnpm run verify:all` на версии
**3.0.0: 1249/1249 PASS**, без failed/skipped/todo/interrupted; 449 файлов
сохранили идентичность во время проверки. [Релизное evidence](audit/evidence/release-3.0.0-local.json).
Следующий шаг этого checkpoint: commit/push main по D32, hosted CI и GET-only
exact-SHA smoke web/API/proxy. Публикация пока не заявлена. Ниже — предыдущая
приёмка и её сохраняющиеся WebKit/device/AT ограничения.


Обновлено: **2026-09-13**. Текущий локальный кандидат D+E+F и BUG-017 принят
основным gate **1249/1249**. Предыдущая версия под тестом2.1.0, base615169c; это dirty
кандидат, не новый опубликованный release. Публичная2.1.0 известна из прежнего
exact-SHA smoke и в этой приёмке заново не проверялась.

## Текущая приёмка

- `pnpm run verify:all`: quality1122, PostgreSQL66, browser57
  (48 desktop/mobile journeys +9foundation), cleanup4; ноль ошибок/пропусков.
- F16 файлов и отдельное исправление WaveB period fixture проверены независимым
  review. Snapshot447 файлов не изменился во время полного gate.
- BUG-017:409 вместо500 при судействе из второй сессии; verified_local.
- Дополнительно Playwright Firefox155.0:7/7. WebKit26.6:7 падений native runtime
  при создании страницы до проверок приложения. Общий compatibility lane failed,
  исходники/сборка689 файлов сохранены, disposable resources удалены.
- GAP-011/TECH-002 остаются in_progress для WebKit, последних двух версий
  браузеров, реальных iOS/Android/safe-area/keyboard и screen-reader acceptance.
  Axe22 Chromium +11 Firefox reports без violations; incomplete не объявлены PASS.

[Полное локальное evidence](audit/evidence/wave-f-local.json),
[ограничения совместимости](audit/evidence/wave-f-compatibility.json),
[очередь и handoff](test-plans/OPS-004-coordinator-handoff-2026-09-13.md).
Оригинальное dirty-дерево сохраняется отдельно. Пользователь явно подтвердил выпуск3.0.0; root version обновлена. Новый локальный gate, commit/push и exact-SHA public/CI проверка ещё предстоят. Прежнее ожидание approval снято этим подтверждением.

Ниже сохранены исторические этапы; их прежние pending/counts не заменяют текущую
приёмку выше. Q-OPS-003 и независимый negative probe SEC-001 остаются отдельными
известными ограничениями, не скрываются общим зелёным gate.

## История этапов и прежние снимки

Выполняется принятый план завершения PRD v2 волнами A–F:
[очередь и критерии приёмки](test-plans/OPS-004-completion-waves.md).
Волны A и B опубликованы. Для B GET-only smoke подтвердил
`8f36941b283a678105558656b1fb3b343546d999`, version `2.0.0` у web/API/proxy;
GitHub CI `34728440590` завершился success во всех четырёх jobs.
Функциональные сценарии проверены на локальных синтетических данных;
public smoke подтверждает идентичность релиза и доступность, без мутаций.

Wave B GAP-002/003/004: `verified_local`, полный `verify:all` — 1010/1010
(quality 945, PostgreSQL 42, browser 19, cleanup 4), без failed/skipped/todo/interrupted.
Повторный browser gate с проверкой загруженной карточки — 19/19.
Desktop/390 profile, rankings и history return просмотрены.
[Обезличенные доказательства](audit/evidence/wave-b-local.json).
Исходные 186 файлов сохранены без изменений.

## Волна D принята локально — кандидат 3.0.0

GAP-006 `verified_local`: настройки и invalidation/regeneration сетки, seed/BYE
swaps, organizer-owned start/stop/cancel/dissolve, V2 SE/DE 3/5/8, persisted
summary с current/next, duration, results, top-3 и персональным highlight. Причина
остановки вводится и сохраняется; stopped tournament не получает places/top-3,
а D33 void исключается из статистики без разрушения bracket places.

GAP-007 `verified_local`: team create/detail/edit, welcome, invite history и
respond, captain transfer, member removal, leave, automatic archive и использование
active own team в event picker. Privacy-safe DTO и transactional PostgreSQL tests
проверяют current/former/pending access, captain invariants и atomic
block→captain reassignment/archive.

Первый полный aggregate прошёл **1133/1133**. Последующий rendered review обнаружил
ложную подсказку о следующем auto-BYE матче в завершённом турнире; regression был
Red, исправление прошло 17/17 focused tests и web typecheck. Финальный aggregate
после исправления прошёл **1135/1135**: quality 1034, PostgreSQL 56, browser 41
(32 journeys + 9 foundation), cleanup 4, без failed/skipped/todo/interrupted.
Desktop и 390px исправленного terminal state, а также landscape bracket просмотрены.
[Доказательства](audit/evidence/wave-d-local.json). Исходные 186 файлов сохранены
без изменений. Публичного Wave D release нет; root остаётся на 2.1.0 до отдельно
одобренного direct release 3.0.0.

## Волна C принята локально — кандидат 2.1.0

GAP-005 verified_local: полный `verify:all` **1056/1056** (quality980,
PostgreSQL47, browser25, cleanup4), ноль ошибок/пропусков. 16 compiled browser
journeys включают создание 2×2, неявку/реванш, коррекцию/Undo/передачу судейства
и отдельные сессии создателя и судьи. Desktop/390 captures просмотрены.
[Доказательства](audit/evidence/wave-c-local.json). Публикация подтверждена: main615169c, CI34730792219 all four jobs success, GET-only exact-SHA smoke web/API/proxy; Neon ledger5 и новые поля подтверждены read-only.
Это утверждение описывало состояние после Wave C и теперь частично superseded:
GAP-006/007 локально проверены в Wave D; GAP-008..011
и полный TECH-002 остаются в очереди E–F.

## Исторический снимок 2026-09-09 (superseded текущей проверкой выше)

| Область | Состояние на 2026-09-09 |
|---|---|
| Public stand web/API | Disposable испытательный стенд: exact SHA `6892d6e`/version `1.10.1` одновременно подтверждены у Vercel web, Render API и proxy; seed-admin login прошёл в браузере |
| OPS-004 foundation | PR #4 и Neon-normalization PR #5 слиты; дальнейшая работа по D32 идёт прямыми commits/pushes в `main`; исходный dirty worktree и внешний recovery snapshot сохранены |
| Закреплённый stack | Repo target: Node **24.20.0**, pnpm **9.15.0**, PostgreSQL **16.15-alpine** по digest, Playwright **1.63.0**/Chromium **153.0.8010.12**; fresh frozen install и `doctor` прошли |
| Текущий full test | P0 release candidate `pnpm verify:all`: `862 passed, 0 failed, 0 skipped, 0 todo, 0 interrupted`; в aggregate входят quality 810, PostgreSQL 37, compiled browser 11 и cleanup 4 |
| Детерминизм | после изоляции RNG три последовательных full suite и последний Node 24 run зелёные; известный busy+bye дефект закреплён отдельным `BUG-015` characterization test |
| Local quality/build | Frozen install, doctor, docs/routes/secrets audits, lint, typecheck, builds и полный `verify:all` зелёные с `0 failed / 0 skipped / 0 todo`; disposable PostgreSQL cleanup подтверждён |
| Hosted CI | SHA `6892d6e`: GitHub run `34195797553` success; Quality/PGlite, PostgreSQL 16 и compiled browser lanes green |
| Web artifact fingerprint | local build HTML/JS/CSS hashes совпали с production capture; это не заменяет commit SHA/release metadata |
| Browser baseline | production login: 4 viewport; local synthetic data: 4 home viewport, key 360px screens и smoke 17 organizer routes + admin; это не полный PRD E2E/axe |
| PostgreSQL verification | Exact PostgreSQL 16.15: fresh/idempotent `0000→0001`, split-role policy, DATA-002/005/007 transaction/concurrency и immutable void audit прошли в полном барьере: 37/37 |
| Secret incident | Neon role credential ротирован; disposable stand по D32 сознательно использует `neondb_owner`, `SEED_ADMIN=1`; новый seed-admin создан, credentials хранятся только в Render и переданы пользователю через локальный clipboard |
| Security dependencies | Production graph: 0 high/critical и 3 documented moderate React Router advisories; Fastify 5.12.3 и Drizzle 0.45.2 проверены полным барьером |
| Route/OpenAPI inventory | current source/OpenAPI: 64 operations / 58 paths, 100% inventory coverage; live/public artifact remains tied to the last released SHA until Wave A release |
| Product decisions | D23: cancel только active admin/creator; D24: creator/admin soft void; D33: void турнирного матча компенсирует только его stats/ranking и сохраняет остальную сетку/downstream неизменными |
| Wave A integration | `BUG-004..016`, `GAP-001`, `OPS-005` — `in_progress`; frozen 2026-09-07 evidence историческое, текущий web gate: typecheck green, focused 59/59, full 125/125; API/PostgreSQL/CI/browser gates выполняются отдельно |
| Documentation | immutable baseline: 48 findings; live backlog: 49 после выделения DATA-007; links/anchors/IDs/status schema проверяются автоматически |
| Релизная синхронизация | D32: прямой verified push в `main` запускает Render/Vercel native Git deploy и параллельный CI; `pnpm smoke:public` read-only ждёт одинаковый SHA/version; public API временно использует `neondb_owner` |
| Public DB bootstrap | Пользователь разрешил одноразово пересоздать `public`/`drizzle` на точном Neon target и применить `0000` с нуля; последующие releases только apply-only |
| Recovery | Существующий manual snapshot/recovery copy сохранён как ручная страховка, но не является release barrier для disposable stand |

## Блокеры исторического снимка 2026-09-09

- Текущий P0 batch ещё должен пройти один direct-main push, hosted CI и exact-SHA
  read-only smoke у Render API, Vercel web и proxy.
- Public runtime временно использует owner-role, а production-grade
  backup/recovery и отдельный staging отложены до VPS-readiness scope.
- P1 gaps, включая полные browser journeys, profile/ranking/team/match slices и
  известный busy-player/bye BUG-015, не входят в этот выпуск.

Полный зафиксированный отчёт: [baseline audit](audits/2026-09-06-baseline.md).
Текущие приоритеты и критерии проверки: [BACKLOG.md](BACKLOG.md).

## Следующий этап

Следующий локальный шаг — завершить и проверить consent delta Wave E, затем
последовательно выполнить aggregate/browser acceptance E и отдельную Wave F.
Публикация требует отдельно одобренного изменения версии, hosted CI и exact-SHA
public smoke. До подтверждения root-версия остаётся 2.1.0; последнее публичное
evidence также относится к 2.1.0.
Одноразовый reset по D31 не повторяется: применяются только immutable forward
migrations.
Новые продуктовые решения принимаются только через
[OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) и [DECISIONS.md](DECISIONS.md).

## Визуальный статус

Current production — временный visual regression baseline до отдельно
согласованного redesign. Figma-работа 2026-07-25 сохранена как historical
reference и не является source of truth. Подтверждённые a11y/layout defects
production не нормализуются и остаются в `GAP-011` (ADR D22).
