# JUDGE — UX/UI-аудит для TECH-006

## Результат

`READY_FOR_REVIEW`. Замороженный набор исходников post-GAP-012 проверен побайтно, собран под Node 24 и пройден в одноразовом runtime с PostgreSQL. Ограниченный Chromium-прогон завершил 42 записанных состояния и 25 viewport-снимков в `1440×900`, `390×844`, `360×800` и landscape `844×390`.

Основной путь счёта в наблюдаемом прогоне корректен: два намеренных быстрых тапа дали две записи, Undo удалил ровно одно действующее очко, ручная коррекция сохранилась как технический baseline, handover зарезервировал названного получателя, прежней и второй сессии того же пользователя отказано, а pending → continue → pending → confirm завершился authoritative-состоянием `10:2` без активного судьи. Неявка и ручная остановка отдельно сохранились с `0:0` и ожидаемыми причинами. См. [authoritative-readbacks.json](evidence/authoritative-readbacks.json).

Синтез подтвердил одну новую находку JUDGE; вторая остаётся на review:

1. `F-JUDGE-001` (P1, высокая), подтверждена как `BUG-029`: потерянный response уже применён сервером и отражён в обновлённом счёте, но UI всё ещё называет очко неподтверждённым и предлагает повторить. Следование инструкции может добавить дубликат. Координатор независимо воспроизвёл полную цепочку `потеря ответа → подсказка повторить → новое очко` на отдельном disposable stand.
2. `F-JUDGE-002` (P2, высокая): keyboard focus падает в `BODY` при открытии и закрытии ручной коррекции, поэтому оператор теряет место в процессе счёта.

`F-JUDGE-003` — экспертная гипотеза, а не наблюдённый пользователем дефект: технические названия и равновесные действия затрудняют поиск следующего шага. Она расширяет принятое pilot evidence `F-PILOT-002/006`, не создавая новую корневую backlog-задачу.

Прогон также добавляет evidence потребителя JUDGE к подтверждённым координатором `BUG-024`, `BUG-025` и `BUG-026`; эти корневые причины намеренно не дублируются.

## База и метод

- Frozen export: `/private/tmp/tab10-ux-audit-dispatch-v1`; фактически вычисленный manifest SHA-256 `c39ed47d9aaaadfba7fac3790bde26acac772ae9946e2f1c99bcdb6a1d46b3a6`; до прогона проверено 310/310 source paths.
- База: `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221`; application fingerprint `8e8762575a07e71a17192da327cbe1b5906ca33c1c2ef762c0f9a37463b94cb3`.
- Runtime: production bundles; web `4917`, API `4918`, PostgreSQL 16.15 на host port `33019`, Compose project `tab10-ux-judge-4917`.
- Браузер: Playwright 1.63.0, Chromium 153.0.8010.12; mouse/keyboard и touch-sized viewports Chromium. Пять synthetic active ordinary users; реальных персональных данных и credential values в evidence нет.
- Уровень evidence: source review + детерминированный экспертный browser-проход + persisted API readback. Это не модерируемое usability-исследование; время человека, предпочтения и влияние на конверсию не заявляются.
- Переиспользованное evidence: принятый pilot run `P-MOBILE-01` указан только как прежнее свидетельство продолжения на том же телефоне и пути C→D; собственным прогоном пакета он не объявляется.

Драйвер намеренно инъецировал один directory `503`, один point-write `503`, один случай server-applied/lost-response, один version conflict, потерю сети offline, два ownership conflict и один release `503`. Все 12 console errors точно соответствуют этим контролируемым веткам `503/409/403/network`; page errors — `0`.

## Результаты сценариев

