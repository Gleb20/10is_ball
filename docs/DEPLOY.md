# Free temporary hosting for Tab-10 (API + DB + Web)

Фактический снимок и известные риски: [operations/DEPLOYMENT_AS_BUILT.md](operations/DEPLOYMENT_AS_BUILT.md).

> **SEC-001 status:** credential БД, ранее попавший в tracked example, ротирован
> 2026-09-06; Render обновлён и работает с `SEED_ADMIN=0`. Значение здесь не
> приводится. Independent old-URI negative probe остаётся residual verification,
> поскольку connected Neon tool не принимает произвольный retained URI.

Цель: поднять **живой** сервис (логин, матчи, судья) на бесплатных тарифах для теста.

Рекомендуемая схема (cookies работают без танцев):

```
Browser ──► Vercel (apps/web) ──rewrite /api──► Render (apps/api) ──► Neon (Postgres)
```

Браузер ходит только на `*.vercel.app`; `/api/*` проксируется на backend через Vercel rewrite → сессионные cookies остаются same-site.

**Фактический Render URL (API):** `https://one0is-ball.onrender.com`
(служебно, не для runtime-кода: Service ID `srv-d9f3odn41pts73fvpktg`)

---

## Что сделать вам / что уже в репо

| Шаг | Кто |
|-----|-----|
| Аккаунты Neon, Render, Vercel + GitHub connect | **вы** |
| Вставить секреты (`DATABASE_URL`, пароли) в панели | **вы** |
| Код: migrate on boot, `render.yaml`, `apps/web/vercel.json`, этот гайд | **уже в репо** (после push) |

---

## 0. Подготовка репозитория

Для обычного production release сначала получите отдельное разрешение на deploy,
убедитесь, что `pnpm run ci` зелёный, и только затем обновляйте `main`.

Для CI-only проверки `codex/audit-foundation`:

1. Push выполняется только в одноимённую feature-ветку; production branch/tag не
   изменяются.
2. Сразу убедитесь, что Vercel и Render не создали deployment этого SHA.
3. Откройте draft PR с `[skip preview]` в **title**. Это отключает Render PR
   Preview даже при automatic preview policy; строка в commit message не заменяет
   title safeguard.
4. Дождитесь quality/PostgreSQL jobs; не merge и не promote этот snapshot.

Причина отдельной защиты Render: PR Preview может копировать environment base
service, включая DB connection. Vercel для этой ветки независимо отключён через
`git.deploymentEnabled` в `apps/web/vercel.json`.

---

## 1. База данных — Neon (бесплатно)

1. Зарегистрируйтесь: https://neon.tech
2. Create project → PostgreSQL.
3. Скопируйте **Connection string** (`postgresql://...`).
   - Prefer **pooled** connection для serverless/Render.
4. Сохраните строку — это `DATABASE_URL` (только в панели Render, не в Git).

Схема таблиц создаётся **при старте API** (`MIGRATE_ON_BOOT`, по умолчанию вкл.).

`applySchemaSql` делает не только `CREATE TABLE IF NOT EXISTS`, но и **`ALTER TABLE … ADD COLUMN IF NOT EXISTS`** для колонок, добавленных после первого деплоя (например `organizer_participates`, `tournament_participants.status`). Без этого Neon сохраняет старую форму таблиц → «на localhost всё ок, в проде турниры ломаются». После деплоя API смотрите в логе Render строку `Postgres schema ensured`.

---

## 2. Backend — Render (подробно)

