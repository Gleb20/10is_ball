# Tab-10 repository working agreement

This file applies to the whole repository. A nested `AGENTS.md` adds constraints
for its subtree and takes precedence there. When a task started at the repository
root changes a nested subtree, read that subtree's `AGENTS.md` before editing.
The user's explicit task scope and approved decisions take precedence over these
repository defaults; never use a general rule to broaden the requested change.

## Sources of truth

Start with `docs/README.md`, then read the current status, backlog, relevant
requirements, accepted decisions, and as-built documentation.

For intended product behavior, resolve conflicts in this order:

1. An explicitly accepted entry in `docs/DECISIONS.md`, only for the decision it
   names.
2. `docs/requirements/04_PRD.md` together with
   `11_ACCEPTANCE_TEST_CATALOG.md` — product rules and observable behavior.
3. `docs/requirements/07_DATA_MODEL.md` and `08_API_SPEC.md` — contracts.
4. `docs/requirements/05_UX_FLOWS.md` — interaction flow and UI states.
5. `docs/requirements/10_TDD_STRATEGY.md` — delivery and quality gates.

An ADR/requirement mismatch is documentation drift and must be reconciled; do not
quietly leave two target behaviors. `docs/architecture/*` and
`docs/operations/*` describe the current implementation; they do not redefine
the desired product. Code, tests, production, `PROJECT_STATUS`, and
`CAPABILITY_MATRIX` are evidence of current behavior, not substitutes for a
requirement. Record unresolved conflicts in `docs/OPEN_QUESTIONS.md` and ask the
user when the answer would materially change the result.

The currently deployed product is the visual regression baseline. Treat Figma,
screenshots, and other mockups as supporting references unless the user explicitly
approves a redesign or names a different authority. Do not change production UI
to match Figma merely because the two differ.

`docs/requirements/14_CURSOR_INSTRUCTIONS.md` and `.cursor/rules/*` are legacy
compatibility entry points. They do not override this file or the sources above.

## Work-item workflow

1. **Orient.** Read `docs/PROJECT_STATUS.md`, `docs/BACKLOG.md`, the relevant
   requirement and acceptance IDs, applicable ADRs, and the relevant as-built
   document. Inspect the implementation and existing tests before proposing work.
2. **Define.** Link the work to one canonical backlog heading in the form
   `<AREA>-NNN`, where `AREA` is `SEC`, `BUG`, `GAP`, `DATA`, `OPS`, or `TECH`;
   never reuse an ID. Link requirement/acceptance IDs and state the user-visible
   outcome, non-goals, risks, permissions, and open questions. Keep the
   verification plan and REQ/AT links in that backlog entry unless
   `docs/WORKFLOW.md` calls for a separate plan for a large or risky change.
3. **Reproduce or make Red.** For a bug, capture a deterministic failing test or
   other repeatable evidence before changing behavior. For a feature, add the
   smallest failing acceptance-level test first. Keep bug tests as regressions.
4. **Implement.** Make the smallest coherent change that satisfies the agreed
   behavior. Preserve unrelated and uncommitted work. Do not broaden scope or
   add speculative abstractions.
5. **Verify.** Run the narrowest meaningful checks first, then the broader gates
   justified by risk. Verify user-facing changes in a real browser and data or
   concurrency changes against an ephemeral PostgreSQL-compatible database.
6. **Document.** Apply the update matrix below in the same change. Do not mark a
   backlog item or capability complete until its acceptance evidence passes.
7. **Hand off.** Report the outcome, changed files, exact checks and results,
   skipped checks with reasons, known residual risks, and open decisions.

If current behavior contradicts documentation, do not silently choose one. Keep
the intended behavior from the source hierarchy, record the implementation drift,
and obtain a decision when fixing it would change product behavior.

## Evidence and verification

- Never claim a test, build, migration, deployment, browser flow, or production
  behavior passed unless it was actually checked in the current task.
- Separate pre-existing failures from regressions introduced by the change.
- Prefer observable state and authoritative persisted data over UI-only success
  messages. For critical mutations, verify both the response and resulting state.
- Tests must be deterministic: inject clock, randomness, and IDs; do not use
  sleeps to hide races or retry failing tests until they happen to pass.
- Use component/API tests for state and permissions, integration tests for
  transactions and constraints, and end-to-end tests for critical journeys.
- For UI changes, check loading, empty, error, success, disabled, unauthorized,
  stale-session, narrow-mobile, desktop, keyboard, focus, and contrast states as
  applicable. Static DOM tests do not replace browser layout checks.
- Run repository-wide `pnpm run ci` when the change crosses packages, changes a
  contract, migration, shared domain rule, or critical journey. Otherwise run
  the relevant package typecheck/tests plus any focused browser or integration
  checks. Record exactly what ran.

## Permissions and safety

Allowed by default are read-only inspection, scoped edits requested by the user,
and tests that use disposable local artifacts or an ephemeral test database.

