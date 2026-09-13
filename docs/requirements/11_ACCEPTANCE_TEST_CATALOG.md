# Acceptance Test Catalog — Tab-10 MVP

Формат: сценарии верхнего уровня. Они должны быть декомпозированы в unit/integration/API/E2E тесты.

## AUTH

### AT-AUTH-001 Первый вход
**Given** администратор создал активного пользователя с временным паролем  
**When** пользователь входит  
**Then** до установки нового валидного пароля он не может читать или изменять
продуктовые данные. Ограниченная сессия допускает только точные
`GET /api/v1/auth/me`, `POST /api/v1/auth/logout` и
`POST /api/v1/auth/password/first-change`; другой method, path, query substring
или encoding не расширяет этот allowlist.

### AT-AUTH-002 Временный пароль одноразовый
После успешной смены временный пароль больше не позволяет войти.

### AT-AUTH-003 Политика пароля
Каждое отсутствующее требование вызывает конкретную validation error; валидный пароль принимается.

### AT-AUTH-004 Блокировка
Blocked user не входит, а его активные сессии перестают работать.

### AT-AUTH-005 Sliding session
Активность продлевает сессию не далее чем на 7 дней от последней активности; истёкшая сессия отклоняется.

### AT-AUTH-006 Смена пароля
Текущая сессия сохраняется после ротации, все остальные отзываются.

### AT-AUTH-007 Сброс администратором
Старый пароль и все сессии становятся недействительными, новый временный пароль требует смены.

### AT-AUTH-008 Последний admin
Нельзя заблокировать или понизить последнего активного администратора.

### AT-AUTH-009 Runtime отзыв/истечение сессии
**Given** активный пользователь находится на защищённом route и заполнил форму без
отправки

**When** защищённый API отвечает `401` из-за истёкшей или отозванной сессии

**Then** общий клиент ровно один раз инвалидирует локальный auth state, не создаёт
request/reload loop, показывает сфокусированный экран входа на том же безопасном
внутреннем return path и не повторяет автоматически отклонённую мутацию. После
успешного входа тем же пользователем исходный route и безопасный черновик восстановлены.
При входе другим пользователем защищённые страницы создаются заново: старые
черновики, выбранные команды и данные первого аккаунта не показываются и не отправляются;
внешний или protocol-relative return target заменяется на `/`.

### AT-AUTH-010 Ограничение неуспешных входов
**Given** один process-local limiter и управляемые часы

**When** один ключ `нормализованный email + IP` выполняет входы

**Then** успешные входы не расходуют failure budget; первые 10 неуспешных
попыток в фиксированном 15-минутном окне проверяются и возвращают обычную auth
ошибку, следующая получает HTTP 429 `RATE_LIMITED`, а ровно на границе expiry
новое окно допускает проверку. Истёкшие ключи удаляются при следующей попытке,
live map не превышает 10 000 fixed-size fingerprint keys.

## ADMIN

### AT-ADM-001 Создание
Admin создаёт пользователя и получает временный пароль один раз.

### AT-ADM-002 Уникальный email
`User@x.test` и `user@x.test` конфликтуют.

### AT-ADM-003 Права
User получает 403 на все admin endpoints.

### AT-ADM-004 Блокировка капитана
При блокировке капитана команда получает самого раннего активного участника как нового капитана.

### AT-ADM-005 Историческая сохранность
Blocked user остаётся в завершённых матчах, но не появляется в новом participant picker.

### AT-ADM-006 Безопасная блокировка и разблокировка
**Given** active admin видит active и blocked пользователей.

**When** он блокирует другого active пользователя или разблокирует blocked
пользователя после явного подтверждения.

**Then** UI показывает только допустимое для текущего статуса действие; block
отзывает все сессии target, unblock возвращает возможность нового входа, но не
восстанавливает ранее отозванные сессии; оба перехода фиксируются в audit.
Self-block скрыт и прямой запрос получает `403 SELF_BLOCK_FORBIDDEN`; попытка
заблокировать последнего active admin получает `409 LAST_ADMIN`; active non-admin
получает `403` на block и unblock.

### AT-ADM-MATCH-001 Non-admin
Non-admin получает 403 на admin force-close/purge endpoint. Creator с ролью
`user` использует общий cancel/void endpoint; его право выводится из ownership,
а не из доступа к `/admin/*`.

