# Free temporary hosting for Tab-10 (API + DB + Web)

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

1. Запушьте `main` на GitHub (включая фиксы деплоя).
2. Убедитесь, что локально: `pnpm run ci` зелёный.

---

## 1. База данных — Neon (бесплатно)

1. Зарегистрируйтесь: https://neon.tech
2. Create project → PostgreSQL.
3. Скопируйте **Connection string** (`postgresql://...`).
   - Prefer **pooled** connection для serverless/Render.
4. Сохраните строку — это `DATABASE_URL` (только в панели Render, не в Git).

Схема таблиц создаётся **при старте API** (`MIGRATE_ON_BOOT`, по умолчанию вкл.).

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
| `NODE_VERSION` | `20` (важно: не Node 26) |
| `DATABASE_URL` | строка Neon из панели (не коммитьте) |
| `SEED_ADMIN` | `1` |
| `SEED_ADMIN_EMAIL` | ваш email админа |
| `SEED_ADMIN_PASSWORD` | свой надёжный пароль (только в панели) |

Пока **не** ставьте `WEB_ORIGIN` / `COOKIE_SAME_SITE` (нужны только при прямом вызове API без Vercel rewrite).

`DATABASE_URL` — без кавычек и пробелов по краям.

### 2.5. Deploy

1. **Create Web Service**.
2. Ждите лог 3–10 мин → статус **Live**.
3. Если **Failed** — скопируйте хвост лога (последние ~30 строк).

### 2.6. Проверка

1. URL сервиса: `https://one0is-ball.onrender.com` (или ваш).
2. Откройте `https://one0is-ball.onrender.com/health` → JSON с `ok`.
3. Первый запрос на Free может идти до ~1 минуты (cold start).

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
| Node.js Version | **`20.x`** |
| Install / Build / Output | берутся из [`apps/web/vercel.json`](../apps/web/vercel.json) |

В `vercel.json` уже заданы:

- `installCommand` — pnpm 9.15.0 из корня monorepo, `--frozen-lockfile --prod=false --filter "@tab10/web..."`
- `buildCommand` — `pnpm --filter @tab10/web build`
- `outputDirectory` — `dist`
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
| Vercel build падает на `apps/api` / `tsc` | Root не `apps/web` или билдится весь monorepo | Root Directory = `apps/web`; Node `20.x` |
| `/health` 502 на Render | нет `DATABASE_URL` / падение migrate | логи Render; проверьте Neon URL в панели |
| Логин ок, сразу 401 | cookies не доходят | rewrite `/api` → Render; не задавать `VITE_API_BASE_URL` |
| Долгий первый ответ | Render sleep | подождать / открыть `/health` на API |
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
- [ ] Vercel: Root = `apps/web`, Node.js = `20.x`
- [ ] Vercel: `VITE_API_BASE_URL` не задан; rewrite `/api/*` → Render
- [ ] Логин админа работает
- [ ] После первого деплоя: сменить пароль админа / `SEED_ADMIN=0` при необходимости

После выполнения шагов 1–3 пришлите URL Vercel — можно разобрать логи, если что-то не взлетит.
