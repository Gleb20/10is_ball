# Acceptance Test Catalog — Tab-10 MVP

Формат: сценарии верхнего уровня. Они должны быть декомпозированы в unit/integration/API/E2E тесты.

## AUTH

### AT-AUTH-001 Первый вход
**Given** администратор создал активного пользователя с временным паролем  
**When** пользователь входит  
**Then** он не попадает на главную, пока не задаст новый валидный пароль.

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

### AT-ADM-MATCH-001 Non-admin
Non-admin получает 403 на force-close и delete матча.

### AT-ADM-MATCH-002 Force-close clears PLAYER_BUSY
Stuck `in_progress` standalone → admin force-close → `cancelled` → тот же игрок может стартовать другой матч.

### AT-ADM-MATCH-003 Waiting unblocks tournament
`waiting` standalone блокирует старт турнира → force-close → турнир стартует.

### AT-ADM-MATCH-004 Tournament forbidden
Tournament match → force-close/delete → `TOURNAMENT_MATCH_FORBIDDEN`.

### AT-ADM-MATCH-005 Delete reverses rankings
Finished standalone учтён в rankings → delete → wins откатываются; GET match → 404.

### AT-ADM-MATCH-006 Force-close finished
Force-close на `finished` → `MATCH_NOT_ACTIVE`.

## MATCH RULES

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

### AT-MATCH-010 No-show
Ручная неявка создаёт победу с причиной, без выдуманного игрового счёта.

### AT-MATCH-011 Concurrency
Игрок с активным матчем не может стартовать второй активный матч.

### AT-MATCH-012 Tutorial isolation
Матч с Призрачным Олегом не меняет статистику, рейтинг, историю и rival calculations.

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

## RANKING

### AT-RANK-001 Sort
Порядок: wins, win rate, matches played, user created_at — всё descending.

### AT-RANK-002 Calendar scopes
Неделя и месяц считаются по календарным границам; all-time используется по умолчанию.

### AT-RANK-003 Guest opponent
Победа над гостем увеличивает рейтинг зарегистрированного пользователя; гость не появляется в списке.

### AT-RANK-004 Blocked user
Blocked user отсутствует в текущем рейтинге.

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

## NOTIFICATIONS

### AT-NOTIF-001 Active action
Актуальная карточка позволяет принять/отклонить и синхронизирует invitation status.

### AT-NOTIF-002 Expired reason
Истёкшая карточка не имеет action buttons и показывает причину.

### AT-NOTIF-003 Popup suppression
Просроченное приглашение не показывает popup после нового входа.

### AT-NOTIF-004 Minimal read state
Открытие видимой части списка помечает карточки прочитанными без создания новых событий.

## VISIBILITY / HISTORY

### AT-VIS-001 Active event
Посторонний user получает 403 на активный матч/турнир.

### AT-VIS-002 Completed event
Любой активный user открывает завершённое событие.

### AT-VIS-003 History filters
Комбинация фильтров и поиска возвращает только соответствующие события и стабильную пагинацию.

## EMPTY / ONBOARDING

### AT-ONB-001 Once
Онбординг автоматически открывается один раз и не открывается снова после завершения/пропуска.

### AT-ONB-002 Restart
Кнопка профиля позволяет запустить его повторно.

### AT-EMPTY-001 Zero data
Новый пользователь видит осмысленные empty states и CTA, а не нули без объяснения.
