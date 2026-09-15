# ADMIN source review

Frozen source: `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221` + accepted `GAP012-r6`, source fingerprint `8e8762575a07e71a17192da327cbe1b5906ca33c1c2ef762c0f9a37463b94cb3`. Application code was read, not edited.

## Canonical constraints

- `04_PRD.md` ADM-001..008: admin-only catalog, create/edit, block/unblock, reset, persisted lifecycle audit.
- `09_LOCAL_AUTH_AND_TENNIS_ADMIN.md` §7: minimum screens include list, create, view/edit, block confirm, one-time reset result, lightweight user audit history and explicit match-operation confirmations.
- D6: role changes target other users, revoke all target sessions, self-role forbidden and last active admin protected.
- D17: an active event remains closed to an outsider admin unless they are organizer, participant or current judge.
- D23/MATCH-017: active admin may cancel/force-close an active standalone match through an explicit named safeguard, with actor/state/version/idempotency enforced server-side.
- D35 + AT-TRN-016/022/023: global admin gets only catalog/roster read and confirmed registered-user add; organizer authority remains unchanged.

## Current ADMIN composition

`apps/web/src/pages/AdminPage.tsx` renders, in order, a complete create form, the users heading/search, then static cards. Each non-self active user card exposes Edit, Promote/Demote, Block and Reset as visually equivalent outlined buttons. Profile editing is modal state; there is no `/admin/users/:id` route. `/admin` is reached from Profile while the global bottom bar has no ADMIN destination or `aria-current` mapping for that route.

The web API adapter exposes list/create/update/block/unblock/reset operations. It does not expose a read-only per-user detail/audit operation. The API stores `audit_logs` rows for the replayed create, reset, block, unblock and role-change mutations; the UI never reads them.

### Admin user detail and audit

The explicit minimum `lightweight audit history пользователя` is absent from both the route model and client API. Runtime A-RUN-002 found only an edit dialog and no stable detail URL. The isolated DB sample proves the underlying lifecycle rows are present and that temporary passwords were not written into evidence. This is a read-surface gap, not a claim that ADM-008 persistence is absent.

### Reset unknown outcome

`AdminPage.runConfirm` calls `resetPassword`, shows the returned secret on success, and otherwise sets a generic action error while retaining the confirmation. There is no idempotency parameter or read marker in this client flow. A-RUN-004 let the server commit exactly one reset, then aborted the response. Old auth became invalid and an audit/issue row existed, but the dialog stayed enabled and the client made zero GET-first requests. The audit intentionally did not click again.

### D17/D23 seam

The ordinary match-detail service correctly returns 403 to an outsider active admin during an active standalone match, and the same match is absent from ordinary list/history. The admin force-close POST exists and succeeded with `expectedVersion`, resulting in `cancelled`; however `/admin` exposes neither an exact-ID entry nor minimum recovery read. Therefore removing the 403 or globally listing active matches would violate D17, while leaving the current UI makes D23 operationally unreachable.

The smallest coherent seam is an exact-ID-only admin recovery lookup. It should disclose only the identifiers and operational state required to confirm the permitted mutation; identities, score and event log remain closed unless a later accepted decision justifies each field.

### Scoped tournament admin

The only repeated tournament path was Start → Tournaments → detail → registered player selection → named confirmation. The successful write stored `additionSource=manual_override` and regenerated bracket version 1→2. Direct settings/start attempts returned 403 and organizer controls were absent. Wider tournament branches were intentionally not re-audited; the accepted TOURNAMENT package is supporting evidence only.

## Shared deduplication

No new ADMIN IDs were created for shared selector focus/stale popup (`BUG-018/019/023`), UserPicker pending/error (`F-CMP-R-001`), pending payload (`F-CMP-R-002`), generic dialog error/pending behavior, bracket pending or score contrast. The observed stale-session login email focus=false belongs to AUTH/shared recovery coverage and is recorded as a limitation in `runs.csv`.
