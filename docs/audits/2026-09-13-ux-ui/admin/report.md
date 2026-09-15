# ADMIN UX/UI audit

**Status: READY_FOR_REVIEW / PARTIAL.** The bounded ADMIN lifecycle, role and recovery replay is complete on the accepted candidate. Four findings are proposed: two P1 runtime/decision risks and two P2 structural/read-surface issues. The application and canonical documentation were not changed.

## Outcome

The implemented account lifecycle is materially stronger than the current information architecture suggests. Create, reset, block/unblock, promote/demote, self/last-admin guards, session revocation, audit persistence and the narrow tournament override behaved correctly in the tested branches. The largest gaps are operational recoverability:

1. an applied reset whose response is lost cannot be safely reconciled;
2. D23 force-close is inaccessible to an outsider admin without violating D17 through ordinary live detail;
3. persisted lifecycle audit has no minimum operator-facing user history;
4. the everyday directory is placed after a full creation form and every result exposes an equal-weight action wall.

The package is PARTIAL because the D17/D23 seam needs a product/security decision and several explicit branches were not replayed: finished-history retention, captain handover, full non-admin endpoint matrix, all force-close/void/purge states, physical mobile, WebKit/Firefox, zoom 200% and spoken AT. The accepted 1257/1257 candidate gate was not rerun here.

## Frozen baseline and method

- Base HEAD: `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221`.
- Candidate: accepted `GAP012-r6`; verified source fingerprint `8e8762575a07e71a17192da327cbe1b5906ca33c1c2ef762c0f9a37463b94cb3`.
- Toolchain: Node 24.20.0, pnpm 9.15.0, bundled Chromium, PostgreSQL 16.15 Alpine pinned by digest.
- Isolated runtime: web 5417, API 5418, PG 33030, Docker project `tab10-ux-admin-5417`, tmpfs only.
- Synthetic accounts used `@audit.invalid`; passwords existed only in process memory/environment. Screenshots mask the one-time secret. No production reads or writes.
- Eight run records cover SC-AD01..08 branches at 360/390/1440 plus API/DB state checks. The exact matrix and exclusions are in `runs.csv` and `requirement-coverage-delta.csv`.

Userflow (`flow-navigation`, `flow-tables`) was used to evaluate findability, hierarchy, list actions and failure recovery. Interface-design was used to define a compact working design brief and a target that preserves the accepted visual language instead of inventing a redesign.

## Verified behavior

- **Create:** active admin created user/role, saw a one-time 16-character password with Copy, and duplicate email returned conflict. Raw secrets were never exported.
- **Reset success:** old session and password became invalid; new temporary credential authenticated with `mustChangePassword=true`; reset audit and issue marker persisted.
- **Block/unblock:** block revoked the session, rejected login with `ACCOUNT_BLOCKED`, removed the user from the new-event directory; unblock restored a fresh login/directory entry without resurrecting the old session.
- **Role lifecycle:** promote revoked the target session; fresh login worked with the new role; demote worked; self role controls were absent, direct self role change returned 403, and last-admin block returned 409.
- **Audit persistence:** isolated DB contained create/reset/block/unblock/role-change rows with timestamps; exported evidence contains no credential value.
- **D17:** outsider admin received 403 for ordinary active detail and the match was absent from ordinary list/history. This is correct behavior.
- **D23 API:** direct admin force-close with expected version reached the soft `cancelled` outcome, version 0→1.
- **D35:** active global admin followed Start → Tournaments → detail, confirmed a named registered-user override, wrote `manual_override`, regenerated bracket 1→2 and still received 403 on organizer settings/start.

## Visual inspection

All 13 screenshots were opened and inspected, not only produced. The 390 full-page landing confirms that the create form occupies the first task block and every user repeats up to four outlined actions. The 1440 capture confirms a 560 px central column and a sticky bottom bar crossing catalog content. The lost-reset frame visibly combines a generic `Failed to fetch` alert with a still-enabled confirmation. The D17 frame shows a bounded 403 with no leaked live details. Scoped tournament before/after frames preserve the existing hierarchy and show the named exception result without organizer controls.

