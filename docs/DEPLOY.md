# Free temporary hosting for Tab-10 (API + DB + Web)

Цель: поднять **живой** сервис (логин, матчи, судья) на бесплатных тарифах для теста.

Рекомендуемая схема (cookies работают без танцев):

```
Browser ──► Vercel (apps/web) ──rewrite /api──► Render (apps/api) ──► Neon (Postgres)
```

Браузер ходит только на `*.vercel.app`; `/api` проксируется на backend → сессионные cookies остаются same-site.

---

## Что сделать вам / что уже в репо

| Шаг | Кто |
|-----|-----|
| Аккаунты Neon, Render, Vercel + GitHub connect | **вы** |
| Вставить URL/секреты в панели | **вы** |
| Код: CORS, migrate on boot, `VITE_API_BASE_URL`, `render.yaml`, `vercel.json`, этот гайд | **уже в репо** (после push) |

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
4. Сохраните строку — это `DATABASE_URL`.

Схема таблиц создаётся **при старте API** (`MIGRATE_ON_BOOT`, по умолчанию вкл.).

---

## 2. Backend — Render (подробно)

Нужно заранее: аккаунт [Render](https://dashboard.render.com), GitHub с репо `10is_ball`, строка `DATABASE_URL` из Neon.

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
| **Name** | `tab10-api` (URL станет `https://tab10-api.onrender.com`) |
| **Region** | **Frankfurt** (рядом с Neon eu-central-1) |
| **Root Directory** | **пусто** |
| **Runtime** | **Node** |
| **Build Command** | блок ниже целиком |
| **Start Command** | `pnpm --filter @tab10/api start` |
| **Instance Type** | **Free** |

**Build Command** (одна строка):

```bash
npm install -g pnpm@9.15.0 --prefix "$HOME/.local" && export PATH="$HOME/.local/bin:$PATH" && pnpm install --filter "@tab10/api..." && pnpm --filter @tab10/shared build && pnpm --filter @tab10/test-utils build && pnpm --filter @tab10/api build
```

> Не используйте `corepack prepare …` на Render: он пишет в `/usr/bin/pnpm` и падает с `EROFS: read-only file system`.
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
| `DATABASE_URL` | вся строка Neon `postgresql://…?sslmode=require` |
| `SEED_ADMIN` | `1` |
| `SEED_ADMIN_EMAIL` | `admin@tab10.local` (или ваш) |
| `SEED_ADMIN_PASSWORD` | свой надёжный пароль |

Пока **не** ставьте `WEB_ORIGIN` / `COOKIE_SAME_SITE` (нужны только при прямом вызове API без Vercel rewrite).

`DATABASE_URL` — без кавычек и пробелов по краям.

### 2.5. Deploy

1. **Create Web Service**.
2. Ждите лог 3–10 мин → статус **Live**.
3. Если **Failed** — скопируйте хвост лога (последние ~30 строк).

### 2.6. Проверка

1. URL сервиса: `https://tab10-api.onrender.com` (или как назвали).
2. Откройте `https://…onrender.com/health` → JSON с `ok`.
3. Первый запрос на Free может идти до ~1 минуты (cold start).

Сохраните этот URL — он понадобится для Vercel.

### 2.7. Опционально: Blueprint

**New +** → **Blueprint** → репо с `render.yaml` → Apply → в Environment вручную задайте `DATABASE_URL` и пароль админа → Manual Deploy.

> Render крутит **только API**, не сайт. Сайт — на Vercel (раздел 3).

---

## 3. Frontend — Vercel

1. https://vercel.com → Add New Project → Import тот же GitHub repo.  
2. Settings:

| Field | Value |
|-------|--------|
| Framework Preset | Vite |
| Root Directory | `apps/web` |
| Build Command | `cd ../.. && pnpm install && pnpm --filter @tab10/web build` |
| Output Directory | `dist` |
| Install Command | `cd ../.. && pnpm install` *(или оставить default, если Root=apps/web ломает workspace — лучше install из корня как выше)* |

Проще: в проекте уже есть [`apps/web/vercel.json`](../apps/web/vercel.json) — после импорта укажите Root = `apps/web`.

3. **Environment Variables** (Production):

| Key | Value | Когда |
|-----|--------|--------|
| *(пусто)* `VITE_API_BASE_URL` | — | **Рекомендуется** с rewrite (п.4) |
| `VITE_API_BASE_URL` | `https://tab10-api.onrender.com` | Только если **без** rewrite (кросс-домен) |

4. **Rewrites (рекомендуется)** — скопируйте [`apps/web/vercel.rewrites.example.json`](../apps/web/vercel.rewrites.example.json) → `apps/web/vercel.json`, подставьте URL Render, закоммитьте и задеплойте.  
   Либо Rewrites в Vercel Dashboard:

   - `/api/:path*` → `https://ВАШ-API.onrender.com/api/:path*`  
   - `/health` → `https://ВАШ-API.onrender.com/health`

5. Deploy. Откройте `https://ВАШ.vercel.app`.

6. Если используете **только rewrite** (без `VITE_API_BASE_URL`):  
   - на Render можно не задавать `WEB_ORIGIN`;  
   - cookies `SameSite=Lax` ок.

7. Если фронт ходит на API **напрямую** (`VITE_API_BASE_URL=https://...onrender.com`):  
   - на Render: `WEB_ORIGIN=https://ВАШ.vercel.app`  
   - на Render: `COOKIE_SAME_SITE=none`  
   - пересоберите web с этой env.

---

## 4. Проверка end-to-end

1. Откройте Vercel URL.  
2. Войдите: email/пароль админа (те, что в `SEED_ADMIN_*`, иначе `admin@tab10.local` / `AdminPass1!`).  
3. Создайте матч → судейство → очко.  
4. Если 401 после логина:  
   - проверьте rewrite / `VITE_API_BASE_URL`;  
   - для кросс-домена — `COOKIE_SAME_SITE=none` + `WEB_ORIGIN`;  
   - Hard refresh / другое окно без блокировки third-party cookies.

---

## 5. Типичные ошибки

| Симптом | Причина | Что делать |
|---------|---------|------------|
| Vercel build падает на `apps/api` TS | билдите весь monorepo | Root = `apps/web`, build только web |
| `/health` 502 на Render | нет `DATABASE_URL` / падение migrate | логи Render; проверьте Neon URL |
| Логин ок, сразу 401 | cookies не доходят | включите Vercel rewrite **или** `COOKIE_SAME_SITE=none` |
| Долгий первый ответ | Render sleep | подождать / открыть `/health` на API |
| CORS error в консоли | прямой вызов API без `WEB_ORIGIN` | задать `WEB_ORIGIN` или перейти на rewrite |

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
export DATABASE_URL='postgresql://...'
export NODE_ENV=production
export WEB_ORIGIN=http://localhost:4173
pnpm --filter @tab10/api start

# Терминал 2 — preview web
export VITE_API_BASE_URL=http://localhost:3001
pnpm --filter @tab10/web build
pnpm --filter @tab10/web preview
```

---

## Чеклист «готово»

- [ ] Neon `DATABASE_URL`  
- [ ] Render API Live, `/health` ok  
- [ ] Vercel web Live  
- [ ] Rewrite `/api` → Render **или** `VITE_API_BASE_URL` + `COOKIE_SAME_SITE=none`  
- [ ] Логин админа работает  
- [ ] Смена `SEED_ADMIN_PASSWORD` / `SEED_ADMIN=0` после первого деплоя  

После выполнения шагов 1–3 пришлите URL Vercel и Render — можно разобрать логи, если что-то не взлетит.
