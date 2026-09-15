# ADMIN handoff

**READY_FOR_REVIEW / PARTIAL**

Read order: `report.md` → `runs.csv` → `findings.json` → `requirement-coverage-delta.csv` → `source-review.md` → `target-spec.md` → `flow-report.html` → annotated PNGs → evidence.

## Frozen scope and result

- Exact base HEAD `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221`, accepted `GAP012-r6`, source fingerprint `8e8762575a07e71a17192da327cbe1b5906ca33c1c2ef762c0f9a37463b94cb3`.
- Final isolated replay: 8 run records, 13 screenshots, Node 24.20.0, pnpm 9.15.0, bundled Chromium, pinned PostgreSQL 16.15 tmpfs.
- Cleanup `complete`: Docker project removed, temp directory removed, ports 5417/5418/33030 free, secrets persisted=false.
- Application/canonical docs were not edited by this audit package. Recheck of all 323 accepted candidate files produced zero mismatches.
- Findings: F-ADMIN-001 P2 expert hypothesis; F-ADMIN-002 P2 runtime/read-surface defect; F-ADMIN-003 P1 runtime recovery defect; F-ADMIN-004 P1 blocked decision.
- D17 live-detail denial is correct and must not be “fixed”. D35 scoped tournament path was repeated only for the global-admin role; wider accepted TOURNAMENT evidence is supporting, not re-audited.

## Coordinator decisions

1. Decide whether to accept the exact-ID minimum D17 recovery exception in T-ADMIN-004. Default-safe answer if not accepted: keep D17 closed and mark D23 UI access unresolved; do not add a live-match catalog.
2. Assign canonical IDs/priorities/dependencies. This package intentionally did not edit BACKLOG/STATUS/DECISIONS.
3. Decide whether F-ADMIN-002 is triaged as the remaining GAP-010 UI slice or a separate bounded read-surface item; ADM-008 persistence itself is verified in sampled paths.
4. Route stale-session email focus=false to AUTH/shared owner; do not duplicate it as ADMIN.

## Candidate A — reset unknown-outcome contract

**Result shape:** non-secret monotonic issuance marker + GET-first client state machine; one-time password remains unrecoverable; no automatic retry.

**Given/When/Then:** Given reset commits and response is lost, when the marker advances, then UI says applied/secret lost, disables retry, and offers a separately confirmed new issue. Given marker unchanged, deliberate retry is allowed. Given marker unreadable, state stays unresolved/disabled.

**Edges:** response lost before commit; response lost after commit; simultaneous operator resets; exact replay/idempotency reuse; user login between issue and recovery; read 401/403/404/5xx; audit write rollback. Verify PostgreSQL state and session revocation, not only UI copy.

## Candidate B — stable user detail and safe audit timeline

**Result shape:** `/admin/users/:id` plus allowlisted read DTO and paginated lifecycle timeline: actor, Moscow timestamp, action/outcome and safe changed-field names.

**Given/When/Then:** Given lifecycle mutations exist, when active admin opens the account, then events are discoverable without passwords/hashes/tokens. When actor loses admin or target is absent, detail fails closed and returns safely to catalog.

**Edges:** self account; blocked target; role changed during viewing; deleted/nonexistent ID; pagination ordering/ties; audit meta containing unexpected keys; back/refresh/deep link; 401 stale session.

## Candidate C — directory-first ADMIN structure

**Result shape:** search/status/result count first, secondary Add flow, stable row-primary detail, contextual lifecycle menu and preserved confirmations; desktop uses available width.

**Given/When/Then:** Given 390×844, when `/admin` loads, then search and Add are visible before create fields. Given 360 px keyboard/touch, when traversing a row/menu, then focus remains visible, no overflow occurs and only status-valid actions appear. Loading/error/empty feedback stays adjacent to results.

**Edges:** long Russian names/emails; 0/1/many users; active/blocked/admin/self; mutation pending; load failure during mutation; sticky bottom bar; zoom 200%; reduced motion/high contrast.

## Candidate D — exact-ID match recovery

**Result shape:** separate exact UUID entry and minimum admin recovery DTO with `id/title/kind/status/version/allowed-operation reasons`; no global browse and no participant/score/event detail.

**Given/When/Then:** Given outsider active admin knows an active standalone ID, when they inspect it, then ordinary detail/list/history remain closed while the recovery screen shows only operational metadata. Confirmed force-close produces soft `cancelled`; unknown outcome uses GET-first.

**Edges:** waiting/in_progress/pending_confirmation; already cancelled/finished/stopped/voided; tournament/tutorial; nonexistent/malformed ID; stale version; idempotency reuse; actor blocked/demoted mid-flow; concurrent finish/cancel; reason length/absence; audit rollback.

## Verification evidence

- `jq empty` passed for findings and all generated JSON evidence.
- CSV structural check: `runs.csv` 8 rows; `requirement-coverage-delta.csv` 17 rows.
- Candidate-source exact tree check: 323/323 hashes match.
- Browser replay final status: `{status: complete, runs: 8, screenshots: 13, consoleErrors: 9}`; all nine console errors correspond to deliberately exercised 401/403/409/network-abort branches, no pageerror.
- Visual inspection completed for every screenshot and both annotated render outputs.
- Cleanup evidence reconfirmed via `lsof` and Docker label query: no listeners on 5417/5418/33030; no `tab10-ux-admin-5417` container.

## Not tested / residual risk

No physical device, Firefox, WebKit, zoom 200%, spoken AT, full keyboard-only journey or population usability metrics. No finished-history retention, captain transfer, full non-admin endpoint matrix, all force-close/void/purge branches, cold-start 60-second branch, or exhaustive audit meta/rollback matrix. These are explicit limitations, not passes.
