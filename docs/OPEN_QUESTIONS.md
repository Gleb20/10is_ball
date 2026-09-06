# Открытые вопросы продукта и эксплуатации

Активная часть содержит только вопросы, ответ на которые нельзя достоверно
получить из текущего репозитория. Реализация, зависящая от ответа, должна ссылаться
на ID вопроса. Закрытые ID сохраняются в конце для traceability и ссылаются на ADR
либо операционное evidence.

## Q-MATCH-003 — Void турнирного матча с downstream-результатами

D24 требует согласованно инвалидировать/reconcile зависимую сетку, но не определяет
наблюдаемый outcome, если после ошибочного матча уже сыграны следующие матчи:
запретить void до ручного разбора, cascade-void всех потомков или пометить турнир
invalid/replay-required с отдельным repair flow? Ledger, actor policy и standalone
compensation можно реализовать независимо; завершение tournament void зависит от
этого решения.

## Q-OPS-002 — Production release policy

Render dashboard read-only inspection подтвердил linked branch `main` и deployed
SHA `1a98a5f7e516762bed12c3d9b20ceefc06a6be06`. Ещё требуется установить Vercel
deployed SHA, фактические auto-deploy/PR-preview policies обеих платформ, целевую
release policy и того, кто подтверждает release/smoke.

## Q-OPS-003 — Данные и восстановление

Текущий production объявлен не содержащим ценных данных, требующих сохранения V1
DE (D25). Для будущих данных остаётся решить: когда они становятся ценными, какой
допустим RPO/RTO, где хранится backup и как подтверждается restore. Бесплатная
схема сейчас не доказывает ежедневный backup/restore. Любой reset/recreate даже
текущего production всё равно требует отдельного явного разрешения.

## Q-OPS-004 — Аккаунты и границы production-тестирования

Есть ли отдельные production test accounts для ролей admin/organizer/participant/
judge/outsider и разрешено ли создавать синтетические матчи/турниры в опубликованном
сервисе? До отдельного разрешения запрещены изменяющие продуктовые тестовые
сценарии в production. Отдельно разрешённые incident-операции SEC-001 выполняются
только по своему test plan. Credentials не следует присылать в документацию или
коммитить — их нужно передать/настроить безопасным способом.

## Закрытые вопросы

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
