# Открытые вопросы продукта и эксплуатации

Активная часть содержит только вопросы, ответ на которые нельзя достоверно
получить из текущего репозитория. Реализация, зависящая от ответа, должна ссылаться
на ID вопроса. Закрытые ID сохраняются в конце для traceability и ссылаются на ADR
либо операционное evidence.

## Q-OPS-003 — Данные и восстановление

Текущий production объявлен не содержащим ценных данных, требующих сохранения V1
DE (D25). Для будущих данных остаётся решить: когда они становятся ценными, какой
допустим RPO/RTO, где хранится backup и как подтверждается restore. Бесплатная
схема сейчас не доказывает ежедневный backup/restore. Одноразовый reset
disposable public stand для OPS-004 явно разрешён 2026-09-07 в D31; любой
последующий reset или работа с будущими ценными данными требует нового решения.

## Закрытые вопросы

### Q-MATCH-003 — Void турнирного матча с downstream-результатами

**Closed 2026-09-09 by ADR D33.** Void компенсирует только статистику самого
целевого матча и добавляет immutable audit. Уже выполненное продвижение,
`bracket_json`/version, downstream matches/results/stats и notifications остаются
неизменными; cascade/replacement/repair flow не создаётся.

### Q-OPS-002 — Production release policy

**Closed 2026-09-07 by ADR D29, superseded for the current stand by D31.** Merge
в защищённый `main` публикуется native Git integrations Render/Vercel после
обязательного PR/main CI. GitHub выполняет read-only bounded monitor, а web/API
обязаны в итоге сообщить одинаковые SHA/version.

### Q-OPS-004 — Аккаунты и границы production-тестирования

**Closed 2026-09-07 by ADR D29, superseded for the current stand by D31.**
Изменяющие browser/E2E сценарии выполняются только локально/в CI на disposable
PostgreSQL. Public stand получает только read-only health/readiness/release/
proxy/OpenAPI smoke; test accounts для release gate не требуются.

### Q-OPS-001 — Статус ротации credential

**Closed 2026-09-06 by SEC-001 production execution evidence.** Neon control
plane завершил reset роли, Render использует новый credential и `SEED_ADMIN=0`,
26 admin-сессий отозваны, health после deploy зелёный. Connected Neon tool не
поддержал independent query по retained old URI; этот verification residual
остаётся в SEC-001 и не возвращает сам вопрос в active state. Secret values не
зафиксированы. См.
[`audit/evidence/sec-001-production-rotation.json`](audit/evidence/sec-001-production-rotation.json).

### Q-MATCH-001 — Права на cancel

**Closed 2026-09-06 by ADR D23.** Active standalone в `waiting`, `in_progress` или
`pending_confirmation` отменяет только active admin или creator; reason optional;
participant/judge не получает право автоматически; UI confirmation обязателен.

### Q-MATCH-002 — Авторизация void

**Closed 2026-09-06 by ADR D24.** Finished/stopped match void выполняет только
active admin или creator, без второго approver и с опциональной причиной. Это soft
invalidation с immutable audit, idempotent stats compensation и explicit UI
confirmation; hard delete запрещён.

### Q-DATA-001 — Судьба legacy V1 double-elimination

**Closed 2026-09-06 by ADR D25.** Migration/read/play preservation V1 DE не нужна;
legacy input fail closed в bounded time. Это не является разрешением на
production reset/recreate.

### Q-PRODUCT-001 — Порядок завершения MVP

**Closed 2026-09-06 by ADR D26.** Полный PRD v2 остаётся functional target;
неimplemented capability считается in-scope gap, пока отдельный ADR явно не
перенесёт его в future scope с одновременным обновлением PRD/acceptance.