| Сценарий | Результат | Наблюдаемое свидетельство |
|---|---|---|
| `SC-J01` счёт, подача, Undo, коррекция | PASS с находкой | Rapid queue явно достигла 2; persisted score вырос дважды; Undo уменьшил один раз; коррекция сохранилась. Keyboard focus потерян при открытии/закрытии коррекции (`F-JUDGE-002`). |
| `SC-J02` захват, ownership, release, handover | PASS с evidence известного компонента | Reservation/acquire получателя успешны; прежний владелец и тот же аккаунт в другой auth session заблокированы; ошибка release завершилась навигацией с видимым TTL-warning. Directory pending/error относится к `BUG-025`. |
| `SC-J03` pending confirmation, continue, finish | PASS | Pending `9:2` показал confirm/continue; continue вернул счёт; второй finish подтвердил `10:2`; судья освобождён. |
| `SC-J04` известный отказ, неизвестный исход, conflict, offline | FAIL | Известный `503` ничего не записал; version conflict обновил authoritative state. Lost response и offline используют одну общую инструкцию повтора без явного recovery (`F-JUDGE-001`). Контраст dark error относится к `BUG-024`. |
| `SC-J05` неявка, stop, действия role/state | PASS с гипотезой об иерархии | Неявка и ручная остановка отдельно подтверждены и сохранены. Права ролей не изменились. MatchDetail показывает несколько равновесных или избыточных действий (`F-JUDGE-003`). |

Полные строки прогонов и ограничения находятся в [runs.csv](runs.csv). Связь с требованиями — в [requirement-coverage-delta.csv](requirement-coverage-delta.csv).

## Находки

### F-JUDGE-001 — неизвестный результат записи подталкивает к повторному начислению

- **Вид / приоритет / уверенность:** `runtime_defect`; **P1**, высокая. Один контролируемый lost-response и один offline; последствие напрямую следует из семантики записи очка.
- **Где:** `/matches/:id/judge`, активный судья, live scoring, desktop 1440 и mobile 390.
- **Фактически:** synthetic request дошёл до сервера и увеличил A с `3` до `4`, после чего browser response был оборван. JudgePage получил и показал authoritative `4:1`, но alert сообщил: «Очко не подтверждено… проверьте счёт и повторите». Драйвер захватил exact отправленный idempotency key и подтвердил его наличие в обновлённом match: применённость именно этого intent доказана, а не выведена из изменения score/version. Offline показывает ту же общую инструкцию без Refresh/Retry и с вновь доступными `+1` после остановки очереди.
- **Ожидание:** recovery различает `запись подтверждена`, `отказ подтверждён` и `результат неизвестен`; при неизвестном исходе нельзя предлагать повтор. Автоматический score retry не добавляется.
- **Воспроизведение:** активный судья при стабильном счёте → пропустить points request до обработки сервером → оборвать response → увидеть score и alert. Offline: загрузить стабильное authoritative state → отключить сеть → нажать `+1` → увидеть сохранённый score, общий alert и ноль recovery-кнопок.
- **Evidence:** run `J-RUN-UNKNOWN-OUTCOME`, [неизвестный исход](evidence/screenshots/j11-unknown-outcome-authoritative-score-1440.png), [offline](evidence/screenshots/j13-offline-no-recovery-action-390.png), записи `j11/j13` и authoritative readback.
- **Последствие:** судья, следуя явной инструкции «повторите», может начислить одно реальное очко дважды; около финиша это способно создать или подтвердить неверного победителя.
- **Частота:** `1/1` контролируемый response-loss и `1/1` offline; естественная частота неизвестна.
- **Пересечение:** подтверждено как `BUG-029`; связано с `JUDGE-009`, `AT-JUDGE-007`, UX flow §7 network recovery и D27. С `BUG-024/025/026` не пересекается.
- **Минимальное исправление:** state machine по exact отправленному idempotency key. Наличие ключа в authoritative `idempotencyKeys`/event log доказывает запись; раннее отсутствие не доказывает no-write, пока POST ещё может завершиться. Подтверждённый отказ может предложить явное «Начислить ещё раз» с новым intent/key. Иначе счёт приостанавливается, доступен read-only refresh и конечный ручной выбор после сверки; нельзя делать вывод только из aggregate score/version или auto-retry.
- **Сохранить:** уникальный idempotency key на каждый намеренный tap, один in-flight request, упорядоченную очередь, быстрые тапы, expected-version conflict и серверный источник истины.
- **Зависимости / проверка:** JUDGE UI и текущий match API. Проверить known `503`, response loss до/после commit, offline/reconnect, concurrent point, pending boundary и screen-reader announcement.
- **Цель:** `T-JUDGE-ERR-001` в [target-spec.md](target-spec.md). Дефект подтверждён как `BUG-029`; принятие всего research package остаётся отдельным reviewer-шагом.

