# Local Auth & Tennis Admin Spec

## 1. Цель

Создать максимально простой локальный контур доступа, достаточный только для Tab-10.

## 2. Что удалено из концепции

- самостоятельная регистрация;
- заявки и ручное одобрение заявок;
- подтверждение email;
- письма активации и сброса;
- межпродуктовые аккаунты;
- каталог сервисов;
- сервисные доступы;
- роли разных приложений;
- отдельная панель управления общей учёткой;
- несколько организаций.

## 3. Роли

### `user`
Использует все спортивные функции.

### `admin`
Имеет все функции `user` и локальную панель пользователей.

Дополнительно (ADR D23/D24): active admin может **принудительно закрыть** active
standalone через тот же soft `cancelled` outcome, который доступен создателю, и
может void finished/stopped match. Удаление finished/stopped/voided результата
запрещено: void сохраняет исходные факты, audit и компенсирует статистику. Hard
purge остаётся admin-only только для non-finished standalone записи (D15
superseded scope). Cancel, void и допустимый purge требуют отдельного явного
confirmation в UI; причина cancel/void опциональна. Tournament и tutorial для
cancel/purge запрещены. Проверка MATCH-009 («игрок уже в активном матче») не
снимается.

Рекомендация: защитить invariant «в системе всегда остаётся минимум один активный admin».

## 4. User lifecycle

### Создание
1. Админ вводит профиль.
2. Сервер создаёт случайный временный пароль.
3. В БД сохраняется только hash.
4. Пароль показывается администратору один раз.
5. `must_change_password=true`.

### Первый вход
1. Проверка email/password/status.
2. Создание ограниченной сессии или continuation token.
3. Обязательная смена пароля.
4. Ротация session id.
5. Доступ в продукт и onboarding.

### Блокировка
- status → blocked;
- revoke all sessions;
- terminate active judge session;
- исключить из селекторов новых событий;
- не удалять команды и историю;
- если пользователь капитан — передать капитанство по правилу самой ранней даты вступления.

### Разблокировка
- status → active;
- пароль остаётся прежним, если отдельно не сброшен.

### Сброс пароля
- новый временный пароль;
- revoke all sessions;
- `must_change_password=true`;
- пароль показывается один раз.

## 5. Password generator

- криптографически стойкий источник случайности;
- длина рекомендована 16–20;
- гарантированно удовлетворяет политике;
- исключить неоднозначные символы при желании (`O/0`, `l/1`), не снижая энтропию существенно.

## 6. Login security

- одинаковая ошибка для неизвестного email и неверного пароля;
- rate limiting по IP + нормализованному email;
- задержка/lockout с ограниченным временем, без перманентной блокировки аккаунта;
- session fixation protection;
- hash алгоритм Argon2id или эквивалент актуального фреймворка;
- rehash при входе при изменении параметров.

## 7. Admin UX

Минимальные экраны:
1. список пользователей;
2. создание;
3. просмотр/редактирование;
4. confirm modal блокировки;
5. reset password с одноразовым выводом;
6. lightweight audit history пользователя;
7. explicit confirmation для force-close, void и допустимого non-finished purge.

Не включать:
- массовый импорт;
- групповые роли;
- permissions editor;
- редактирование матчей;
- impersonation;
- удаление пользователя.

## 8. TDD scenarios

Критичные тесты:
- новый пользователь обязан сменить пароль;
- временный пароль перестаёт работать после смены;
- blocked user не входит;
- block revokes sessions и judge lock;
- reset revokes sessions;
- non-admin не открывает `/admin`;
- нельзя заблокировать/понизить последнего активного admin;
- email unique case-insensitively;
- открытый временный пароль нигде не сохраняется и повторно не читается;
- admin force-close active match проверяется отдельно (AT-ADM-MATCH-*);
- finished sporting result не hard-delete: только void + immutable audit + stats
  compensation (D19/D24); разрешены active admin или creator, reason optional,
  второго approver нет;
- participant/current judge без creator/admin роли не может cancel/void; UI
  confirmation не заменяет server-side authorization/version/idempotency checks.
