# BUG-007 — runtime auth recovery verification

## Scope

- Backlog: `BUG-007`.
- Requirements: `AUTH-001`, `AUTH-006`, `AT-AUTH-009`.
- Outcome: первый runtime `401` защищённого API очищает web auth state, показывает
  повторный вход без reload/request loop и после login возвращает безопасный
  внутренний route с незавершённым form draft.

## Deterministic Red / Green

1. API-client test возвращает `401` на первый protected request.
2. Red: второй protected call снова выполняет fetch; auth-invalidated signal
   отсутствует.
3. Green: signal публикуется один раз, второй call отклоняется локально, а
   успешный login снимает latch.
4. App-level test стартует authenticated на `/matches/new`, заполняет title и
   guest, затем получает `401` на create.
5. Red: login не появляется; route остаётся в stale authenticated state.
6. Green: focused login появляется без reload, исходный component скрыт через
   React `Activity`; после login route, title и guest восстановлены, create не
   replay-ится.
7. Отдельный router case передаёт external return target и подтверждает fallback
   на `/`.

## Browser gate

- In-app Browser и disposable local HTTP auth fixture; production credentials,
  data и external services запрещены.
- Desktop 1280×800 и mobile portrait 390×844.
- Login fixture делает следующий create request `401`, после чего повторный login
  должен восстановить `/matches/new` и оба form value без второго create.
- Проверить page identity, meaningful DOM, Email focus, отсутствие framework
  overlay/app console errors, horizontal overflow и screenshots обоих viewport.

## Commands

```bash
pnpm --filter @tab10/web exec vitest run src/api.auth.test.ts src/auth-recovery.test.tsx
pnpm --filter @tab10/web typecheck
pnpm --filter @tab10/web test
pnpm run ci
```

## Non-goals and residual risk

- Automatic mutation retry запрещён; пользователь решает, отправлять ли форму
  снова после re-login.
- Черновик сохраняется только пока SPA/page живы; reload, crash и новая вкладка не
  получают durable draft storage.
- Server TTL/revocation semantics, first-password redesign, production
  release/smoke, deploy, commit/push/tag/version bump не входят в item.

## Integration review — 2026-09-13

Deferred protected401 dispatched before a successful new login must not invalidate that newer session. Added request auth generation guard; deterministic Red reproduced the unwanted unauthorized event. Focused combined API-client/JudgePage suite23 and full web128 passed; independent review reran23 successfully. Compiled browser gate remains pending.
