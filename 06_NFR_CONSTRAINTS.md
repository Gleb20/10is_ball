# NFR и ограничения — Tab-10 MVP

## 1. Архитектура

### Факты
- Модульный монолит.
- Один backend, одна PostgreSQL, один web frontend.
- REST/JSON.
- Локальная сессионная авторизация через secure cookie.
- Без WebSocket и внешней очереди.

### Рекомендации
- Не вводить Redis, брокер сообщений и отдельные сервисы до измеренной необходимости.

## 2. Производительность

Целевая нагрузка:
- 250 пользователей;
- до 10 параллельных матчей;
- 2 CPU / 2 GB RAM;
- polling раз в 30 секунд на активных экранах.

SLO для нормальной нагрузки:
- p95 чтения простого ресурса < 500 мс;
- p95 записи очка < 700 мс;
- p95 home aggregate < 1200 мс;
- генерация сетки до 64 игроков < 2 сек;
- старт приложения после деплоя < 30 сек.

## 3. Надёжность счёта

- подтверждённое очко сохраняется транзакционно;
- ответ клиенту отправляется после commit;
- idempotency key защищает от повторной отправки;
- optimistic version защищает от конфликтов;
- Undo выполняется транзакционно;
- текущий счёт можно восстановить из активных match events;
- snapshot и event log проверяются invariant-тестами.

## 4. Безопасность

- пароль хранится только как современный адаптивный hash;
- cookie: `HttpOnly`, `Secure`, `SameSite=Lax/Strict` по deployment;
- CSRF-защита для state-changing запросов;
- rate limit login;
- временный пароль одноразовый и не хранится открытым;
- после блокировки все сессии завершаются;
- роли и контекстные права валидируются на сервере;
- админские маршруты закрыты отдельной проверкой роли;
- не логировать пароли, cookie и чувствительные payload.

## 5. Session behavior

- sliding TTL 7 дней;
- heartbeat judge session не продлевает auth session без обычной валидации;
- сессии имеют device/browser label по user-agent;
- пользователь может завершить собственную другую сессию;
- admin reset завершает все сессии.

## 6. Хранение файлов

MVP допускает локальное хранение пользовательских аватаров:
- максимум 2 MB;
- JPEG/PNG/WebP;
- серверная проверка MIME и декодирование;
- ресайз до фиксированных размеров;
- случайное имя файла;
- резервное копирование каталога вместе с БД.

## 7. Резервное копирование

- ежедневный backup БД;
- хранение минимум 7 ежедневных копий;
- регулярная тестовая проверка restore;
- backup аватаров;
- документированная процедура восстановления.

## 8. Наблюдаемость

Минимум:
- structured application logs;
- request id;
- latency/status;
- error count;
- DB connection count;
- disk usage;
- active judge sessions;
- failed login rate;
- backup result.

## 9. Accessibility и UX

- touch targets минимум 44×44;
- keyboard navigation для desktop;
- видимый focus;
- контраст не ниже WCAG AA для ключевых элементов;
- ошибки не полагаются только на цвет;
- judge buttons имеют текст/иконку и подтверждённую сторону.

## 10. Совместимость

- последние 2 версии Chrome, Safari, Firefox, Edge;
- современные Android/iOS browsers;
- responsive width от 360 px;
- judge landscape должен работать без нативного приложения.

## 11. TDD quality gates

- unit tests для pure domain logic;
- integration tests с реальной PostgreSQL в ephemeral environment;
- API tests для auth/permissions/state transitions;
- E2E только для критичных пользовательских маршрутов;
- тесты не зависят от реального времени и случайности;
- минимальный line coverage не заменяет сценарное покрытие;
- рекомендуемый порог: 85% для domain/application layers, 70% overall;
- mutation testing точечно для match/tournament rules;
- flaky tests блокируют релиз и исправляются, а не перезапускаются до зелёного.

## 12. Ограничения MVP

- нет email;
- нет self-registration;
- нет внешних auth providers;
- нет background job infrastructure;
- нет live spectator mode;
- нет offline-first режима;
- нет hard delete исторических спортивных данных;
- нет изменения email;
- нет нескольких организаций.
