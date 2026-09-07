# API-specific instructions

This file extends the repository `AGENTS.md` for `apps/api`.

- Keep Fastify routes thin: authenticate, validate, call a service, and translate
  the documented result. Put domain transitions and authorization predicates in
  testable services, not route or UI conditionals.
- Enforce authorization on the server for every read and mutation. UI visibility
  is never a security boundary. Pass the authenticated actor and auth-session ID
  explicitly wherever the rule depends on them.
- Validate request bodies, params, query values, headers, and state transitions.
  Preserve the documented `{ code, message, details, requestId }` error contract.
- Protect critical writes with transactions, database constraints, idempotency
  keys, and expected versions as appropriate. Verify persisted state after races,
  rollback paths, and retries.
- Use Drizzle and PostgreSQL-compatible behavior. Do not introduce a SQLite-only
  path. Integration tests use a clean ephemeral PGlite/PostgreSQL database; never
  point tests or migrations at persistent or production data.
- Keep time in UTC and inject clock, RNG, and ID generation in domain tests. Do
  not use real-time sleeps for expiry, ranking windows, or concurrency tests.
- Schema changes require forward-safe migration behavior, integration coverage
  from a clean database, API compatibility review, and the documentation updates
  required by the root matrix.
- Add happy-path, unauthenticated, forbidden, validation, invalid-transition, and
  response-contract tests for each affected endpoint; add concurrency and
  idempotency cases for critical mutations.
- Run focused tests first. Before handoff, run `pnpm --filter @tab10/api typecheck`
  and the relevant unit/integration suites. Run repository `pnpm run ci` for shared
  contracts, migrations, auth, scoring, tournament progression, or cross-package
  changes.