### F-JUDGE-002 — ручная коррекция теряет клавиатурный фокус при входе и возврате

- **Вид / приоритет / уверенность:** `runtime_defect`; **P2**, высокая; `1/1` открытие и `1/1` закрытие в Chromium keyboard flow.
- **Где:** `/matches/:id/judge`, активный судья, manual correction, desktop 1440.
- **Фактически:** Enter на «Исправить счёт и подачу» открывает регион при `document.activeElement === BODY`. Enter на «Отмена» закрывает его и снова оставляет focus на `BODY`.
- **Ожидание:** открытие переводит focus на heading коррекции или первое поле; cancel/success возвращает focus к вызвавшему действию. Score board остаётся видимым, а редактирование очков выключено.
- **Воспроизведение:** focus «Ещё» → Enter → focus действия коррекции → Enter → проверить active element; focus «Отмена» → Enter → проверить active element.
- **Evidence:** run `J-RUN-CORRECTION`, [открытая коррекция](evidence/screenshots/j07-correction-open-focus-1440.png), записи `j07` и `j07b`.
- **Последствие:** keyboard- и screen-reader-операторы теряют точку взаимодействия и вынуждены снова проходить страницу в чувствительном ко времени процессе.
- **Частота:** наблюдается в тестовом браузере; cross-browser/spoken-AT частота неизвестна.
- **Пересечение требований:** `JUDGE-011`, `AT-JUDGE-010`; смежно с focus rules `BUG-018`, но причина иная: Autocomplete popup/IDREF здесь не участвуют.
- **Минимальное исправление:** сохранить ref вызвавшего действия; при открытии сфокусировать heading (`tabIndex=-1`) или первое поле; при cancel/save вернуть focus к invoker, если он смонтирован. Авторизацию и audit-семантику коррекции не менять.
- **Затронуто / зависимости:** только JudgePage; переиспользовать component-контракт focus entry/return.
- **Цель:** `T-JUDGE-FOCUS-001`. Проверить keyboard open/cancel/save, validation error, mutation error, mobile touch regression и spoken-AT spot-check. Вердикт reviewer ожидается.

### F-JUDGE-003 — технические термины и равновесные действия MatchDetail скрывают следующий шаг

- **Вид / приоритет / уверенность:** `expert_hypothesis`; **P2**, средняя. Runtime-геометрия и action inventory фактичны; влияние на понимание требует user validation.
- **Где:** JudgePage и MatchDetail, waiting/in-progress/pending/finished, creator/participant/current judge/other active user, 390 и 1440.
- **Фактически:** JudgePage использует «Undo», «слот судьи», «Передать слот»; creator в waiting видит `Старт`, `Судить` и `Открыть счёт` с двумя одинаково залитыми кнопками; current judge в progress видит одновременно `Судить` и `Открыть счёт`; destructive/exception actions находятся в одном линейном стеке.
- **Ожидание:** одно основное действие по role/state с понятной операционной формулировкой; тот же телефон не требует идентификации, а другое устройство использует handover. Исключения и destructive actions остаются доступными по текущим permission/confirmation, но визуально вторичны.
- **Воспроизведение:** проверить action matrix четырёх ролей в waiting/in-progress/pending/finished; посмотреть handover `j14` и MatchDetail `j21/j23`.
- **Evidence:** run `J-RUN-ACTOR-MATRIX`, [creator в ожидании](evidence/screenshots/j21-waiting-creator-detail-1440.png), [текущий судья](evidence/screenshots/j23-in-progress-judge-detail-1440.png), [handover](evidence/screenshots/j14-handover-ready-390.png).
- **Последствие:** вероятны задержка или неверный первый выбор у стола; человеческая ошибка не наблюдалась, поэтому runtime defect не заявляется.
- **Частота:** layout наблюдается во всех проверенных релевантных actor/state; частота непонимания неизвестна.
- **Пересечение:** расширяет принятые pilot `F-PILOT-002` и `F-PILOT-006`; синтез сохраняет одну задачу TECH-006 без дубликатов. Авторизация ролей остаётся D7/D18/D23/D24.
- **Минимальное исправление:** resolver действий role/state и copy-only названия из `T-JUDGE-ACTION-001`/`T-JUDGE-COPY-001`; сохранить все routes и mutation permissions.
- **Нужная проверка:** нейтральное модерируемое задание на текущем UI, затем проверка понимания target; browser matrix 390/1440; согласование с MATCH до реализации.

