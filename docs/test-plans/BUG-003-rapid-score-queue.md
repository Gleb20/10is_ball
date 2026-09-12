# BUG-003 — rapid score queue verification

## Scope

- Backlog: `BUG-003`.
- Requirements: `JUDGE-009`, `AT-MATCH-006`, `AT-MATCH-007`, `AT-JUDGE-007`.
- Outcome: два быстрых намеренных `+1` сохраняются как два point intents,
  отправляются FIFO с distinct idempotency keys и последовательными versions.

## Deterministic Red / Green

1. Component test подменяет первый `awardPoint` вручную управляемым Promise.
2. Два click выполняются до resolve первого Promise.
3. Red: pre-fix spy получает два одновременных вызова с version `5`.
4. Green: до resolve есть ровно один API call и виден pending count; Undo disabled.
5. Первый response возвращает version `6`; только затем второй call использует `6`
   и другой UUID. Второй response даёт итоговый score `+2` и version `7`.
6. Отдельный `VERSION_CONFLICT` refetch-ит authoritative score, очищает pending
   queue и показывает alert; повторного point request без нового click нет.

## Browser gate

- Disposable `AUDIT_EPHEMERAL=1` PGlite; production credentials/data запрещены.
- Desktop 1280×800 и mobile portrait 390×844.
- Первый point response задерживается на 600 ms; двойной click должен оставить
  один in-flight request, затем второй с `previous version + 1`, итог `0→2`.
- External disposable point создаёт реальный stale version; UI показывает
  authoritative `2:1`, stale alert, сохраняет доступный retry `+1`.
- Проверить pending badge, disabled Undo, отсутствие clipping/overlap, page title,
  framework overlay и неожиданные console/page errors.

## Commands

```bash
pnpm --filter @tab10/web exec vitest run src/pages/JudgePage.test.tsx
pnpm --filter @tab10/web typecheck
pnpm --filter @tab10/web test
pnpm run ci
```

## Non-goals and residual risk

- Server transaction/idempotency implementation и real-PostgreSQL DATA-002 gate.
- Undo/correction queue, multi-device live polling, judge release/TTL (BUG-004/005).
- Production release/smoke, deploy, version bump, commit/push.
