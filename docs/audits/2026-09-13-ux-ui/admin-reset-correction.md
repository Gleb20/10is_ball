# BUG-038 — обязательное уточнение reset-контракта

Принято independent Terra/root review: reset-review.json. Исходные шесть файлов admin-reset-spec неизменны; эти пункты заменяют противоречащие им утверждения. Предлагается один protocol, не общий framework.

## Порядок блокировок

Сначала existing `lockAdminMutationUsers(actor,target)` в его детерминированном порядке и transaction recheck прав/существования target. Затем insert/select receipt, fingerprint и terminal outcome; затем pointer CAS/записи. Не вставлять receipt с FK на users перед user FOR UPDATE: два запроса могут удерживать FK key-share locks и взаимно ждать upgrade. Один и тот же порядок используется всеми reset paths. Полученный preHandler auth не заменяет transaction проверку.

Login/first-change/обычный password change получают target user lock до session lock и повторно проверяют активность пользователя/сессии и hash, который был проверен вне transaction. Дорогой hash вычисляется до lock; сохранение результата разрешено только после повторной проверки. Existing session revocation, policy, rate limiting и notifications не теряются. Эти изменения входят в тот же bounded AuthService scope и PG tests, не объявляются уже реализованными.

## Что означает указатель

`lastAppliedRequestId` обозначает последний применённый **admin reset**, а response `current` — совпадение с этим указателем. Он не доказывает, что пользователь ещё не сменил пароль, что выданный пароль сейчас действителен или что сессии после него не создавались. GET никогда не возвращает validity, пароль или его hash.

Copy: «Запрос сброса выполнен. Получить выданный пароль повторно нельзя. Пользователь мог уже изменить его». Если current=false: «После этого выполнен другой сброс». Новый reset — самостоятельная явно подтверждённая выдача с отзывом актуальных сессий, не восстановление старого пароля.

## Цепочка неизвестных запросов

Для A/B сохраняется доказательство обоих порядков из contract.md. Для A/B/C не обещать, что C обязательно применится: если C прочитал P, затем применился A и C пришёл до B, C с expected=P/supersedes=B корректно получает RESET_STATE_CHANGED. Это безопасный отказ, требующий свежего GET и нового явного решения. Не вводить транзитивное supersedes множество или автоматический rebase ради гарантированного успеха.

PG-RST-010 заменяется: во всех порядках C либо применяется и ни один поздний предшественник его не перезаписывает, либо получает terminal rejected_state_changed без credential/session/issue/audit изменения; UI не повторяет его автоматически. Снимок P, A→C→B — обязательная negative ветка.

## Одноразовый показ при self-reset

Успешный self-reset уже отзывает caller session на сервере. Клиент переносит полученный secret в отдельное in-memory one-time presentation состояние над Protected route boundary, затем очищает локальную авторизацию и скрывает весь остальной private UI. Auth redirect/401 не размонтирует это единственное состояние до явного «Закрыть» или ухода/reload; Copy само по себе не закрывает показ. Close удаляет secret из памяти и ведёт на login. Никакого local/sessionStorage для plaintext, никаких действующих admin controls/фоновых admin запросов в этом состоянии.

После потерянного self-reset ответа защищённый receipt GET недоступен прежней сессии. Другой active admin может использовать обычный авторизованный recovery flow. Если другого admin нет, показать честное «Доступ к аккаунту необходимо восстановить через сопровождение сервиса»; не обещать, что existing startup bootstrap умеет менять пароль существующего аккаунта: это неверно. Проверенной универсальной ops-процедуры здесь нет; она не создаётся в рамках UX-задачи и остаётся явным эксплуатационным ограничением. Не вводить unauth receipt/read или обход прав.

## Контекст браузера и ошибки

SessionStorage содержит только `{actorId,targetId,requestId,expectedLastAppliedRequestId,supersedesRequestId?}` и имеет ключ по actor+target. Никаких паролей, cookies/token/auth-session секретов. Запись делается до POST; при storage unavailable используется in-memory контекст с явным ограничением восстановления после reload, отправка не дублируется. После смены actor/target, обычного logout и self-reset persisted контекст очищается и не показывается новому actor. Same-actor reauth может восстановить только эту корреляцию незавершённого reset другого target, затем fresh authorized GET, без POST. Для self-reset unknown ID показывается только в текущем in-memory auth-blocked сообщении как несекретный номер обращения; право читать receipt из него не выводится.

Не обещать `500` только при полном rollback: ошибка формирования/доставки ответа возможна после commit. Transaction fault tests доказывают rollback именно инъецированной transaction failure, а любой неясный5xx/network на клиенте остаётся unknown и проверяется exact receipt. Отсутствующая запись никогда не доказательство отказа.

## Дополнительная приёмка

Проверить deterministic simultaneous receipt FK/user-lock order, включая reset × block/demote без deadlock; A/B оба порядка и A→C→B safe conflict; user password change не меняет смысл current; self-reset received success сохраняет только одноразовый показ при cleared auth, Copy не теряет secret, Close/reload очищают; lost self-reset не обещает bootstrap; actor/target switch/sessionStorage blocked, malformed scope, 500 после commit, strict response allowlist. Всё это будущие проверки реализации, не выполненный runtime.
