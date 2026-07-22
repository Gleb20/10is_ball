# Changelog — Tab-10

Формат версий: [docs/VERSIONING.md](docs/VERSIONING.md).

## [1.10.1] — 2026-07-22

### Fixed (c — Neon/prod tournament parity)

- Boot migrate: `ALTER … ADD COLUMN IF NOT EXISTS` для `organizer_participates`, `tournament_participants.status`, mercy/stop/slot и др. (CREATE IF NOT EXISTS не обновлял существующий Neon)
- Create tournament: откат строки турнира, если insert участника-организатора упал
- `POST /tournaments/:id/cancel` — отмена до старта; кнопка «Отменить турнир»
- Выход: только для активного участника; `NOT_A_PARTICIPANT` вместо «Не найдено»
- PATCH `organizerParticipates` синхронизирует roster; статус `cancelled` в UI

### Fixed (c — prod hotfix: матчи на Neon/Postgres)

- API: сравнения дат в judge/rankings через `gt`/`lte`/`gte` вместо raw `sql`+`Date` (drizzle + postgres-js)
- Создание и просмотр матча снова работают в продакшене; week/month rankings не падают
- Обработка ошибок на `POST/GET /matches`; `INTERNAL` без сырого stack клиенту

## [1.10.0] — 2026-07-21

### Changed (b — roster, notifications, compact SE bye)

- Состав: очистка поля после add/invite; pending «ожидает ответ» / declined «отказался» + удаление
- Directory скрывает load-test users (`load*@tab10.local` → «User Load»)
- Профиль: счётчик актуальных уведомлений
- Уведомления: lifecycle Принято/Отклонено; фильтр «Актуальные» (по умолчанию вкл.)
- SE: компактный bye при нечётном N (N=5 → 1 bye); DE по-прежнему Challonge Po2

## [1.9.2] — 2026-07-21

### Fixed (c — bracket connectors)

- Коннектор только от победителя: SVG-кривая в карточку следующего матча
- Проигравший: ↓ (в LB / 3-е) или ✕ (окончательный вылет); без ложных линий

## [1.9.1] — 2026-07-21

### Fixed (c — bracket UX)