### AT-ADM-MATCH-002 Force-close clears PLAYER_BUSY
Stuck `in_progress` standalone → admin force-close → `cancelled` → тот же игрок может стартовать другой матч.

### AT-ADM-MATCH-003 Waiting unblocks tournament
`waiting` standalone блокирует старт турнира → force-close → турнир стартует.

### AT-ADM-MATCH-004 Tournament forbidden
Tournament match → force-close → `TOURNAMENT_MATCH_FORBIDDEN`. Void проверяется
отдельно; downstream outcome заблокирован DATA-007/Q-MATCH-003.

### AT-ADM-MATCH-005 Void compensates rankings
**Given:** finished standalone учтён в rankings.
**When:** active admin или creator выполняет void с причиной либо без неё после
явного UI confirmation.
**Then** исходный match остаётся доступен как voided, wins/losses компенсируются,
а immutable audit содержит actor/timestamp/prior result/version и опциональную
reason. Второго approval нет, hard delete не вызывается.

### AT-ADM-MATCH-006 Force-close finished
Force-close на `finished` → `MATCH_NOT_ACTIVE`.

### AT-ADM-MATCH-007 Purge safeguard and scope
Admin может hard-purge только допустимую non-finished standalone запись и только
после отдельного UI confirmation. Попытка purge finished/stopped/voided,
tournament или tutorial отклоняется без изменения match, audit или stats.

## PROFILE

### AT-PROFILE-001 Безопасный ответ редактирования
**Given** активный пользователь меняет разрешённые поля собственного профиля.
**When** `PATCH /profile/me` завершается успешно.
**Then** `user` содержит только явно разрешённые поля собственного профиля и не
содержит password/session hashes, timestamps блокировки/входа, storage paths или
другие внутренние auth persistence-поля.

### AT-PROFILE-002 Полный собственный профиль
Собственный профиль содержит поля PROFILE-001, статистику и факты PROFILE-002;
учебные и аннулированные результаты не увеличивают статистику. Исторические
карточки используют актуальные имена, пресеты и зарегистрированных соперников.

### AT-PROFILE-003 Публичность и вызов
Публичная карточка доступна активному пользователю, не содержит email/даты рождения
чужого пользователя и внутренних auth полей. Заблокированная историческая цель
остаётся читаемой, но не допускает вызов; самому себе вызов также не предлагается.
Некорректный UUID возвращает 400, отсутствующая цель — 404.

### AT-PROFILE-004 Редактирование и D10
Имя/фамилия, организация, должность и дата рождения сохраняются через строгий
канонический PATCH. Email/avatar и неизвестные поля отклоняются без изменения
данных; невозможная календарная дата также отклоняется. Ошибка сохраняет черновик.
По D10 аватар отображается без upload/regenerate/edit.

### AT-PROFILE-005 Активные сессии
Список показывает текущую и другие активные сессии с датами. После подтверждения
можно отозвать другую собственную сессию; текущую завершают через logout.
Отзыв текущей даёт 409 без mutation, чужой — 404; повторное нажатие не создаёт
второго запроса. После reauth черновик сохраняется без автоматического повтора mutation.

## MATCH RULES

### AT-MATCH-CANCEL-001 Creator cancels active standalone
Creator отменяет `waiting`, `in_progress` или `pending_confirmation` standalone с
опциональной причиной → `cancelled` без winner/stats; judge session закрыта, тот
же игрок может стартовать другой event без `PLAYER_ALREADY_IN_ACTIVE_MATCH`.

### AT-MATCH-CANCEL-002 Actor matrix
Active admin может cancel чужой active standalone. Participant, current active
judge и outsider, которые не являются creator/admin, получают 403; status,
version, judge session, stats и audit не меняются.

### AT-MATCH-CANCEL-003 Tournament forbidden
Tournament match → cancel → `TOURNAMENT_MATCH_FORBIDDEN`.

### AT-MATCH-CANCEL-004 Explicit confirmation and stale request
Первое нажатие Cancel только открывает confirmation с match name и последствиями;
request отправляется отдельным подтверждающим действием. Отмена dialog не создаёт
request. Missing/invalid `Idempotency-Key` и stale `expectedVersion` не отменяют
матч и предлагают исправить/обновить state. Повтор actor + match + key возвращает
тот же outcome без второй смены version; два разных key с одной expectedVersion
дают ровно один success и один conflict, а judge release входит в тот же atomic
transition.

### AT-MATCH-001 Обычная победа
При лимите 11 счёт 11:9 предлагает завершение; 11:10 не завершает.