Require explicit user approval before any of the following:

- mutate production data, configuration, accounts, storage, or external services;
- deploy, redeploy, promote a release, push commits or tags, or force-push;
- commit, tag, or bump a product version unless the task explicitly includes it;
- run migrations, reset, truncate, restore, or seed any non-ephemeral database;
- rotate credentials or change hosting, DNS, billing, or access controls.

ADR D31 defines one narrow standing authorization for the current disposable
public stand: when the user merges a pull request into protected `main`, native
Render/Vercel Git integrations may publish that merge and Render may apply its
immutable migrations after required CI checks pass. GitHub then performs only a
read-only exact-SHA smoke. This does not cover another branch, manual/fallback
deploys, version/tag changes, mutating public E2E, down-migrations, automatic
restore, DNS/billing/access changes or bypassing a failed/skipped gate. The
separately approved one-time reset for OPS-004 is not standing authorization for
future resets or deletion of valuable data.

Never use production as a test fixture. Production may be inspected read-only as
a visual/behavioral baseline when access is available. Do not bypass approval by
calling a lower-level tool. Avoid destructive commands, preserve user work, and
stop when the exact target of a destructive operation is unclear.

## Secrets and personal data

- Never commit or paste passwords, tokens, cookies, connection strings, private
  keys, or secret-bearing `.env` files. Commit only documented placeholders.
- Do not print secrets in commands, logs, screenshots, test fixtures, docs, or
  handoff messages. Redact any secret encountered accidentally.
- Read secret-bearing files only when necessary for the authorized task; prefer
  variable names and `.env.example` over values.
- Use synthetic users and disposable credentials in tests. Do not copy production
  personal data into local fixtures.

## Product and domain guardrails

Unless a newer approved requirement or ADR says otherwise:

- Admin operations require an active admin. A user cannot change their own role,
  and the last active admin cannot be demoted or blocked. Blocking, password reset,
  and role changes must enforce their documented session-revocation behavior.
- Active events are visible only to their participants, active judge, or organizer;
  completed events are visible to active users. Blocked users remain in historical
  records but are excluded from new selections and current rankings.
- A match must have distinct valid participants on both sides. A user cannot play
  in two active matches. Tutorial matches never affect history, statistics,
  rankings, or rival calculations.
- Only the organizer may change an unstarted match. Cancel, stop, no-show, and
  admin force-close/delete must follow the exact actor and match-kind rules.
  Confirmed results are immutable except through an explicitly approved,
  auditable compensation design.
- Any active user may acquire a free judge slot. Score, undo, finish, release, and
  handover mutations require the matching active judge/auth session. Score writes
  use an idempotency key and expected version; UI input must not lose intentional
  rapid taps or conceal version conflicts.
- Tournament roster, rules, bracket, start, stop, cancel, and dissolve actions are
  organizer-owned unless the specification explicitly grants a participant action.
  A generated bracket must be regenerated after an invalidating roster change.
- Team edit, invite, removal, and captain transfer are captain-owned. The team must
  always satisfy the documented captain and archival invariants.
- Multi-record state transitions, statistics, bracket advancement, notifications,
  and audit entries must remain consistent under failure and concurrent requests.

## Documentation update matrix

| Change | Update in the same work item |
|---|---|
| New finding, bug, gap, priority, owner, or status | `docs/BACKLOG.md`; update `docs/PROJECT_STATUS.md` when the current snapshot changes |
| Product scope or observable behavior | Relevant requirement plus `docs/requirements/11_ACCEPTANCE_TEST_CATALOG.md`; add or update `docs/OPEN_QUESTIONS.md` while unresolved |
| Accepted product, architecture, data, security, or UX decision | `docs/DECISIONS.md`; close the corresponding open question |
| API contract, authorization, error, polling, or response schema | Relevant requirement, `docs/architecture/API_AS_BUILT.md`, and contract tests |
| Schema, relation, invariant, migration, or persistence behavior | `docs/architecture/DATA_MODEL_AS_BUILT.md`, relevant requirement, and migration/test evidence |
| Runtime architecture or dependency boundary | `docs/architecture/AS_BUILT.md` and, when applicable, `docs/CAPABILITY_MATRIX.md` |
| Hosting, environment, release, backup, or operational procedure | `docs/operations/DEPLOYMENT_AS_BUILT.md`; release/version files only with explicit approval |
| Test added, removed, renamed, or remapped | `docs/requirements/13_REQUIREMENTS_TEST_TRACEABILITY.md` and the work item's test plan |
| Delivery process or repository instruction | Relevant `AGENTS.md`, `docs/WORKFLOW.md`, and compatibility pointer; do not duplicate full policy |
| Any non-trivial implementation or documentation change | `docs/CHANGELOG_DEV.md` with verification evidence |

Documentation-only changes still require link/path validation and a consistency
review. Do not rewrite historical records; append or clearly supersede them.
