# Целевая спецификация JUDGE

Это исследовательская цель для TECH-006, а не реализованный redesign. Она сохраняет текущий production visual language, API contracts, правила idempotency/version и авторизацию D7/D18/D23/D24. Структурное предложение для mobile, desktop и landscape показано в [target-wireframes.html](evidence/target-wireframes.html); rendered captures находятся в `evidence/wireframes/`.

## Поддерживаемые задачи

- `SC-J01`: захватить судейство, выбрать подачу/стороны, быстро вести счёт, выполнить Undo, найти и завершить коррекцию.
- `SC-J02`: продолжить на том же телефоне без повторной идентификации; передать названному человеку на другом устройстве; выполнить release и восстановиться после ownership conflict.
- `SC-J03`: проверить pending result, продолжить игру, завершить и прочитать финальный результат.
- `SC-J04`: сохранить контекст и безопасно восстановиться после известного отказа, неизвестного исхода, offline, version conflict и lost lock.
- `SC-J05`: различить обычный finish, early stop, неявку, cancel, release и void завершённого результата по actor/state.

## T-JUDGE-ACTION-001 — иерархия действий по роли и состоянию

Цель меняет иерархию и названия, а не права. Границей остаётся server authorization.

| Состояние матча | Роль | Основное действие | Вторичные действия | Исключения и опасные действия |
|---|---|---|---|---|
| waiting, slot free | creator | `Начать и вести счёт` | `Начать без ведения счёта`; `Изменить матч`; `Открыть счёт` | `Зафиксировать неявку`; `Отменить матч` |
| waiting, slot free | participant либо иной active user с доступной карточкой | `Стать судьёй` | `Открыть счёт` | нет |
| waiting, slot occupied by actor | current judge | `Продолжить ведение счёта` | `Открыть счёт` | `Завершить ведение` внутри judge UI |
| waiting, slot occupied by other | creator/participant | `Открыть счёт` | status `Судит: {name}` | creator сохраняет start/edit/cancel/no-show, только когда они допустимы; acquire выключен |
| in_progress | current judge | `Продолжить ведение счёта` | `Открыть счёт` | `Остановить матч`; `Зафиксировать неявку`; release/handover внутри judge UI |
| in_progress | creator, not judge | `Открыть счёт` | disabled status `Судит: {name}` | `Остановить матч`; `Зафиксировать неявку`; `Отменить матч` |
| in_progress | participant, не judge | `Открыть счёт` | disabled status `Судит: {name}` | нет |
| pending_confirmation | current judge | `Проверить результат` | `Открыть счёт` | Confirm/Continue только внутри judge UI; stop/no-show остаются разрешёнными исключениями |
| pending_confirmation | creator/participant | `Открыть предварительный результат` | status `Ожидает подтверждения судьи` | creator сохраняет действия D18/D23 только пока их разрешает домен |
| finished/stopped | participant | `Создать реванш` | `Назад` | нет |
| finished/stopped | creator, не participant | `Новая игра` | `Назад` | `Аннулировать результат` в отдельной danger-секции с текущим подтверждением D24 |
| finished/stopped | former judge либо иной active viewer | `Новая игра`, только если это принято общей навигацией; иначе `Назад` | read-only result | mutation результата отсутствует |

Примечания:

- «Иной active user» не получает видимость live MatchDetail. Direct acquire по D7 остаётся возможным только через уже допустимый entry/deep link; матрица не расширяет видимость D17.
- Если продукт сохраняет отдельные вызовы `Старт` и `Судить`, `Начать и вести счёт` становится оркестрированным UI-путём на текущих разрешённых вызовах; обработка ошибки не должна оставлять скрытый занятый slot. Если синтез MATCH отклонит оркестрацию, допустима более простая цель только по hierarchy/copy.
- На actor/state показывается только одно filled primary action. Вторичные действия используют текущие outline/text variants. Danger actions отделены расстоянием, заголовком `Если матч нельзя продолжить` и существующими явными подтверждениями.
- Пустой point log идёт после следующего основного действия на waiting; когда события есть, журнал остаётся до управления историей/результатом.

### Порядок блоков MatchDetail