### AT-MATCH-002 Deuce
После достижения порога при разнице менее 2 матч продолжается до отрыва 2.

### AT-MATCH-003 Подача
До deuce сервер меняется после двух очков, после deuce — после каждого.

### AT-MATCH-004 Сухая победа
При включённом пороге N сухая победа, когда у лидера ≥ N и у соперника 0 (текущий счёт; Undo случайного очка не блокирует). При ненулевом счёте соперника (5:1) — нет. При выключенном mercy — нет.

### AT-MATCH-005 Undo
Undo последнего очка восстанавливает точный предыдущий счёт, подачу и deuce state.

### AT-MATCH-006 Idempotency
Повтор запроса с тем же ключом не начисляет второе очко.

### AT-MATCH-007 Version conflict
Запрос со старой версией не меняет счёт и возвращает конфликт с актуальным state.

### AT-MATCH-008 Confirmation
До подтверждения можно отменить finish proposal; после подтверждения любые мутации отклоняются.

### AT-MATCH-009 Manual stop
Остановка требует победителя и причины и учитывается в рейтинге.

### AT-MATCH-START-001 Start authorization
Только creator/organizer запускает валидный матч. Participant, active judge и
outsider без роли organizer получают 403, состояние матча не меняется.

### AT-MATCH-STOP-001 Stop authorization
Creator/organizer и текущий active judge могут досрочно остановить матч.

### AT-MATCH-STOP-002 Participant is insufficient
Participant, который не creator/organizer и не current active judge, получает 403
на stop; winner, score, status, version и event log не меняются.

### AT-MATCH-010 No-show
Ручная неявка создаёт победу с причиной, без выдуманного игрового счёта.

### AT-MATCH-011 Concurrency
Игрок с активным матчем не может стартовать второй активный матч.

### AT-MATCH-012 Tutorial isolation
Матч с Призрачным Олегом не меняет статистику, рейтинг, историю и rival calculations.

### AT-MATCH-013 Validation, roster invariants and atomic create
Malformed/non-object payload, неизвестные поля, неверные side/winner/version/rules,
пустой или не соответствующий формату roster, duplicate/self user и blocked/missing
registered user отклоняются без изменения match, participants, score, event log или
version. Creator входит в standalone roster. Ошибка записи любого participant
откатывает match и весь roster; start повторно проверяет состав и first server.

### AT-MATCH-014 Atomic completion and idempotent replay
Injected failure после terminal match write, stats или judge release откатывает
все эти эффекты вместе с tournament advancement. Повтор успешного confirmation
тем же judge/auth session возвращает `200 finished`, не меняет version повторно и
не дублирует wins/losses, bracket materialization или notifications. Manual stop
использует ту же transactional terminal-write boundary.

### AT-MATCH-015 Moscow default title
При одном фиксированном UTC instant форма создания матча строит одинаковое
`Матч {дата и время}` в `Europe/Moscow` при timezone клиента `UTC`,
`America/Los_Angeles` и `Asia/Tokyo`. Редактируемый title payload не меняет
контракт абсолютных UTC timestamps.

### AT-MATCH-VOID-001 No hard delete
После void finished standalone match исходный результат и event/audit facts остаются,
физическое удаление недоступно, а повторный void идемпотентен.

### AT-MATCH-VOID-002 Standalone compensation
Stats и ranking aggregates finished standalone match компенсируются в одной
идемпотентной операции; исходный result и audit остаются доступными.

### AT-MATCH-VOID-003 Actor, optional reason and confirmation
Active admin и creator могут void finished/stopped standalone match с опциональной причиной
и без второго approver. Participant, current judge и outsider без одной из этих
ролей получают 403 без side effects. До request UI требует отдельного confirmation
с описанием soft invalidation и stats impact; закрытие dialog без подтверждения
оставляет всё без изменений, stale version не создаёт audit/compensation.

### AT-MATCH-VOID-004 Tournament history preservation
После void finished/stopped tournament match меняются только target
status/version, его собственный stats/ranking contribution и одна append-only
audit row. `bracket_json`, `bracket_state_version`, downstream rows/results/stats
и notifications до/после равны; прежнее продвижение winner/loser сохраняется.
Повтор того же key возвращает тот же outcome. Confirmation отдельно сообщает,
что остальная сетка не будет пересчитана (D33/DATA-007).

## JUDGE

