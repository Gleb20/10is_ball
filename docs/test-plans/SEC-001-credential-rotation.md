# SEC-001 — ротация production DB credential

Статус: `in_progress`
Дата начала: `2026-09-06`
Scope: `SEC-001`, `SEC-004`, `Q-OPS-001`

## Цель

Отозвать ранее раскрытый пароль PostgreSQL-роли `neondb_owner` в Neon, перевести
Render service `10is_ball` на новый `DATABASE_URL`, прекратить все активные
admin-сессии приложения и доказать, что старый пароль больше не работает. Значения
секретов не записываются в репозиторий, evidence, логи или сообщения.

## Разрешение и ограничения

- Пользователь 2026-09-06 явно разрешил ротацию Neon credential, обновление Render
  и отзыв небезопасных admin-сессий.
- Пользователь подтвердил, что текущие production-данные не представляют ценности,
  но это **не** считается разрешением на reset/recreate БД. В этом плане схема и
  данные не удаляются.
- Push feature-ветки не должен запускать Vercel/Render deploy. Production deploy
  foundation-кода и merge в `main` не входят в этот план.
- Draft PR открывается с `[skip preview]` в title, чтобы Render не создавал PR
  Preview и не копировал production environment; после push проверяется
  отсутствие обоих deployment events для SHA.
- Финальную кнопку сброса пароля Neon нажимает владелец аккаунта; секрет между
  Neon и Render передаётся только в памяти текущей защищённой browser-сессии.

## Предварительная проверка

1. Подтвердить проект Neon `Tab-10`, branch `production`, database `neondb`, role
   `neondb_owner`.
2. Подтвердить Render service `10is_ball`, service id
   `srv-d9f3odn41pts73fvpktg`, deploy branch `main` и наличие `DATABASE_URL`, не
   раскрывая его значение.
3. Зафиксировать текущий deployed SHA и read-only HTTP health.
4. Подготовить branch-specific `git.deploymentEnabled=false` для
   `codex/audit-foundation` до первого push.

## Выполнение

1. В памяти сохранить старый Render `DATABASE_URL` только для отрицательной
   проверки; не писать его в файл или вывод.
2. Владелец нажимает `Reset` для `neondb_owner` в Neon.
3. Получить новый pooled connection string без вывода значения, заменить
   `DATABASE_URL` в Render и явно выставить `SEED_ADMIN=0` в live dashboard.
   Сохранение env может перезапустить сервис; дождаться terminal deploy state.
4. Через Neon SQL editor одной транзакцией пометить все незавершённые admin auth
   sessions как revoked с reason `credential_rotation`; данные сессий не удалять.
5. Не читать и не перезаписывать stored `SEED_ADMIN_EMAIL/PASSWORD`, пользователей,
   матчи, турниры или статистику. Удаление ненужных bootstrap secrets и deploy
   fail-closed bootstrap-кода остаются отдельной частью SEC-004; до неё
   `SEED_ADMIN=0` блокирует automatic seed в текущем production runtime.

## Проверка

1. Старый URL: одноразовый `SELECT 1` обязан завершиться authentication failure;
   выводить только boolean/result code, не URL и не текст с connection details.
2. Новый Render deploy: terminal `Live`, startup log подтверждает DB/schema init
   без connection string.
3. Render dashboard после сохранения показывает `SEED_ADMIN=0`; значения
   `SEED_ADMIN_EMAIL/PASSWORD` не раскрывались.
4. Read-only `GET /health` через direct Render и Vercel proxy отвечает 200 после
   допустимого cold start.
5. SQL verification подтверждает `0` active admin sessions и показывает только
   количество обновлённых строк.
6. Blocking repo secret scan: `0` candidates и `0` skipped inputs.

## Evidence и rollback

В `docs/CHANGELOG_DEV.md`, `docs/PROJECT_STATUS.md`, `docs/BACKLOG.md` и
`docs/operations/DEPLOYMENT_AS_BUILT.md` записываются только время, project/service
IDs, old-credential result, deploy id/SHA, HTTP statuses и количество отозванных
сессий. Новый или старый секрет не сохраняется.

Если Render не стартует с новым URL, сначала сверить выбранные branch/database/role
и значение env в UI. Старый пароль после reset не восстанавливается; повторная
ротация допустима только как отдельный зафиксированный incident step. БД не
удалять и не пересоздавать как способ rollback.
