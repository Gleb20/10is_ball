# Tab-10: единый local → public-stand контур

Текущий публичный контур — испытательный стенд без ценных данных, а не будущий
боевой production. До переезда на оплачиваемый VPS для него сознательно выбран
простой delivery-процесс: обязательная проверка полностью воспроизводится
локально и в GitHub, а merge в `main` автоматически публикуется штатными
Git-интеграциями Render и Vercel.

## Закреплённый стек

- Node `24.20.0`;
- pnpm `9.15.0` и один корневой `pnpm-lock.yaml`;
- PostgreSQL `16.15-alpine` по закреплённому digest;
- Playwright `1.63.0` и управляемый им Chromium;
- product version берётся только из корневого `package.json`.

`pnpm dev` поднимает локальный PostgreSQL 16 и запускает API/web через тот же
same-origin proxy, который используется на публичном стенде. PGlite доступен
только как явно упрощённый `pnpm dev:pglite`.

## Публичные команды

| Команда | Что проверяет |
|---|---|
| `pnpm doctor` | точные версии Node, pnpm, Docker, Compose и Chromium |
| `pnpm verify:fast` | audit, lint, typecheck, unit/component/PGlite и production build |
| `pnpm verify:postgres` | PostgreSQL migrations, constraints и concurrency |
| `pnpm verify:e2e` | compiled API/web, PostgreSQL 16, same-origin proxy и Chromium |
| `pnpm verify:all` | весь барьер в disposable PostgreSQL с обязательным cleanup |
| `pnpm ci` | точный alias `verify:all` |
| `pnpm db:migrate -- --mode=apply` | применить immutable migrations |

Fresh checkout не требует `.env` или provider credentials для `pnpm ci`.
Каждый исполняемый suite обязан завершиться с `0 failed`, `0 skipped`, `0 todo`
и не оставить контейнеры, volumes или процессы.

## Release metadata

API публикует `release` в `/health` и `/ready`, web — `/release.json`:

```ts
{
  sha: string;
  version: string;
  environment: "local" | "test" | "staging" | "production";
  dirty: boolean;
}
```

На публичном стенде SHA всегда полный, `dirty=false`, а version совпадает с
корневым `package.json`. Render передаёт `RENDER_GIT_COMMIT`, Vercel —
`VERCEL_GIT_COMMIT_SHA`; дополнительные release secrets не нужны.

## CI и публикация

```text
pull request
  └─ quality + postgres-integration + browser-prodlike
       └─ Release gate
            └─ merge в main
                 ├─ Render: native deploy commit
                 │    └─ db:migrate --mode=apply → compiled API
                 ├─ Vercel: production deploy main → compiled web
                 └─ ручной GitHub Release smoke после deploy
                      └─ ждёт одинаковый SHA/version у web и API
```

`main` защищается обязательным `Release gate`, запретом direct/force push и
удаления ветки. Render использует `autoDeployTrigger: commit`; Vercel публикует
production branch `main`. После завершения обоих native deploy пользователь
запускает workflow `Release` на `main`. Он ничего не меняет у провайдеров и не
хранит их токены: только ждёт `/health`, `/ready`, `/release.json` и OpenAPI для
точного SHA. Повторный CI merge SHA наблюдаем, но не задерживает этот disposable
deploy; основной предохранитель — обязательный PR gate.

Vercel проксирует `/api/*`, `/health` и `/ready` в Render до SPA fallback.
Изменяющие E2E выполняются только на disposable локальной/CI базе. Проверка
публичного стенда состоит только из read-only GET-запросов.

## База публичного стенда

`DATABASE_URL` — pooled URL `neondb_owner`; `MIGRATION_DATABASE_URL` — direct URL
той же роли. Render startup передаёт миграции exact `RENDER_GIT_COMMIT` и
закреплённые Neon target IDs. Повышенные runtime-права приняты только для этого
disposable stand; local/CI продолжают проверять разделённые роли.

Пользователь отдельно разрешил одноразово удалить старую тестовую схему. Для
первого выпуска OPS-004 `public` и `drizzle` пересоздаются на точном Neon target,
после чего выполняется обычный `--mode=apply`. Дальнейшие deploy не сбрасывают
данные и только применяют новые immutable migrations. Автоматических down-
migrations и restore нет; при неудаче исправление делается новым commit в
`main` или ручным возвратом предыдущего application deploy.

## Что намеренно отложено до VPS

- отдельный synthetic staging;
- rehearsal/recovery branches и автоматизированный writer drain;
- гарантированные backups/PITR, zero-downtime schema rollout и automated
  rollback;
- production mutating E2E.
- отдельная ограниченная runtime DB role.

Перед появлением реальных ценных данных этот документ должен быть дополнен
production runbook с backup/restore rehearsal, staging и контролируемой
migration topology.