The loading/error viewport captures also reveal that result-state feedback can sit below the create/search stack and sticky navigation; runtime locators independently verified two skeletons, the error state, Retry and empty state. At 360 px there was no horizontal overflow and keyboard focus reached `Редактировать`, but this is not a full keyboard-only or assistive-technology pass.

## Findings

### F-ADMIN-001

**P2 / expert hypothesis / high confidence — catalog hierarchy and equal action wall.** `/admin` places the full account-creation form before search/results (`createTop=63.5`, users heading `583.5` at 390×844). Each active non-self row repeats Edit, Promote, Block and Reset as equal outlined buttons. `/admin` has no selected bottom destination; desktop keeps a phone-width 560 px column.

Consequence: frequent find/verify work pays the cost of a rare create task, rows are slow to scan, and lifecycle/destructive actions are visually indistinguishable. Remedy: directory-first landing, secondary Add entry, stable row-primary detail and a named contextual overflow. See T-ADMIN-001 and annotated before/after.

### F-ADMIN-002

**P2 / runtime defect / high confidence — no stable user detail or lightweight audit history.** Profile editing exists only in a modal and the URL remains `/admin`. Lifecycle rows persisted in DB, but neither client API nor route exposes them. The explicit minimum screen in `09_LOCAL_AUTH_AND_TENNIS_ADMIN.md` §7 is therefore unavailable.

Consequence: an operator cannot reliably reopen/share account context or answer who changed access and when. Remedy: stable read-only-capable account route with a safe lifecycle timeline; values are allowlisted and no secret-bearing fields are returned. See T-ADMIN-002.

### F-ADMIN-003

**P1 / runtime defect / high confidence — applied reset is blindly repeatable after response loss.** The injected branch committed one reset and then aborted its response. Evidence: old session 401, old password 401, DB `user.password_reset` plus newer issue marker, exactly one reset POST, zero recovery GETs. UI retained the reset dialog and enabled Confirm next to generic `Failed to fetch`. The audit did not retry.

Consequence: the first new credential is already authoritative but unavailable; a second click issues another credential and extends the incident. Remedy: non-secret monotonic issuance marker and GET-first applied/rejected/unknown state machine, with a separately confirmed second issue only after `applied + secret lost`. See T-ADMIN-003.

### F-ADMIN-004

**P1 / blocked decision / high confidence — D17 and D23 lack a minimum operational seam.** Ordinary exact detail correctly returned 403, list/history hid the active match and `/admin` had no match ID entry. Yet the direct D23 force-close mutation succeeded to `cancelled`. The right exists but is not discoverable without direct API work.

Consequence: an admin cannot resolve a known stuck standalone match through the product. Remedy requires a decision: exact-ID-only minimum recovery read, not a global live catalog and not ordinary match detail. It returns only ID/title/kind/status/version and allowed-operation reasons; participant identity, score and event log stay closed. See T-ADMIN-004.

## Cross-cutting states and deduplication

Loading, retryable error, empty and populated catalog states exist. Blocked status is visible and lifecycle confirmations name target/consequence. Shared selector, dialog, pending, bracket and contrast findings were not duplicated; their existing COMPONENTS/other-package owners remain authoritative. The observed stale-session email field not receiving focus is recorded as an AUTH/shared limitation, not a new ADMIN finding.

## Proposed implementation order (not authorized here)

1. Decide the D17/D23 minimum recovery disclosure boundary.
2. Add the reset issuance marker and unknown-outcome recovery contract before changing presentation.
3. Add safe user detail/audit read contract and stable route.
4. Reorder the catalog and consolidate row actions while preserving all functions.
5. Reverify ADMIN plus shared Dialog/UserPicker states in Chromium/Firefox/WebKit, mobile/desktop, keyboard/focus/zoom and PostgreSQL fault paths.

No backlog IDs are assigned here; coordinator owns canonical triage and documentation.