### AT-JUDGE-001 Atomic acquire
Два параллельных запроса на свободный матч дают ровно одну активную judge session.

### AT-JUDGE-002 One judge / one device
Пользователь с активной judge session не может захватить судейство из другой auth session.

### AT-JUDGE-003 Release
После release другой допустимый пользователь может захватить матч без потери счёта.

### AT-JUDGE-004 Handover
Передача атомарно закрывает старую сессию и резервирует/создаёт новую для выбранного пользователя.

### AT-JUDGE-005 Expiry
После TTL без heartbeat слот освобождается; счёт не меняется.

### AT-JUDGE-006 Unauthorized score
Пользователь без активной judge session не может начислить очко.

### AT-JUDGE-007 Rapid score intent queue
Два быстрых намеренных нажатия `+1` до ответа первого request создают два разных
idempotency key, но только один in-flight request. Второй request начинается после
authoritative response первого с его новой version; итоговый счёт увеличивается
ровно на два. Pending queue видима, Undo недоступен до drain. `VERSION_CONFLICT`
останавливает очередь, обновляет authoritative счёт и показывает явное stale
сообщение без silent loss.

### AT-JUDGE-008 Explicit exit release
Back, setup Cancel и явный exit ожидают один release до навигации. Успех и
best-effort failure видимы на destination; после успешного release другой судья
может захватить слот без потери счёта. Обычный unmount не отправляет release и
оставляет crash fallback за TTL.

### AT-JUDGE-009 Lost lock and visible live sync
Visible setup/scoring выполняет heartbeat + authoritative refresh одним
30-секундным циклом. Hidden-состояние не имеет такого timer; visible resume
делает один immediate sync и создаёт один timer, который очищается при unmount.
Heartbeat `401/403/409` или lost-session code немедленно очищает point queue,
скрывает score/Undo/confirm/stop, показывает lost-lock и синхронизирует матч.
Внешний terminal status становится read-only без reload.

## TOURNAMENT

### AT-TRN-001 Minimum
Кнопка генерации недоступна при 0–2 игровых участниках и доступна при 3.

### AT-TRN-002 Maximum
65-й игрок отклоняется.

### AT-TRN-003 Organizer non-player
Организатор с `participates=false` не попадает в сетку и не уменьшает минимум игроков.

### AT-TRN-004 Generate closes collection
После генерации pending invitations expire и новые участники не добавляются.

### AT-TRN-005 Seeding
Игроки с большим all-time wins разводятся согласно алгоритму; unranked распределяются детерминированным seeded RNG в тесте.

### AT-TRN-006 Manual edit
До старта пары и bye можно менять; после старта API возвращает immutable-state error.

### AT-TRN-007 Dissolve
Роспуск удаляет bracket draft, сохраняет участников и возвращает collecting.

### AT-TRN-008 Withdraw before start
После выхода из generated bracket турнир становится `needs_regeneration`.

### AT-TRN-009 Parallel matches
Система не активирует два матча с одним игроком одновременно.

### AT-TRN-010 Single elimination
Победители корректно продвигаются до финала; проигравшие полуфиналов формируют матч за третье место.

### AT-TRN-011 Double elimination
Проигравшие переходят в losers bracket, а чемпион определяется одним финальным матчем.

### AT-TRN-012 Stop
Сыгранные матчи учитываются, несыгранные отменяются, winner/top турнира отсутствует.

### AT-TRN-013 Points summary
Турнирные очки игрока равны сумме его реально набранных игровых очков.

### AT-TRN-014 Cancel before start
Организатор отменяет турнир до старта → статус `cancelled`. Пользователь не в составе получает `NOT_A_PARTICIPANT` при withdraw.

### AT-TRN-015 Legacy V1 DE fails closed
Legacy schemaVersion 1 double-elimination input завершается bounded ошибкой
`UNSUPPORTED_BRACKET_VERSION` на start, edit, regenerate и dissolve: ошибка
возникает до обхода slots, игровой цикл не запускается, bracket JSON/version,
status, matches и notifications не меняются, migration/reset/recreate не
инициируется. V2 SE/DE lifecycle продолжает работать; V1 SE стартует по прежнему
пути.

### AT-TRN-016 Organizer-only roster and bracket
Только organizer route-турнира напрямую добавляет/удаляет participant и
генерирует/перегенерирует bracket. Participant, active judge другого события,
outsider и admin без contextual ownership получают `403`; roster, bracket и
status не меняются. Organizer happy paths сохраняются.

