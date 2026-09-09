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
`UNSUPPORTED_BRACKET_VERSION`: не запускает игровой цикл, не зависает, не меняет
сетку и не инициирует migration/reset/recreate. V2 SE/DE lifecycle продолжает
работать; V1 SE не изменяется этим сценарием.

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
Комбинация фильтров и поиска возвращает только соответствующие события и стабильную пагинацию.

## EMPTY / ONBOARDING

### AT-ONB-001 Once
Онбординг автоматически открывается один раз и не открывается снова после завершения/пропуска.

### AT-ONB-002 Restart
Кнопка профиля позволяет запустить его повторно.

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
