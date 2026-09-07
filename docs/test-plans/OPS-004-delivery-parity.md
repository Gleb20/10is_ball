# OPS-004 — local/CI/public-stand delivery test plan

Scope: D31 and `AT-OPS-DELIVERY-001..009`. Текущий public stand disposable и
может быть один раз пересоздан с нуля; product/story migrations `0001–0003`
остаются отдельной последующей волной и не блокируют delivery foundation.

## Local and pull-request gate

1. В fresh checkout без `.env` выполнить frozen install, `pnpm doctor` и
   `pnpm ci`.
2. Подтвердить точные Node `24.20.0`, pnpm `9.15.0`, PostgreSQL `16.15`,
   Playwright/Chromium versions и lock hash.
3. Подтвердить `0 failed`, `0 skipped`, `0 todo`, `0 interrupted` во всех
   выполненных suites и отсутствие оставшихся container/volume/process resources.
4. PostgreSQL tests покрывают fresh schema, повторный no-op, catalog drift,
   failure rollback, concurrent migrators и startup prefix policy.
5. Browser lane запускает production builds с relative API URL, same-origin
   proxy, `workers=1`, `retries=0`, `forbidOnly=true`, desktop `1280×800` и
   mobile `390×844`.
6. Искусственный failure каждой из трёх lanes отдельно делает `Release gate`
   красным; skipped/neutral не принимаются.

## One-time public bootstrap

1. Сверить точные Neon project/branch/database перед destructive operation.
2. В одной transaction удалить `drizzle` и `public`, затем создать обе пустые
   schema владельцем `neondb_owner`; не удалять project, branch, database, role
   или endpoint.
3. После merge Render startup выполняет `pnpm db:migrate -- --mode=apply` для
   exact `RENDER_GIT_COMMIT`.
4. Если миграция или API startup не прошли, стенд может оставаться временно
   недоступным; исправление идёт новым commit. Ценных данных на target нет.

## Automatic merge release

1. PR проходит `quality`, `postgres-integration`, `browser-prodlike` и агрегатор
   `Release gate`.
2. Пользователь merge-ит PR в защищённый `main`.
3. Render и Vercel native Git integrations публикуют commit из `main`; Render
   перед API start применяет migrations.
4. После deploy вручную запущенный `Release` ждёт не более 25 минут и read-only проверяет прямые и
   proxied `/health`, `/ready`, `/release.json`, OpenAPI и точное равенство
   SHA/version web/API ожидаемому merge commit.
5. Redacted release artifact содержит только ожидаемый SHA/version, число
   попыток и имена checks; CI test counts остаются в отдельных CI artifacts.

OPS-004 переходит в `verified_prod` после одного успешного native-Git выпуска и
ручного exact-SHA smoke на public stand. Production-grade staging/recovery/backup требования
возвращаются отдельным work item перед миграцией на оплачиваемый VPS.