### AT-TRN-017 Cross-tournament participant mismatch
Organizer турнира A передаёт в route турнира A `participantId` турнира B →
`404 NOT_FOUND`; participant турнира B остаётся active, а турнир A сохраняет
исходные bracket/status. Authorization organizer турнира A проверяется до
participant existence, mutation ограничена обоими IDs.

### AT-TRN-018 Concurrent advancement
Два полуфинала одного V2 single-elimination tournament подтверждаются параллельно
разными активными судьями. Оба результата коммитятся, `bracket_state_version`
переходит последовательно, final и third-place materialize ровно по одному разу,
каждый node имеет один `actualMatchId`, а статистика всех четырёх игроков учтена
ровно один раз. Retry одного confirmation не создаёт дополнительных matches.

### AT-TRN-019 Invitation and roster concurrency
Два параллельных invite одной пары возвращают один pending invitation и создают
одну notification. Параллельные accept/direct add оставляют одного active
registered participant; wrong organizer/user/entity и rollback fault не меняют
invitation, roster или notification.

### AT-TRN-020 Busy player with bye cannot start

Если зарегистрированный organizer или participant уже находится в active
standalone match, `POST /tournaments/{id}/start` возвращает
`PLAYER_ALREADY_IN_ACTIVE_MATCH` независимо от deterministic seed и назначения
bye. Отклонение происходит до materialization: status остаётся
`bracket_generated`, `started_at` остаётся null, bracket JSON/version не меняются,
tournament matches и notifications не создаются. После освобождения standalone
match обычный non-bye start остаётся доступен.

### AT-TRN-021 Moscow default title
При одном фиксированном UTC instant форма создания турнира строит одинаковое
`Турнир {дата и время}` в `Europe/Moscow` при timezone клиента `UTC`,
`America/Los_Angeles` и `Asia/Tokyo`. Существующий формат label и редактируемый
title payload сохранены; контракт абсолютных UTC timestamps не меняется.

### AT-TRN-016 Organizer-only roster and bracket
Только organizer route-турнира напрямую добавляет/удаляет participant и
генерирует/перегенерирует bracket. Participant, active judge другого события,
outsider и admin без contextual ownership получают `403`; roster, bracket и
status не меняются. Organizer happy paths сохраняются.

### AT-TRN-017 Cross-tournament participant mismatch
Organizer турнира A передаёт в route турнира A `participantId` турнира B →
`404 NOT_FOUND`; participant турнира B остаётся active, а турнир A сохраняет
исходные bracket/status. Authorization organizer турнира A проверяется до
participant existence, mutation ограничена обоими IDs.

### AT-TRN-018 Concurrent advancement
Два полуфинала одного V2 single-elimination tournament подтверждаются параллельно
разными активными судьями. Оба результата коммитятся, `bracket_state_version`
переходит последовательно, final и third-place materialize ровно по одному разу,
каждый node имеет один `actualMatchId`, а статистика всех четырёх игроков учтена
ровно один раз. Retry одного confirmation не создаёт дополнительных matches.

## RANKING

### AT-RANK-001 Sort
Порядок: wins, win rate, matches played, user created_at — всё descending.

### AT-RANK-002 Calendar scopes
Неделя и месяц считаются по календарным границам `Europe/Moscow` независимо от
timezone клиента/сервера; all-time используется по умолчанию. Проверяются события
по обе стороны UTC-момента московской границы.

### AT-RANK-003 Guest opponent
Победа над гостем увеличивает рейтинг зарегистрированного пользователя; гость не появляется в списке.

### AT-RANK-004 Blocked user
Blocked user отсутствует в текущем рейтинге.

### AT-RANK-005 Текущие участники команды
Фильтр предлагает только активные команды текущего участника. Рейтинг выбранной
команды содержит её текущих активных пользователей, без выбывших/blocked.
Чужая недоступная команда не раскрывает участников; некорректный query даёт 400.
Командная сумма побед следует D3/Q2 независимо от выбранного периода строк.

### AT-RANK-006 Переход в публичный профиль
Каждая строка, включая podium, открывает каноническую публичную карточку.
Вызов сопернику открывает форму с выбранной целью; самому себе CTA отсутствует.
Поздний ответ предыдущего периода/команды не заменяет текущий выбор.

## TEAMS

### AT-TEAM-001 Captain rights
Только капитан редактирует, приглашает и исключает.

