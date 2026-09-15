# Ручная коррекция — точный исход и восстановление

Постановка принята Terra/root: correction-review.json. Это дополнение к BUG-029, не перенос арифметики +1 на абсолютную коррекцию. BUG-031 отвечает только за focus.

## Наблюдение

Дополнительный JUDGE probe на GAP012r6: submitted4:2/B, expectedVersion1, server200 version2; после abort UI остаётся1:0, draft4:2, Save enabled. Явный повтор с новым UUID/старой version1 получает409, сервер остаётся4:2 с одним событием и одним prefixed key. Второй probe удержал запрос перед сервером: ранний GET version1 без ключа, после освобождения запрос сохранился version2. Это P2 recovery/copy, не доказательство двойного начисления.

## Состояния и действия

Перед первым POST сохранить immutable `{matchId,actorId,authSession context,key,expectedVersion,scoreA,scoreB,currentServerParticipantId}` отдельно от draft. Не хранить credential/token, не экспортировать сессию. Во время pending отправленные поля/Save закрыты; DOM focus соответствует BUG-031. Outcome привязан к одной попытке, а не к последним редактируемым значениям.

Known validation/authorization error показывает локальный текст; не вводит новый повтор сам. Network/5xx и неопределённый исход переводят форму в сверку, не объявляют изменение отклонённым. Первое восстановление — single-flight GET existing match. Все новые score/Undo/correction/finish записи временно закрыты. Background GET не создаёт второй параллельный recovery и не стирает draft.

Точное наличие `manual-correction:<submitted UUID>` в полных idempotencyKeys доказывает применение попытки. Подтвердить «Коррекция сохранена», показать текущий authoritative счёт/подачу/статус, а не насильно установить submitted4:2, если после коррекции были другие события. Закрыть завершённую форму, вернуть focus по BUG-031, не повторять POST. При lost judge/terminal оставить read-only актуальный экран; наличие ключа не возвращает права.

Если ключ отсутствует, исход всё ещё неизвестен. Текст «Не удалось проверить результат коррекции», рядом «На сервере сейчас …» и «Вы отправляли …». «Проверить ещё раз» делает только GET. Нет сообщения «матч изменился на другом устройстве», когда источник изменения не доказан: для version conflict «Состояние матча изменилось. Показаны актуальные данные».

После успешного GET доступны явные решения по тому же принципу, что в score-recovery-target:

1. «Принять показанный счёт» → отдельное подтверждение отображаемого счёта/подачи и версии → без mutation; отказаться от старого draft и вернуться к актуальному экрану. Это решение оператора о реальном счёте, а не техническое доказательство отказа поздней попытки. Возможные последующие изменения отображаются штатной синхронизацией.
2. «Задать другой счёт» → новая форма показывает authoritative счёт как основу и отдельно прежнее отправленное значение; прежнее не подставляется скрыто. Пользователь явно задаёт новый абсолютный счёт/подачу. Новый UUID и expectedVersion строго из показанного успешного GET; скрытый rebase запрещён. Если оригинальная или другая mutation выиграла гонку,409 возвращает сверку, не выполняет автоматический повтор с новой version.

Не использовать кнопку «Повторить» для создания новой попытки. Не делать automatic retry даже с тем же UUID. Без успешного GET обе решения недоступны; можно оставить экран через существующую навигацию без обещания отмены запроса. При возвращении сначала актуальный GET и session ownership gate; память старой формы не переносится другому actor. Same actor reauth сохраняет draft только по existing in-memory exception, без autoPOST; иной actor видит чистый экран.

## Контракт и приёмка

API/data/reducer остаются прежними: row lock, active judge/authSession, expectedVersion и stored prefix. В `pending_confirmation` разрешённая коррекция может вернуть in_progress согласно текущим правилам; finished/cancelled/voided не становятся редактируемыми. Serve задаётся существующим participant ID, не A/B display label.

Перед реализацией подтвердить, что getMatch продолжает отдавать полные keys и version. Тесты: committed loss→exact key positive; early absence→unknown; applied+later score не затирается submitted snapshot; stale resend409 не прибавляет event; malformed/known4xx; unavailable GET; same/different actor; handover/terminal during recovery. Для explicit new correction проверить оба порядка original/new при одинаковой прочитанной version в disposable PG: одна проходит, другая conflict, без silent rebase. Дополнительно competing score/finish и current session guard. Existing full gate требуется из-за критического пути; будущая браузерная приёмка360/390/1440/keyboard/focus/slow network.

Никаких новых sports rules, offline queue, автоматических мутаций, новых endpoints или переписывания event log. Если полнота keys/монотонность version не подтверждается текущим контрактом, остановить эту часть и уточнить входной контракт, а не заменять proof сравнением счёта.