1. Title, status, score, participants, сводка правил, current judge/reservation.
2. Одно основное следующее действие и не более двух ближайших вторичных.
3. Контекстное объяснение occupied/reserved/lost ownership.
4. Point log при наличии; иначе краткое empty-сообщение.
5. Exception/destructive actions, визуально отделённые и не повышаемые из-за отсутствия primary action.
6. Навигация назад.

На 390 px primary action видимо и не перекрыто BottomNav. На desktop контент сохраняет текущую читаемую колонку; card счёта/деталей не растягивается на все 1440 px.

## T-JUDGE-COPY-001 — понятные операционные названия

| Сейчас | Цель | Доступное имя / пояснение |
|---|---|---|
| `Undo` | `Отменить очко` | `Отменить последнее засчитанное очко` |
| `Ещё` | `Действия` | `Дополнительные действия судьи` |
| `Передать слот` | `Передать на другое устройство` | Называет выбранного получателя и сообщает, что текущее устройство потеряет права редактирования |
| `Освободить слот и выйти` | `Завершить ведение и выйти` | Пояснение: матч продолжается; судьёй может стать другой active user |
| `Судить`, когда actor уже владеет session | `Продолжить ведение счёта` | Без избыточного acquire-языка |
| `Слот занят` / технический язык session | `Судейство уже открыто на другом устройстве` | Recovery: `Смотреть счёт`, `Повторить проверку`, `Назад к матчу` |

Постоянная подсказка рядом с judge toolbar:

> Передаёте телефон рядом стоящему человеку? Ничего менять не нужно — счёт продолжает вести текущий аккаунт. Чтобы другой человек продолжил на своём устройстве, выберите «Передать на другое устройство».

Сначала показывается одна краткая строка с `Подробнее`; полный текст раскрывается в additional-actions panel. Подсказка не спрашивает, кто физически держит тот же телефон, и не подразумевает новых прав.

## T-JUDGE-ERR-001 — восстановление с тремя исходами записи

У каждого score intent один видимый lifecycle: `queued → sending → reconciled`. Счёт определяет только сервер.

| Исход сверки | Видимое сообщение | Действия | Правило повтора |
|---|---|---|---|
| запись подтверждена | `Очко сохранено. Счёт обновлён: {A}:{B}.` только после ранее показанной неопределённости | Возобновить счёт после authoritative render | Повтор не нужен; подтверждение — наличие exact отправленного idempotency key в authoritative `match.idempotencyKeys`/event log |
| отказ подтверждён | `Очко не было сохранено.` | Основное `Начислить очко ещё раз`; вторичное `Обновить счёт` | Только новое явное намерение пользователя и новый idempotency key; допустимо лишь после определённого server rejection/no-write |
| результат неизвестен | `Не удалось проверить, сохранилось ли очко. Счёт на сервере нужно сверить.` | Отключить score/Undo/confirm; основное `Обновить счёт`; вторичное `Я проверил результат` | Никогда не повторять автоматически и не писать «повторите» |
| version conflict | `Счёт уже изменился на другом устройстве: {A}:{B}. Проверьте последнее очко.` | Остановить очередь; показать authoritative score; явно возобновить после подтверждения | Не воспроизводить stale queued intents |
| lost judge lock | `Ведение продолжено на другом устройстве.` | Read-only score; `Смотреть счёт`, `Повторить проверку`, `Назад к матчу` | Не выполнять reacquire скрыто |

Текущий GET матча возвращает `idempotencyKeys` и `eventLog`: наличие exact отправленного ключа доказывает, что конкретное намерение применено. Изменение только общего score/version этого не доказывает из-за конкурирующих событий. Отсутствие ключа в раннем GET также не доказывает отказ, пока исходный POST ещё может завершиться; до определённого server rejection/no-write UI использует `результат неизвестен`.

Чтобы неопределённость не блокировала игру навсегда, `Я проверил результат` открывает два явных выбора: `Очко уже учтено — продолжить` (без mutation) и `Очко не учтено — начислить` (одно новое намерение с новым ключом). Оба варианта сначала показывают последний authoritative score и требуют отдельного подтверждения; UI не делает вывод из одного изменения score/version.

Поведение network/offline:

