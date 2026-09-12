# OPS-005 — bounded cold-start UX

## Scope

- Backlog: `OPS-005`.
- Decision/acceptance: D21, `AT-OPS-COLD-001/002`.
- Outcome: the initial API/auth bootstrap has an explicit delayed wake state,
  a 60-second bound and Retry; ordinary warm page loading is not relabeled.
- Non-goals: Render configuration/plan, readiness implementation (OPS-002),
  generic timeout for every API mutation, deploy and versioning.
- Permission boundary: local code/tests/docs and disposable loopback fixtures;
  production and external services are untouched.

## Red evidence

Initial `cold-start.test.tsx` was 1/3 green and 2/3 red: a warm request already
avoided a cold label, but the initial bootstrap rendered only an unnamed skeleton
and never reached a bounded timeout/Retry state.

## Verification matrix

| Scenario | Evidence |
|---|---|
| Initial response before 1.5s | «Подключаемся к сервису…» |
| Initial response remains pending | explicit «Сервис просыпается…» and up-to-minute copy |
| 60-second bound | aborts the initial request and shows error + Retry |
| Retry recovery | starts a fresh bounded attempt and reaches normal Login/auth flow |
| Warm page pending | retains ordinary screen loading; no cold-start label |
| Cleanup | stale/unmounted/retried attempt cannot update current auth state |

## Evidence

- Fake-timer/component Green: `cold-start.test.tsx` 3/3.
- Focused regression: cold-start + runtime auth recovery + onboarding resume +
  API auth client 9/9; web typecheck green on Node 24.19.0.
- Local in-app Browser: delayed loopback fixture showed waking then Login at
  desktop and 390×844; offline fixture showed error + Retry, and recovered to
  Login after the fixture returned. Mobile `scrollWidth === innerWidth === 390`.
  Console contained only known React Router future warnings.
- Full combined CI is recorded after active backlog chats merge.

## Residual risk

- Production Render cold-start smoke was not authorized or run.
- Without OPS-002 readiness, the initial probe can describe a delayed first auth
  request as waking, but never extends the allowance to later warm requests.
