# TECH-002 — bounded critical browser E2E

## Scope

- Backlog: `TECH-002` first slice.
- Acceptance: `AT-AUTH-009`, `AT-MATCH-001/005/008/013`,
  `AT-JUDGE-001/003/006/007` and NFR accessibility/compatibility.
- Outcome: repeatable Chrome checks cover the highest-risk standalone
  match/judge and runtime re-auth paths at desktop and mobile widths.
- Non-goals: production, external services, tournament/admin/team/handover,
  cross-browser/device farm and remediation of known GAP-011 color contrast.

## Historical Red — source worktree 2026-09-07

`pnpm test:e2e` failed because the script, Playwright configuration, journeys
and axe dependency did not exist.

## Historical Green matrix — source worktree 2026-09-07

1. Disposable `AUDIT_EPHEMERAL=1` API is attested before fixture mutations.
2. Login → guest match → judge acquire/setup → rapid 5:0 → confirm → reload
   proves the persisted terminal result.
3. A second authenticated context revokes the browser session; the rejected
   create is not replayed, focused login restores the route and draft.
4. Both journeys run in system Chrome at 1280×800 and 390×844.
5. Login/Home/Judge/recovery surfaces have no serious/critical axe violations
   after explicitly excluding the tracked GAP-011 `color-contrast` rule.
6. Every checked surface has no document-level horizontal overflow.

## Historical commands and local evidence — 2026-09-07

```bash
pnpm test:e2e
pnpm run ci
```

The focused matrix passed 4/4 locally. Combined Node 24 `pnpm run ci` also
passed: docs/routes/secret/ops audits, lint/typecheck, shared 522, test-utils 4,
web 124, API 150 + 7 guarded PostgreSQL skips, and API/web builds. Screenshots
and traces are retained only on failure and ignored by Git. The GitHub quality
job installs Chrome and runs the same E2E command after the deterministic CI
gate; a hosted run remains unverified until an authorized commit/push.
Expansion beyond this bounded slice keeps `TECH-002` in progress.

## Current integration — 2026-09-13

The source journeys are integrated into `playwright.prodlike.config.ts` and
`pnpm run verify:e2e`, using compiled API/web, disposable PostgreSQL16 and
Playwright-managed Chromium1.63. Fixture requests require loopback plus
`release.environment=test`; legacy `AUDIT_EPHEMERAL` is not used.
The two critical journeys and existing production-like proxy/CSRF smoke each
run on desktop1280×800 and mobile390×844. Page errors fail the critical journeys;
verified-state screenshots are retained on success outside Git.
Current aggregate browser: 6/6 journeys and 9/9 foundation checks passed. Historical 4/4 remains source evidence.
GAP-011 contrast remains explicitly excluded from this bounded slice and must
be removed from exclusions during waveF acceptance.
