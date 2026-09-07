# Shared-domain instructions

This file extends the repository `AGENTS.md` for `packages/shared`.

- Keep this package independent of `apps/*`, browser APIs, Fastify, Drizzle, and
  infrastructure. Shared domain functions should be pure or receive clock, RNG,
  IDs, and other effects explicitly.
- Preserve the public export surface and serialized schema compatibility unless a
  breaking change is explicitly approved and coordinated with every consumer.
  Old persisted bracket versions must remain readable when the current contract
  requires it.
- Express match, serving, undo, ranking, tournament, bracket, and validation rules
  as deterministic functions with explicit inputs and exhaustive states. Do not
  duplicate the same rule in API and web layers.
- Guard invariants at construction and transition boundaries. Reject malformed,
  cyclic, ambiguous, duplicate-participant, or impossible states with typed,
  testable failures.
- Add focused unit tests before implementation. Use table/property tests for score
  boundaries, deuce, undo sequences, ranking ties, bracket sizes and odd counts,
  bye allocation, and every supported bracket algorithm/format combination.
- When a shared type or rule changes, inspect all consumers, update contract and
  traceability documentation, build the package, run its tests, and run affected
  API/web tests. Use `pnpm --filter @tab10/shared typecheck`,
  `pnpm --filter @tab10/shared test`, and repository `pnpm run ci` when the contract
  crosses package boundaries.
