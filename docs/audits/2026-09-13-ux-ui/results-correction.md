# Координаторский target RESULTS

Статус: предложения на independent review. Оригинальный пакет40 payloads, manifest b5633165133259c0e3810631c341121747cbf84a5c28b6fb41345f2a17167b15, неизменен. Этот документ исправляет целевые постановки; он не является новым runtime evidence.

## История и контекст оператора

У человека, который судил или создал матч для других, нет собственной стороны и «соперника». Поэтому вместо предложенного counterpartyLabel добавить два display-only поля sideA/sideB в match history item; tournament получает null/null. Показывать обе стороны для всех актёров, в том числе viewer и судьи. Не добавлять participant IDs/email или новые права. Строки формируются в существующем разрешённом запросе без GET detail на каждый элемент; порядок имён соответствует slots стороны. Исторические гости/blocked сохраняются, отображаемые имена следуют существующей PROFILE-006 политике.

Схема строки: заголовок → «{sideA} — {sideB}» → дата/время Москвы, формат, роли → счёт/результат и статус. Не выдумывать место турнира: текущий HistoryItem place не содержит. Существующие title и result остаются. Отдельный search chip называется «Поиск», поскольку запрос может относиться к турниру. Ниже480px поле занимает всю строку, «Найти» идёт отдельной следующей строкой; кнопки44px, текст не режется до потери имени, высота строки автоматическая.

F-RESULTS-002 URL persistence — дополнительная экспертная гипотеза. Текущий actor-scoped detail→Back уже работает и сохраняется. Синхронизация фильтров с URL не включена в GAP-024: востребованность прямых ссылок/refresh ещё не проверена; отдельной ready задачи нет. Запросы и непрозрачный cursor остаются как сейчас.

## Главная и текущий ведущий

Не вводить новые currentJudgeName/judgeSlotStatus/actorHistoricalRole ради этой задачи. В существующем Home matchCard разделить активный и terminal контекст по status:

- active judgeName берётся только из match.activeJudge, без fallback на последнюю историческую judge session;
- при activeJudge=null текст «Сейчас счёт не ведут». Это не утверждение, что слот свободен: reservation может существовать. Карточка ведёт в существующий detail, где проверяется точное состояние;
- active userRole остаётся отношением аккаунта: participant → аккаунт match.activeJudge.userId → organizer → viewer; historical session не становится текущей ролью. Это не auth-session ownership;
- terminal карточки сохраняют историческую attribution и текущий набор данных по HOME-003. Их не превращать в информацию о текущем владельце.

Названия ролей для active карточки: participant «Вы участник», organizer «Вы организатор», viewer «Событие клуба». При userRole=judge отдельная подпись роли не выводится: уже показано «Судья: {judgeName}». Фразы «Вы ведёте матч» на Home нет на любом устройстве; она допустима только после проверки auth-session в JudgePage. Не передавать authSessionId в Home ради подписи и не вводить лишнюю ветку авторизации. Для terminal сохранить прошедшее время. Никакой кнопки score/acquire прямо из Home, основанной на этих labels. Поля DTO и фильтры видимости сохраняются, семантика active presentation меняется явно и требует contract tests.

## Профиль

ProfileUpdateSchema находится в apps/api/src/app.ts, отдельной канонической client schema сейчас нет. Ввод проверять по тем же правилам: trimmed имя/фамилия1–100, организация/должность до200 или null, birthDate null либо календарная YYYY-MM-DD с годом больше0. Не добавлять возрастные ограничения. Клиент не должен молча обрезать строки или запрещать значение только из-за пробелов, допустимых после trim на сервере. Отдельный validator и meaningful boundary tests; сервер остаётся authority.

Known field error связывается с полем; generic400/403 остаётся локальным summary без догадки, какое поле виновато. Network/5xx: «Не удалось проверить сохранение», черновик сохранён, GET-only «Обновить данные», серверные значения показаны отдельно от попытки; новый Save только явный и без auto replay. Это page-form consumer принципа BUG-034, не новая универсальная recovery-система.

## Уведомления

Сохранить название «Актуальные», никаких вопросов пользователю по этому локальному copy выбору. Объяснение: «Непрочитанные уведомления и приглашения, на которые можно ответить». Исправить effective filter и local read transition, не переписывая terminal lifecycle от устаревшего read ответа. Actual = actionable либо effective new с readAt=null; terminal всегда определяется авторитетным текущим lifecycle. Read pending остаётся actionable. ActorNotificationsPage уже key=userId: сохранить этот guard, не объявлять новую архитектуру изоляции.

Focus при исчезновении прочитанной non-actionable строки: только если он был внутри удаляемой строки, перевести на следующую видимую строку, иначе предыдущую, иначе заголовок списка; обычный фоновый read не крадёт focus. Этот edge ещё не runtime-proven, это будущая приёмка исправления.

## Evidence limits

Full-page PNG — контекст и относительный порядок; он сам по себе не доказывает отсутствие перекрытия fixed nav или нахождение блока above fold. Framework/component tests same/different actor и history return — автоматизированные tests, не пользовательское прохождение. Все16 origin screenshots и отдельные viewport/run условия читаются по runs.csv. Physical/WebKit/spoken AT/true browser zoom не выполнены.

Канонические изменения: GAP-015, GAP-024, BUG-036/037 в BACKLOG. Открытые гипотезы остаются у TECH-006; замена их на ready потребует отдельного основания.

## Обязательная коррекция requirement mapping

Исходный RESULTS coverage-delta неправильно называет RANK-004 исключением blocked, RANK-005 командным рейтингом и вводит несуществующий RANK-006. По PRD:004 — текущие участники команды (two-member team fixture),005 — переход в карточку (own/public), blocked exclusion относится к HISTORY-004 как ограниченный cross-surface sample. Full tie-breaks и calendar boundaries не были изолированы.

ONB-003: tutorial lifecycle завершён API-запросами, отдельный browser judge-flow не пройден; не выдавать за UI acceptance. ONB-004: API before/after history/stats/ranking/rival isolation подтверждён указанной fixture. ONB-005: restart entry в профиле виден, полный повтор не выполнен. PROFILE-006: successful rename→historical labels не проверен; failed organization edit этого не доказывает. Central matrices сохраняют эти пределы и предыдущие независимые AUTH прогоны.

История в RESULTS проверяла матчи; смешанный список матчей/турниров не отдельная fixture. Reauth и detail Back доказаны focused component tests, не browser/user session. Desktop размеры RESULTS1440×1000, не1440×900. Вновь добавленная SC-R01 строка360×780 фиксирует именно pagination/error.