### AT-TEAM-002 Invitation TTL
Через 14 дней pending invitation становится expired и не принимается.

### AT-TEAM-003 Auto-add
Текущий участник команды может добавить текущего сокомандника в матч без acceptance.

### AT-TEAM-004 Leave
Обычный member выходит; captain без передачи не выходит.

### AT-TEAM-005 Auto captain
При исчезновении капитана выбирается активный member с минимальным joined_at.

### AT-TEAM-006 Archive
После ухода последнего участника team status становится archived.

### AT-TEAM-007 Invitation and membership concurrency
Параллельный invite одной пары создаёт одну pending invitation/notification;
параллельный accept и retry возвращают один terminal outcome и оставляют один
active membership. Wrong captain/invited user и injected downstream fault не
оставляют частичных строк.

## NOTIFICATIONS

### AT-NOTIF-001 Active action
Актуальная карточка позволяет принять/отклонить и синхронизирует invitation status.

### AT-NOTIF-002 Expired reason
Истёкшая/отозванная карточка не имеет action buttons и показывает причину и
server-side время terminal перехода.

### AT-NOTIF-003 Popup suppression
Просроченное приглашение не показывает popup после нового входа.

### AT-NOTIF-004 Minimal read state
Открытие видимой части списка одним owner-scoped batch помечает карточки
прочитанными server clock-ом без создания новых событий. Retry сохраняет первый
`readAt`; прочитанное pending invitation остаётся actionable, но badge очищается.

### AT-NOTIF-005 Terminal invitation lifecycle
При достижении TTL или отмене source entity invitation и notification переходят
в terminal lifecycle атомарно. Карточка остаётся в истории как
`expired|cancelled`, но не считается `new`, не входит в unread/actionable выборку
и не показывает actions/popup.

## VISIBILITY / HISTORY

### AT-VIS-001 Active event
Active event доступен organizer, participant и current active judge. Бывший/expired
judge и outsider получают 403 на detail и не получают событие через
list/home/history. Для турнира current active judge подтверждается
неосвобождённой и неистёкшей judge session его дочернего match, а не только
назначением default judge.

### AT-VIS-002 Completed event
Любой active (`status != blocked`) club user открывает завершённое событие, даже
если не участвовал. Completed history включает `finished|stopped|cancelled` для
match и tournament; остальные текущие статусы считаются active.

### AT-VIS-004 Blocked and tutorial isolation
Blocked user не получает завершённое событие; tutorial event не появляется в
общих list/home/history даже после завершения и не открывается посторонним.

### AT-VIS-003 History filters
Комбинация фильтров и поиска возвращает только соответствующие события и стабильную
пагинацию, включая одинаковые timestamps без повторов. Дни фильтра вычисляются
по Москве независимо от timezone клиента. Возврат из деталей сохраняет фильтры,
поиск и загруженные страницы; ошибка следующей страницы сохраняет предыдущие.
Для finished турнира победа соответствует сохранённому championParticipantId,
поражение — другому активному участнику. Stopped/cancelled турнир и пользователь
без роли участника не получают win/loss; неизвестный чемпион не создаёт результат.
Учебные события исключены, voided матч видим как terminal, но result-neutral.

### AT-HOME-001 Dashboard composition
Авторизованный пользователь получает на главной не более одного доступного
активного standalone-матча и одного доступного активного турнира, последние пять
завершённых standalone-матчей/турниров в общем хронологическом порядке, полный
hero-набор `played/wins/losses/winRate/averagePoints` и принципиального соперника
только после трёх очных матчей. Матчи и турниры не обходят AT-VIS-001/002/004.

### AT-HOME-002 Ranking period and empty actions
Топ-3 по умолчанию строится за всё время; переключатель «за месяц» обновляет тот
же dashboard без смешивания ответов периодов. При отсутствии активных событий,
истории, рейтинга или принципиального соперника каждый раздел объясняет состояние
и предлагает релевантное действие. Главная сохраняет входы в уведомления и профиль.

## LIVE STATE

### AT-LIVE-001 Visible cadence and resume

Home, match/tournament list и active detail делают initial load и один refresh
каждые 30 секунд при visible document. Hidden state не имеет live timer;
hidden → visible выполняет один immediate refresh и запускает один timer. Повторный
visible event не создаёт второй refresh/timer, unmount очищает timer. Match или
tournament detail прекращает polling после получения terminal status.