- Сохранять видимыми последний authoritative score, подачу, таймер и actor labels.
- Показывать компактный постоянный status `Нет связи — счёт не отправляется`, как только browser offline или request завершился ошибкой.
- Отключить score mutations при неизвестном исходе; не накапливать невидимую offline queue.
- `Обновить счёт` выполняет только GET. Кнопка меняется на `Проверяем…`, не дублируется 30-секундным циклом и при ошибке сохраняет последнее состояние.
- При возврате online выполнить один authoritative sync D27/JUDGE-008 и объявить результат через polite live region.

## T-JUDGE-FOCUS-001 — вход и возврат фокуса в коррекции

- `Действия` открывает disclosure panel и отражает раскрытие в `aria-expanded`.
- Активация `Исправить счёт и подачу` переводит focus на heading `Ручная коррекция` (`tabIndex=-1`) либо, если сразу нужна validation guidance, на `Счёт стороны A`.
- Tab order внутри correction: score A → score B → current server → Save → Cancel. Score `+1`, Undo, Confirm и stop actions остаются disabled, пока correction открыта.
- Validation error переводит focus к первому invalid field и связывает сообщение через `aria-describedby`.
- Request error сохраняет correction открытой и все введённые значения, фокусирует error summary и показывает `Повторить сохранение` только как явное действие.
- Cancel возвращает focus к `Исправить счёт и подачу`; успешный save — к `Действия` с объявлением authoritative score/server.
- Escape закрывает только без in-flight mutation; при pending все payload-defining fields и exit actions честно disabled.

## T-JUDGE-STATE-001 — честные pending-состояния и состояния каталога

### Ожидание start/setup

- После запуска составной операции start/setup first-server radios, визуальная перестановка сторон, Start и Cancel отключаются вместе. First server входит в `/start`; зафиксированные first server и `swapSides` затем входят в `/judge/setup`. Изменение UI после клика не меняет уже захваченное React-замыканием намерение.
- Видимая immutable summary показывает отправленные стороны и first server. Success открывает score mode по authoritative response; failure восстанавливает те же editable values и фокусирует error summary.
- Это consumer acceptance JUDGE для подтверждённого координатором `BUG-026`.

### Каталог для передачи

- `loading`: label `Загружаем людей…`, `aria-busy=true`, select disabled.
- `ready empty`: label `Некому передать`; пояснение, что видны только допустимые active users; select disabled.
- `ready`: select enabled без заранее выбранного получателя; transfer button disabled до выбора.
- `error`: контекстный alert `Не удалось загрузить людей`; select disabled; действие `Повторить` повторяет только directory GET.
- Mutation pending: выбранный человек становится immutable summary; все handover inputs disabled. Error восстанавливает выбор.
- Так acceptance `BUG-025` распространяется на native handover select JUDGE без изменения D7 eligibility.

## T-JUDGE-VISUAL-001 — читаемость immersive-экрана и touch

- Сохранить текущие dark immersive score board и цвета сторон; это не visual rebrand.
- Обе зоны `+1` остаются не меньше `44×44` CSS px; target сохраняет текущие 56 px в portrait/desktop и 48 px по высоте в landscape.
- Подача обозначается icon + text + surface выбранной стороны, не одним цветом. Accessible name: `Подаёт: {name}`.
- Pending-confirmation actions доступны на 390 px выше safe-area/BottomNav; `Подтвердить результат` — primary, `Продолжить игру` — secondary.
- Текст `.judge-error` обычного размера имеет не менее `4.5:1` на фактически скомпонованном dark background. Повторно проверить runtime `503`, offline, version conflict и lost-lock alert; это `BUG-024`, не новая color system.
- На 360 px нет horizontal overflow; длинные имена переносятся внутри side cards, не выталкивая score или +1.
- Landscape отдаёт приоритет score и +1. Additional actions открываются компактным overlay/sheet, который не уменьшает score targets ниже 44 px.

## Аннотированные схемы до/после

| Поверхность | Evidence «до» | Схема «после» | Основное изменение |
|---|---|---|---|
| Live score landscape | [rapid queue](evidence/screenshots/j05-rapid-queue-landscape.png) | [landscape target](evidence/wireframes/judge-landscape-target.png) | Русские названия действий, явная полоса queue/recovery, score остаётся главным |
| MatchDetail desktop | [waiting creator](evidence/screenshots/j21-waiting-creator-detail-1440.png) | [desktop target](evidence/wireframes/match-detail-desktop-target.png) | Одно primary action, исключения отделены, empty log понижен |
| Recovery mobile | [release warning](evidence/screenshots/j25-release-failure-destination-warning-390.png) и [offline](evidence/screenshots/j13-offline-no-recovery-action-390.png) | [mobile recovery target](evidence/wireframes/judge-mobile-recovery-target.png) | Последний score сохранён, copy зависит от исхода, явный read-only refresh |