- Challonge seed placement: bye у топ-сидов (N=6 → #1,#2), mid-seeds играют
- Коннекторы победитель/проигравший; loser dim; выравнивание колонок
- «Текущие матчи»: Имя vs Имя, без ложного 0:0 в waiting
- Ростер участников скрыт после закрытия состава (виден в сетке)

## [1.9.0] — 2026-07-21

### Changed (b — Challonge-like SE/DE + avatars)

- DE: Challonge WB/LB topology + Grand Final **bracket reset**
- Сетка: полосы Победители / Проигравшие / Гранд-финал, labels 1/8…Финал, seed, winner highlight, автопроход BYE с именем
- 10 мемных аватаров (`avatar_1`…`10`); assign на user/guest; показ в профиле, рейтинге, матче, судье, сетке

## [1.8.0] — 2026-07-21

### Changed (b — tournament playable UX)

- Участники: Autocomplete по ФИО, автодобавление организатора, roster с displayName
- Ошибки действий inline (без тупика AsyncState); `INVALID_STATUS` в messageFor
- CSS-сетка: имена, счёт, «Судить» / «Открыть»; навигация матч ↔ турнир
- Finished judge → readonly без acquire; после finish → турнир при `tournamentId`

## [1.7.0] — 2026-07-21

### Added (b — working tournaments)

- Полный lifecycle турнира: PATCH, invites (TTL 10м), dissolve, withdraw, edit bracket
- Start материализует матчи из сетки (`tournamentId` + slot); advancement после finish/stop
- SE third-place slots; DE losers/final + start
- Stop турнира (unplayed → cancelled); уведомления invite / match ready / finished
- Web: старт/стоп, матчи, приглашения в Notifications

## [1.6.3] — 2026-07-21

### Fixed (c — judge setup + mercy)

- Setup: стрелка ↔ снова между плашками счёта
- Сухая победа по текущему счёту (≥N:0); Undo случайного очка не блокирует 5:0

## [1.6.2] — 2026-07-21

### Changed (c — mercy + setup board)

- Сухая победа только при сопернике 0 (ADR D8); 5:1 не завершает
- Judge setup = board; дефолт создания матча «Игрок»; бейдж подачи с ракеткой

## [1.6.1] — 2026-07-21

### Fixed (c — judge polish)

- Undo ровно −1 очко; любой active user может судить; таймер после setup; ↔ / +1 в ячейках

## [1.6.0] — 2026-07-21

### Added (b — Judge UX)

- Pre-game setup (первый подающий, стороны, flip); mercy в создании матча; live-таймер; кнопки +1
- `activeJudge` в GET match; fix зависания «Подключение судьи»

## [1.5.0] — 2026-07-21

### Fixed (b — P0+P1 bugfix)

- Atomic score version, idempotency, CSRF, judge/stop authz, rankings, UX dead-ends

## [1.4.0] — 2026-07-20

### Added (b — admin roles)

- Создание пользователя с выбором роли `user` / `admin`
- Смена роли существующего пользователя (promote / demote) с confirm-диалогом
- `PATCH /api/v1/admin/users/:userId` — только `role`; нельзя менять свою роль; revoke сессий цели
- Защита последнего активного admin (AT-AUTH-008)

## [1.3.2] — 2026-07-20

### Changed (c — a11y / visual QA)

- Skip-link «К содержимому», `:focus-visible`, reduced-motion
- Touch floors на bottom nav; overflow-x clip
- `docs/A11Y_CHECKLIST.md` + `a11y.smoke.test.tsx` (360px, AT-EMPTY-001)

## [1.3.1] — 2026-07-20

### Changed (c — auth/admin polish)

- AuthLayout для login / first-password (бренд Tab-10)
- Временный пароль: Dialog + CTA «Скопировать»
- Admin: confirm Dialog для блок/сброс пароля

## [1.3.0] — 2026-07-20

### Changed (b — judge UI)

- Judge immersive full-bleed (без bottom nav, тёмный shell)
- Подсказка landscape на портретном телефоне
- Индикатор подачи на стороне текущего сервера
- Touch targets ≥ 44px; Undo / Ещё / release; heartbeat 30s
- Landscape CSS: крупные зоны счёта на низком viewport

## [1.2.0] — 2026-07-20

### Changed (b — key screens)

- Home: hero с моей статистикой, лидер, топ-3, индикатор уведомлений
- `/matches/new`: выбор Гость / Игрок + Autocomplete соперника
- `GET /api/v1/users/directory` — directory для picker’ов
- Rankings: пьедестал топ-3 + CTA «Вызов»
- Profile: avatar, chip роли, разделы через ListRow

## [1.1.1] — 2026-07-20

### Changed (c — UX patterns)

- `ListRow`, `StatusChip`, `AsyncState`, `FilterBar` — единые паттерны списков и состояний
- Статусы матчей/турниров/пользователей на русском (Chip)
- Применено на Home, History, Matches, Rankings, Tournaments, Admin, Teams, Help, Profile, Match/Tournament detail

## [1.1.0] — 2026-07-20

### Changed (b — shell IA)

- Bottom nav по ADR D5: Главная · История · «Начать» · Рейтинг · Профиль
- Hub `/start`, лента `/history`, создание матча `/matches/new`
- Админка только из профиля; judge без bottom nav
- PageLayout, ic-kit EmptyState/Skeleton/ButtonGroup, safe-area

## [1.0.0] — 2026-07-20

### Added (a — новые флоу)

- Monorepo `apps/api` + `apps/web` + `packages/shared` + `packages/test-utils`
- Локальный вход, смена временного пароля, сессии
- Админка пользователей (создание, блокировка, сброс пароля)
- Матчи 1v1 с гостями, судейство, Undo, подтверждение результата
- Турниры: сбор участников, генерация single/double elimination сетки
- Команды и приглашения (14 дней TTL)
- Рейтинг, главная, уведомления, FAQ, feedback
- Онбординг с учебным матчем «Призрачный Олег»
- UI на ic-kit (бренд `ic`, mobile-first)

### Infrastructure

- CI GitHub Actions, docker-compose PostgreSQL, PGlite для integration-тестов
- Документация требований в `docs/requirements/`
- TDD: Vitest unit + integration