### AT-LIVE-002 Manual retry and request coalescing

На каждой live surface доступно ручное «Обновить». Initial failure можно повторить
без navigation/reload; background failure сохраняет последние валидные данные и
показывает warning. Timer/manual/visible refresh, возникшие во время одного
in-flight request, не создают второй параллельный request. JudgePage сохраняет
единственный JUDGE-008/AT-JUDGE-009 heartbeat+refresh loop.

## UI RESILIENCE

### AT-UI-001 Loaded context survives action error
После успешной загрузки match detail отказ start/stop/cancel/void/admin mutation
показывает action-local alert, не заменяет карточку общим error state и сохраняет
название, authoritative score, участников и навигацию.

### AT-UI-002 Critical submit is single-flight
Два синхронных submit/click события на create-user/team/tournament,
first-password, feedback, onboarding или invitation response создают ровно один
in-flight client request; связанные CTA disabled до settle. Concurrent normalized
email create возвращает один success и один `409 EMAIL_ALREADY_EXISTS` с одной
persisted user row; DATA-004 invite/respond retry сохраняет один invitation,
membership/participant transition и notification effect.

## EMPTY / ONBOARDING

### AT-ONB-001 Once
После первой смены временного пароля `GET /auth/me` возвращает incomplete state и
приложение автоматически открывает onboarding. Переход с шага 4 на шаг 5
сохраняется server-side; reload или новый login открывает шаг 5. Complete/close
записывает timestamp до перехода на Home и onboarding сам больше не открывается.

### AT-ONB-002 Restart
Кнопка профиля выполняет authenticated restart mutation, очищает completion,
сбрасывает step на 0 и только после success открывает первый шаг. Ошибка не
перенаправляет и доступна для retry.

### AT-ONB-003 Skip and tutorial resume
Каждый feature step можно пропустить с сохранением следующего шага. Запуск
tutorial сначала сохраняет последний step и создаёт не более одного match при
double-click; выход/завершение tutorial возвращает на последний шаг. До решения
Q-ONB-001 completion остаётся отдельным explicit действием.

### AT-EMPTY-001 Zero data
Новый пользователь видит осмысленные empty states и CTA, а не нули без объяснения.

## DATABASE EVOLUTION

### AT-DATA-MIG-001 Fresh and historical upgrade
Один ordered migration set на clean PGlite/PostgreSQL создаёт текущие 18 public
tables, required indexes и version ledger. Тот же set принимает historical
unversioned boot schema, сохраняет sentinel rows/JSON, добавляет известные columns,
выполняет documented backfill и при повторном запуске не добавляет ledger rows.

### AT-DATA-MIG-002 Startup fails closed on schema drift
Persistent API startup не выполняет schema DDL и до любых bootstrap/seed/listen
действий отклоняет missing, pending, unexpected, reordered или checksum-mismatched
migration ledger. Exact current ledger допускает startup. In-process migration
разрешена только explicit in-memory `AUDIT_EPHEMERAL=1` fixture.

## OPERATIONS UX

### AT-OPS-API-001 Current runtime OpenAPI
**Given:** Fastify routes и root release version зарегистрированы в текущем
repository source.
**When:** выполняются OpenAPI contract test и strict route inventory.
**Then:** `/api/v1/openapi.json` содержит ровно все зарегистрированные public
operations без несуществующих operations, использует root release version,
явно описывает public/session/CSRF boundary, path parameters, key request/success
schemas и единый `{code,message,details?,requestId?}` error schema. Target-only
или переименованные endpoints остаются явно отмеченными gap в target API spec и
не выдаются за runtime operations.

### AT-OPS-OBS-001 Liveness and DB readiness
`GET /health` не зависит от DB probe и отвечает process liveness. `GET /ready`
выполняет read-only DB probe: успех возвращает 200/`ready`, injected DB failure —
503/`not_ready` с `database=failed`. Ни response, ни log не раскрывают исходный
driver error; оба response содержат тот же request ID, что и structured logs.

### AT-OPS-OBS-002 Redacted structured request/error logs
Runtime пишет по одной JSON completion-записи на request с request ID, method,
matched route, status и latency; 5xx/readiness failure создаёт structured error
signal. Cookie, authorization/CSRF headers, request body, query values и raw
exception message/stack не сериализуются. Error responses сохраняют единый
`{code,message,details?,requestId}` contract.

