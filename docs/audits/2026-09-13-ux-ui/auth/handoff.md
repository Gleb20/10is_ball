# Передача AUTH

`READY_FOR_REVIEW`; пакет ещё не принят и не означает завершение полного аудита. Source приложения, canonical requirements/backlog, история commit, release и production не изменялись. Авторский output находится только в `docs/audits/2026-09-13-ux-ui/auth/**`.

Порядок чтения: `report.md` → `runs.csv` → `findings.json` → `target-spec.md` / `wireframes.html` → `flow-report.html` → `requirement-coverage-delta.csv` → evidence. Reviewer проверяет факты, priority, отсутствие дублей, сохранение функций и точные target states. Canonical IDs назначает координатор.

## База и runtime

- Base HEAD `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221`.
- Frozen export `/private/tmp/tab10-ux-audit-dispatch-v1/manifest.json`: SHA-256 `c39ed47d9aaaadfba7fac3790bde26acac772ae9946e2f1c99bcdb6a1d46b3a6`, 310 путей, verification 310/310. Declared `tracked_patch_sha256`: `30f672ae232cd2c729fc49661e5aed5e9603da70dd3570ccbae88953387d73c4`. Portable record: `evidence/dispatch-provenance.json`.
- Candidate source fingerprint `8e8762575a07e71a17192da327cbe1b5906ca33c1c2ef762c0f9a37463b94cb3`, 323 application paths. `evidence/source-hashes.sha256` фиксирует AUTH seams и текущие sources of truth.
- Node 24.20.0, pnpm 9.15.0; production build — PASS. Выполнение миграций — 9/9 PASS на PostgreSQL 16.15. Chromium 153.0.8010.12.
- Во время run пакет владел web4717, API4718, PostgreSQL33017 и compose project `tab10-ux-auth-4717`. Только synthetic fixtures; credentials хранились в mode-600 `/private/tmp/tab10-ux-auth-private.json` и не попали в evidence.

Cleanup завершён: ports 4717/4718/33017 закрыты, compose containers отсутствуют, disposable volume/network удалены, три точных runtime-файла `/private/tmp/tab10-ux-auth-*` вместе с credentials удалены. Evidence: `evidence/cleanup.json`.

## Findings для review

- `F-AUTH-001` независимо воспроизведён как P2: FirstPassword `Выйти` не отправляет logout POST и оставляет restricted session authenticated. Minimal evidence/negative control: `evidence/first-password-exit-probe.json`.
- `F-AUTH-002` покрывает focus/semantics/copy ошибок auth-форм; внешний ring остаётся BUG-020 и не дублируется.
- `F-AUTH-003` и `F-AUTH-005` — expert hypotheses; user observation не проводилось.
- `F-AUTH-004` уточняет F-PILOT-007 и объединяется в TECH-006, а не создаёт второй Home task.

## Session-recovery contract для acceptance MATCH-015/GAP-013

Точные источники: REQ `AUTH-001` про закрытый доступ, `AUTH-006` про current session и `MATCH-015` про отсутствие сохранённого unfinished create flow; AT `AT-AUTH-009` явно задаёт mounted safe-draft recovery, same-actor restore, different-actor remount/clear и запрет replay mutation; UX flow `05_UX_FLOWS.md` §3.1 повторяет контракт. Ни один ADR не создаёт draft exception. ADR `D5` только выносит auth за authenticated shell и задаёт route IA; persistence он не разрешает.

Обычный route exit/unmount удаляет create draft по MATCH-015. Runtime 401 уже: protected page остаётся mounted, hidden и inert, поэтому safe in-memory draft живёт только на время reauth. Тот же actor восстанавливает exact safe path/query/hash и draft; rejected mutation не replayed. Другой actor получает fresh protected tree без прежних fields/selections. AUTH-A02 это подтвердил; контракт нужно явно перенести в acceptance любой перестановки формы. LocalStorage/server draft не разрешён.

## Фокус review и ограничения

- Restricted allowlist AUTH-001, sliding expiry, повтор old temporary password, admin reset, revoke-others после password change, Profile UI revoke, completed tutorial isolation, populated Home matrices, WebKit, physical mobile, spoken AT и zoom 200% не получили package PASS. Точные состояния — в `requirement-coverage-delta.csv`.
- Два instrumental failure (sandbox Chromium launch, затем ошибки variable/locator в harness) записаны отдельно и не имеют product verdict. Чистый browser run не зафиксировал page errors.
- `wireframes.html` и `flow-report.html` автономны, без placeholders и horizontal overflow. Это target/review artifacts, а не доказательство текущего поведения приложения.
- Payload manifest исключает себя; проверка из каталога: `shasum -a 256 -c manifest.sha256`.
