# TECH-003 — login rate limiter test plan

## Scope

- Backlog: TECH-003.
- Requirements: AUTH-005, NFR security and AT-AUTH-010.
- User-visible outcome: valid repeated logins do not self-rate-limit; failed
  logins retain the public HTTP 429 `RATE_LIMITED` boundary.
- Non-goals: shared/external store, multi-replica coordination, production
  config/deploy, account lockout and UI redesign.
- Permissions: local code, tests, docs and disposable PGlite only.
- Open questions: none for the current process-local/single-replica policy. A
  shared limiter requires a separately accepted need before horizontal scale.

## Deterministic Red evidence

Run the four `TECH-003/AT-AUTH-010` cases in
`apps/api/src/auth.integration.test.ts` with `FakeClock`:

1. Eleven valid sequential logins for the same normalized email/IP must all
   return 200. Before the fix, response 11 was HTTP 429.
2. Ten wrong passwords return 401, attempt 11 returns HTTP 429
   `RATE_LIMITED`, `window - 1 ms` stays limited, and exact expiry returns 401.
   Before the fix, exact expiry remained HTTP 429.
3. Reserve 10 001 unique live keys and assert the map remains capped at 10 000.
   Before the fix, size reached 10 001.
4. Create 100 unique keys, advance exactly 15 minutes, create one fresh key and
   assert size 1. Before the fix, size became 101.

The pre-fix Node 24.19.0 focused run failed all four cases with those exact
observations.

## Green / regression matrix

| Scenario | Expected evidence |
|---|---|
| Repeated valid credentials | Every response 200; completed successes release their reservation |
| Known auth failures | First 10 receive the ordinary auth error; next response is HTTP 429 `RATE_LIMITED` |
| Fixed-window boundary | `resetAt - 1 ms` limited; `resetAt` begins a new budget |
| Unique-key pressure | SHA-256 tuple keys; no more than 10 000 live entries; oldest eviction at cap |
| Expiry cleanup | Next attempt removes ordered expired entries before evaluation |
| Technical service error | Reservation is released rather than misclassified as credential failure |

Tests intentionally inspect the private map only for the memory-bound invariant;
public behavior is asserted through the Fastify route. The limiter reserves
before asynchronous credential work so a concurrent burst cannot bypass the
failure budget, then retains only known failed outcomes.

## Topology and residual boundary

State lives in one `AuthService`/Node process. One API replica therefore has one
consistent budget; multiple replicas would each allow their own budget and are
not protected fleet-wide. Before increasing replica count, accept and implement
a shared limiter/store as a separate work item. TECH-003 does not infer that need
or mutate Render/production.

## Gates

1. Focused TECH-003 fake-clock matrix.
2. Full `auth.integration.test.ts` and API typecheck on Node 24.
3. Repository-wide `pnpm run ci` because auth is a critical journey.
4. Documentation audit and `git diff --check`.
5. Production deploy/smoke only under separate explicit approval.

## Evidence status

- Red: 4/4 expected failures captured on Node 24.19.0.
- Focused Green: TECH-003 4/4; full auth integration 15/15; API typecheck green.
- Full Node 24.19.0 CI: exited 0; docs/routes/secrets/busy-bye audits,
  lint/typecheck, shared 522, test-utils 4, web 116, API 140 + 7 guarded
  PostgreSQL skips, and API/web builds passed.
- Production: not modified or verified; shared multi-replica enforcement remains
  intentionally out of scope.