Нужно заранее: аккаунт [Render](https://dashboard.render.com), GitHub с репо `10is_ball`, строка `DATABASE_URL` из Neon.

Текущий live API: **https://one0is-ball.onrender.com** (`/health` → JSON с `ok`).

### 2.1. Войти и GitHub

1. https://dashboard.render.com — войдите (лучше через GitHub).
2. Разрешите доступ к репозиторию **10is_ball**.

### 2.2. Создать Web Service

1. **New +** (справа сверху) → **Web Service**
   (не Static Site, не PostgreSQL — БД уже в Neon).
2. **Build and deploy from a Git repository** → **Next**.
3. Репозиторий **10is_ball** → **Connect**.
   Если нет в списке → Configure account / доступ к GitHub → обновить страницу.

### 2.3. Поля формы

| Поле | Значение |
|------|----------|
| **Name** | например `one0is-ball` (URL вида `https://….onrender.com`) |
| **Region** | **Frankfurt** (рядом с Neon eu-central-1) |
| **Root Directory** | **пусто** |
| **Runtime** | **Node** |
| **Build Command** | блок ниже целиком |
| **Start Command** | `pnpm --filter @tab10/api start` |
| **Instance Type** | **Free** |

**Build Command** (одна строка):

```bash
npm install -g pnpm@9.15.0 --prefix "$HOME/.local" && export PATH="$HOME/.local/bin:$PATH" && pnpm install --frozen-lockfile --prod=false --filter "@tab10/api..." && pnpm --filter @tab10/shared build && pnpm --filter @tab10/test-utils build && pnpm --filter @tab10/api build
```

> Не используйте `corepack prepare …` на Render: он пишет в `/usr/bin/pnpm` и падает с `EROFS: read-only file system`.
>
> `--frozen-lockfile --prod=false` — фиксирует lockfile и ставит devDependencies (нужны для `tsc`).
>
> `--filter "@tab10/api..."` ставит только API и его зависимости (без `apps/web` / сборки git-`ic-kit`).
>
> UI-kit лежит в `packages/ic-kit` (vendored dist), чтобы Vercel/CI не гоняли `prepare` из GitHub.

**Start Command:**

```bash
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @tab10/api start
```

### 2.4. Environment Variables (до Create)

На этой же странице или после создания → **Environment** → **Add**:

| Key | Value |
|-----|--------|
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `NODE_VERSION` | `24.20.0` (должно совпадать с `.node-version`) |
| `DATABASE_URL` | строка Neon из панели (не коммитьте) |
| `SEED_ADMIN` | `0` для обычного запуска |
| `SEED_ADMIN_EMAIL` | не задавать, кроме одноразового bootstrap |
| `SEED_ADMIN_PASSWORD` | не задавать, кроме одноразового bootstrap |

Пока **не** ставьте `WEB_ORIGIN` / `COOKIE_SAME_SITE` (нужны только при прямом вызове API без Vercel rewrite).

`DATABASE_URL` — без кавычек и пробелов по краям.

Для первого bootstrap администратора временно поставьте `SEED_ADMIN=1` и задайте
явные уникальные `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`, соответствующие password
policy. После успешного создания сразу верните `SEED_ADMIN=0` и redeploy. API
должен отказать в старте при `SEED_ADMIN=1` без валидных явных значений; пароль
уже существующего active admin автоматически не ротируется. Конкурентные старты
атомарно различают созданный и существующий аккаунт; успешное создание оставляет
`admin.bootstrap_provisioned` audit entry с system actor. После проверки удалите
bootstrap email/password из Render environment, а не только верните flag в `0`.

### 2.5. Deploy

1. **Create Web Service**.
2. Ждите лог 3–10 мин → статус **Live**.
3. Если **Failed** — скопируйте хвост лога (последние ~30 строк).

### 2.6. Проверка

1. URL сервиса: `https://one0is-ball.onrender.com` (или ваш).
2. Откройте `https://one0is-ball.onrender.com/health` → JSON с `ok`.
3. Первый запрос на Free может идти до 60 секунд (cold start). Это допустимо
   только при явном UI-состоянии «сервис просыпается/загрузка», bounded timeout и
   Retry. После wake-up применяются обычные SLO (ADR D21).

### 2.7. Опционально: Blueprint

**New +** → **Blueprint** → репо с `render.yaml` → Apply → в Environment вручную задайте `DATABASE_URL` и пароль админа → Manual Deploy.

> Render крутит **только API**, не сайт. Сайт — на Vercel (раздел 3). Service ID Render приложением не используется.

---

## 3. Frontend — Vercel

1. https://vercel.com → Add New Project → Import репозиторий **10is_ball** (`main`).
2. **Обязательные настройки в Dashboard** (даже если часть уже в `vercel.json`):

| Field | Value |
|-------|--------|
| Framework Preset | **Vite** |
| Root Directory | **`apps/web`** |
| Node.js Version | **`24.x`** |
| Install / Build / Output | берутся из [`apps/web/vercel.json`](../apps/web/vercel.json) |

В `vercel.json` уже заданы:

- `installCommand` — pnpm 9.15.0 из корня monorepo, `--frozen-lockfile --prod=false --filter "@tab10/web..."`
- `buildCommand` — последовательная сборка `@tab10/shared` и `@tab10/web`
- `outputDirectory` — `dist`
- `git.deploymentEnabled` — branch-specific запрет preview для
  `codex/audit-foundation`, чтобы audit-foundation push/PR не публиковал этот
  snapshot; изменение относится только к этой ветке и не отключает production
  deploy из `main`
- rewrites: `/api/*` и `/health` → `https://one0is-ball.onrender.com`, затем SPA fallback на `/index.html`

3. **Environment Variables (Production):**

| Key | Value |
|-----|--------|
| `VITE_API_BASE_URL` | **не задавать** |

Frontend вызывает относительные пути `/api/...`; проксирование на Render делает Vercel rewrite. URL Render в TypeScript и в `.env` на Vercel не прописывается.

4. Deploy. Откройте `https://ВАШ.vercel.app`.

5. С rewrite (без `VITE_API_BASE_URL`):

   - на Render можно не задавать `WEB_ORIGIN`;
   - cookies `SameSite=Lax` ок.

6. Кросс-домен (не рекомендуется): только если фронт ходит на API напрямую — тогда `VITE_API_BASE_URL`, `WEB_ORIGIN`, `COOKIE_SAME_SITE=none`. Для текущего деплоя это не нужно.

> Если Vercel ошибочно собирает `@tab10/api` (`tsc` из `apps/api`) — Root Directory не `apps/web`. Исправьте Root на `apps/web` и redeploy.

---

## 4. Проверка end-to-end

1. Откройте Vercel URL.
2. Войдите: email/пароль админа из `SEED_ADMIN_*` на Render.
3. Создайте матч → судейство → очко.
4. Если 401 после логина:
   - проверьте, что rewrite в `vercel.json` указывает на `https://one0is-ball.onrender.com`;
   - убедитесь, что `VITE_API_BASE_URL` на Vercel **не** задан;
   - Hard refresh / другое окно.

---

## 5. Типичные ошибки

| Симптом | Причина | Что делать |
|---------|---------|------------|
| Vercel build падает на `apps/api` / `tsc` | Root не `apps/web` или билдится весь monorepo | Root Directory = `apps/web`; Node `24.x` |
| `/health` 502 на Render | нет `DATABASE_URL` / падение migrate | логи Render; проверьте Neon URL в панели |
| Логин ок, сразу 401 | cookies не доходят | rewrite `/api` → Render; не задавать `VITE_API_BASE_URL` |
| Долгий первый ответ | Render sleep или outage | UI показывает bounded wake-up и Retry; проверить `/health`, после wake не маскировать проблему cold-start допуском |
| CORS error в консоли | прямой вызов API без `WEB_ORIGIN` | оставить rewrite (относительные `/api`) |

---

## Альтернативы (кратко)

| Стек | Комментарий |
|------|-------------|
| Railway.app | API + Postgres в одном месте, удобно; лимиты trial |
| Fly.io | API; Postgres отдельно |
| GitHub Pages | **только** статика web, **без** API — для полного теста не подходит |
| Всё на одном Render (static + API) | можно позже; сложнее build |

---

## Локальная проверка «как в проде»

```bash
# Терминал 1 — API с Neon URL
export DATABASE_URL='postgresql://...'   # только локально, не в Git
export NODE_ENV=production
export WEB_ORIGIN=http://localhost:4173
pnpm --filter @tab10/api start

# Терминал 2 — preview web (локально можно указать API напрямую)
export VITE_API_BASE_URL=http://localhost:3001
pnpm --filter @tab10/web build
pnpm --filter @tab10/web preview
```

---

## Чеклист «готово»

- [ ] Neon `DATABASE_URL` задан в Render (не в Git)
- [ ] Render API Live: `https://one0is-ball.onrender.com/health` ok
- [ ] Vercel: Root = `apps/web`, Node.js = `24.x`
- [ ] Vercel: `VITE_API_BASE_URL` не задан; rewrite `/api/*` → Render
- [ ] Логин админа работает
- [x] DB role credential ротирован; Render обновлён; old-URI negative probe отмечен как tool-limited residual (SEC-001)
- [ ] Bootstrap выполнен только с явными secrets; после него `SEED_ADMIN=0`
- [ ] Deploy связан с commit SHA/version и smoke evidence записан в changelog

После выполнения шагов 1–3 пришлите URL Vercel — можно разобрать логи, если что-то не взлетит.