### AT-OPS-SAFE-001 Backup rehearsal boundary
Без `BACKUP_REHEARSAL_CONFIRM=1`, для non-loopback source, database без
`test|local|dev|ci|rehearsal` marker или restore identifier вне
`tab10_restore_rehearsal_*` команда завершается до `pg_dump`/`psql`. Допустимый
disposable flow создаёт unique temp dump, передаёт database identifier как quoted
psql variable и удаляет restore DB/temp artifact как при успехе, так и через trap.

### AT-OPS-SAFE-002 Local seed boundary
`seed:local-players` завершается до первого HTTP request при
`NODE_ENV=production` или non-loopback `API_BASE`; loopback development target
остаётся разрешён.

### AT-OPS-COLD-001 Cold start
**Given:** первый API response задержан пробуждением до 60 секунд.
**When:** пользователь открывает приложение.
**Then** показано явное состояние «сервис просыпается/загрузка», ожидание ограничено
timeout и после него доступен Retry; после успешного ответа обычный экран загружен.

### AT-OPS-COLD-002 Warm request
После подтверждённого пробуждения медленный/ошибочный запрос не маркируется как
допустимый cold start: применяется обычный error/SLO path с Retry.

## DELIVERY

### AT-OPS-DELIVERY-001 Hermetic full gate
Fresh checkout на Node `24.20.0` и pnpm `9.15.0` без `.env` и production secrets
выполняет `pnpm verify:all` на автоматически созданном PostgreSQL `16.15` и
Playwright-managed Chromium. Итог содержит `0 failed`, `0 skipped`, `0 todo`; в
`finally` не остаётся контейнеров, volumes или дочерних процессов.

### AT-OPS-DELIVERY-002 Required lanes are fail-closed
Push в `main` имеет результаты `success` для `quality`, `postgres-integration` и
`browser-prodlike`. `release-gate` становится зелёным
только при всех трёх `success`; отдельно сломанный unit, migration или browser
scenario делает его красным, а `skipped`/`neutral` не принимаются.

### AT-OPS-DELIVERY-003 Release identity
API `/health` и `/ready`, web `/release.json` публикуют одну структуру
`{ sha, version, environment, dirty }`. В staging/production `sha` — полный
40-символьный Git SHA, `dirty=false`, а `version` точно равна root
`package.json`. Web, direct API и proxy API обязаны совпасть с ожидаемым SHA.

### AT-OPS-DELIVERY-004 Fresh public bootstrap
После явного одноразового разрешения точные `public`/`drizzle` текущего
disposable Neon stand пересоздаются пустыми. Обычный `--mode=apply` создаёт
17-table baseline и exact ledger; повторный apply — безопасный no-op. Ни project,
ни branch, ни database, role или endpoint не удаляются.

### AT-OPS-DELIVERY-005 Migration serialization and repeatability
Два конкурентных migrator-а на одной disposable PostgreSQL используют один
advisory lock; ровно один применяет план, второй завершается безопасным no-op.
Повторный `--mode=apply` не меняет catalog/data/ledger. Lock и statement timeout
ограничены.

### AT-OPS-DELIVERY-006 Compiled same-origin browser
Required E2E запускает production builds API/web с относительным API URL через
одинаковый same-origin proxy, production cookie/CSRF path и bundled Chromium.
Desktop `1280×800` и mobile `390×844` идут с `workers=1`, `retries=0`,
`forbidOnly=true`.

### AT-OPS-DELIVERY-007 Native main deployment
После прямого push в `main` Render native Git deploy применяет immutable
migrations и запускает compiled API, а Vercel production branch `main` публикует
compiled web. Provider Git metadata является SHA source; отдельные deploy tokens
не нужны. Для disposable stand CI этого SHA выполняется параллельно и не
задерживает deploy.

### AT-OPS-DELIVERY-008 Bounded release convergence
Локальная команда `pnpm smoke:public` не изменяет provider/DB state, сама получает
exact SHA из `origin/main` и ограниченно повторяет read-only probes, пока direct
API, canonical web и web proxy не сообщат ожидаемый SHA/version, либо завершается
красным по timeout.

### AT-OPS-DELIVERY-009 Public read-only smoke
Стабильные origins проходят `/release.json`, direct/proxy `/health`, `/ready` и
OpenAPI checks. Redacted artifact содержит ожидаемый SHA/version и имена checks,
но не URL, database contents или credentials. State-changing E2E на public stand
не запускается.