## Дополнительные свидетельства к находкам координатора

| Дополнение evidence | Каноническая причина | Наблюдение JUDGE | Решение |
|---|---|---|---|
| `F-JUDGE-D024` | `BUG-024` | Реальный контролируемый point `503` показывает красный текст обычного размера на immersive dark shell; принятое component evidence измерило `2.58:1`. | Добавить `j10` как consumer evidence; новую находку не создавать. |
| `F-JUDGE-D025` | `BUG-025` | Удержанный handover directory оставляет enabled select только с placeholder, без busy/status; после `503` select всё ещё enabled, retry отсутствует. | Расширить общий async-directory acceptance на этот native-select consumer либо явно разделить при синтезе; новой причины здесь нет. |
| `F-JUDGE-D026` | `BUG-026` | Пока составная операция start/setup удержана на `/start`, first-server radio и визуальный side swap остаются enabled. First server уже передан в `/start`; захваченные first server и `swapSides` затем задают `/judge/setup`, поэтому визуальные изменения после клика не меняют захваченную операцию. | Добавить `j02` как JUDGE consumer evidence; новую находку не создавать. |

## Поведение, которое нужно сохранить

- Очередь score intent: одна in-flight запись, видимый счётчик, две уникальные намеренные записи, без auto retry.
- `+1`: 48 px в проверенном landscape и 56 px в 360/390/1440; horizontal overflow отсутствует.
- Индикация подачи остаётся видимой и следует за Undo/коррекцией.
- Коррекция сохраняет authoritative score/server и остаётся техническим baseline, а не фиктивным очком.
- Handover атомарно резервирует названного active user; прежний судья и тот же пользователь из другой auth session не могут мутировать.
- Тот же телефон остаётся тем же signed-in account: запрос идентификации человека не добавляется.
- Pending result предлагает Continue и Confirm; finished result read-only и освобождает ownership судьи.
- Ошибка Release видима после навигации и честно объясняет TTL fallback.
- Неявка и early stop сохраняют разные confirmation, actor, result и audit semantics.

## Ограничения

- Не проверялись physical iOS/Android handoff, системная virtual keyboard, WebKit/Safari, browser UI zoom 200%, VoiceOver/TalkBack и spoken-AT session.
- Touch-sized viewport Chromium не считается проверкой физического устройства. Landscape — `844×390`, narrow — `360×800`.
- TTL expiry и 30-секундный hidden/visible heartbeat cadence не ожидались в реальном времени; source/acceptance просмотрены, а lost-lock ownership проверен через conflict states.
- Захват blocked user не повторялся: использованы active ordinary users, фокус — ownership device/session.
- Вывод о контрасте BUG-024 переиспользует принятое точное измерение component-пакета и добавляет JUDGE screenshot; каждый immersive background отдельно не pixel-sample-ился.
- Иерархия actor/action — экспертная гипотеза до user research. Улучшение completion rate от меньшего числа действий не заявляется.
- Production/public stand не затронут. Полный `pnpm run verify:all` был вне scope; production build и disposable migration/runtime checks выполнены.

## Предлагаемое целевое состояние

Полная матрица role/state, recovery-контракт, поведение focus, точные названия и аннотированные схемы до/после находятся в [target-spec.md](target-spec.md) и [target-wireframes.html](evidence/target-wireframes.html). [flow-report.html](flow-report.html) — автономный реестр текущего и предлагаемого flow.