## Матрица проверки

- Viewports: `1440×900`, `390×844`, `360×800`, landscape `844×390`, plus real browser UI zoom 200%.
- Input: touch, mouse, keyboard-only; VoiceOver/TalkBack or equivalent spoken-AT spot-check.
- Actor/state: creator, participant, current judge, eligible active nonparticipant, same user other auth session, former judge; waiting/in-progress/pending/finished/stopped.
- Score: two and three rapid taps, Undo before/after drain, correction success/validation/error, winning point, Continue, Confirm.
- Failure: known no-write, commit/lost-response, loss-before-commit, offline/reconnect, version conflict, lost lock, terminal external finish, directory loading/empty/error/retry, release success/failure.
- Persisted assertions: score/version/server, effective point log, correction audit baseline, active judge/reservation, final result, no-show/stop reason.

## Given/When/Then-приёмка цели

1. **Применённая запись с потерянным ответом.** Given судья отправил одно очко с известным idempotency key, When ответ потерян, а authoritative GET содержит exact key, Then UI показывает серверный счёт и состояние `Очко сохранено`, не предлагает повтор и не отправляет новый POST.
2. **Неизвестный исход.** Given ответ потерян и authoritative GET пока не содержит exact key, но исходный POST ещё может завершиться, When судья обновляет счёт, Then score/Undo/confirm остаются приостановлены, выполняются только read-only GET, автоматического или предложенного повтора нет, а ручная сверка ведёт к двум явным вариантам.
3. **Подтверждённый отказ без записи.** Given сервер определённо отклонил intent и подтвердил no-write, When UI показывает ошибку, Then только явное `Начислить очко ещё раз` создаёт одно новое намерение с новым idempotency key.
4. **Быстрые намеренные тапы.** Given судья дважды нажал `+1` до ответа на первый запрос, When очередь дренируется, Then сохраняются два разных ключа в исходном порядке, одновременно отправляется не более одного запроса и authoritative счёт увеличивается на два.
5. **Фокус коррекции.** Given keyboard focus находится на `Исправить счёт и подачу`, When коррекция открыта или закрыта через Cancel/Save, Then focus предсказуемо переходит в heading/первое поле и возвращается к вызывающему элементу; при validation/request error введённые значения и понятная точка focus сохраняются.
6. **Ожидание start/setup.** Given пользователь запустил составную операцию, When `/start` или последующий `/judge/setup` pending, Then first-server, side swap и exit controls выключены, immutable summary отражает захваченные значения, а failure возвращает те же editable values без скрытой смены намерения.
7. **Передача судейства.** Given каталог получателей loading, empty, error или ready, When пользователь открывает handover, Then select и retry точно отражают состояние; mutation доступна только после явного выбора, а pending фиксирует выбранного человека и выключает все определяющие payload поля.
8. **Права и иерархия.** Given любая строка actor/state matrix, When MatchDetail отрисован, Then видимо ровно одно основное следующее действие, исключения отделены, а набор разрешённых server mutations полностью совпадает с D7/D18/D23/D24 и не расширяет live visibility.

## Сохраняемые возможности и не-цели

- Права не расширяются; automatic score retry и optimistic score вместо server state не добавляются.
- Намеренные быстрые тапы остаются отдельными и упорядоченными.
- Тот же телефон сохраняет тот же account без идентификации; другое устройство использует явный handover.
- Release, handover, stop, no-show, cancel и void сохраняют текущие server-side actors, versions, idempotency, audit и confirmations.
- Спецификация не принимает API/schema-решение. Новый компонент не нужен там, где настраиваются текущие Button, Alert, Select, disclosure и focus patterns.
- Аудит не менял production UI, canonical backlog или application source.

## Открытые решения

Для review исследовательского пакета открытых решений нет. До реализации владельцы MATCH и JUDGE должны выбрать: `Начать и вести счёт` — составной UI-путь из двух вызовов или только изменение hierarchy/copy. Любой вариант сохраняет atomic ownership и явно восстанавливает частично захваченный slot.
