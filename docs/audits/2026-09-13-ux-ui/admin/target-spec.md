# ADMIN target-state specification

Status: proposal only; no application fix is claimed. D17/D23 recovery remains `blocked_decision` until product/security acceptance.

## Working design brief

- **Person:** active club administrator responsible for account access and exceptional recovery, often on a phone while another person waits.
- **Jobs:** find and verify an account; issue or reset access safely; change status/role with clear consequences; inspect the lifecycle trail; resolve a known stuck standalone match; perform the narrow D35 roster exception.
- **Feel:** precise, calm, consequence-aware; retain the current neutral canvas, white cards, violet action, green success, amber warning and red destructive semantics.
- **Concepts:** directory, account status, credential issuance, session revocation, audit trail, incident recovery, scoped tournament exception.
- **Signature element:** a stable account workspace: identity/status header, primary account facts, contextual action menu and a short lifecycle timeline.
- **Reject:** create-first landing, repeated equal action walls, hidden admin capabilities without context, global live-match catalog, re-readable secrets, operator impersonation.

## T-ADMIN-001 — Directory-first information architecture

Target `/admin` begins with title + explicit `← Профиль`, then search/status controls and the result count. `Добавить пользователя` is a secondary top action that opens a dedicated route or disclosure; it is not the first 520 px of every catalog visit.

Each user is one row/card with name as the primary link to `/admin/users/:id`; email/role/status/created/last login remain scannable. The inline action set is limited to `Открыть` plus `Ещё`; menu labels name Promote/Demote, Block/Unblock and Reset. Destructive/consequence-bearing actions retain explicit dialogs. Mobile remains single-column without horizontal overflow; desktop may use the available width for a real table/list rather than preserving a 560 px phone column by default.

The global bottom bar remains the five accepted product destinations. `/admin` must not pretend to be one of them: provide contextual parent navigation and retain Profile as its source. Sticky navigation must not obscure result controls or feedback.

### Acceptance

- Given an active admin opens `/admin`, when the first viewport renders at 390×844, then search, status and `Добавить пользователя` are visible before any create fields.
- Given a populated result at 360 px, when keyboard/touch moves across it, then one primary detail entry is clear, overflow actions are named, focused controls remain visible and no horizontal overflow occurs.
- Loading, error with Retry, empty and populated feedback appear adjacent to the result region and are not hidden below an unrelated form.

## T-ADMIN-002 — Stable account detail and lightweight audit

`/admin/users/:id` uses the existing visual language:

1. identity/status header with immutable email, role, status, created and last login;
2. editable profile section for the allowed ADM-004 fields;
3. `Управление доступом` menu for role/status/reset actions, with current invalid/self actions absent;
4. `История изменений` timeline, newest first, paginated.

Minimum audit item: Moscow timestamp, actor display name/id, action label, outcome and changed field **names**. Values are included only when explicitly safe; never include password/hash/token/cookie, temporary password or secret-bearing request metadata. Direct URL load, refresh and back navigation preserve the selected user or show a bounded not-found/forbidden state.

### Acceptance

- Given create/edit/block/unblock/role/reset occurred, when an active admin opens the target user, then each recorded action is discoverable with actor and timestamp and no secret-bearing value.
- Given the target does not exist or the actor is no longer active admin, then detail fails closed with a recovery route to the catalog.

## T-ADMIN-003 — Reset as an unknown-outcome state machine

The reset contract needs a non-secret monotonic marker such as `credentialRevision` or `latestTemporaryPasswordIssuedAt`. The client reads it before submission.

1. **Pending:** confirmation disabled, target and consequence stay visible.
2. **Success:** show temporary password exactly once with Copy; after close it is unrecoverable.
3. **Network/unknown:** do not retry. GET the marker first.
4. **Marker advanced:** show `Сброс применён, но временный пароль получить нельзя`; keep old action unavailable in this incident. Offer a separate `Выдать ещё один временный пароль` only behind a new confirmation explaining it revokes the just-issued credential.
5. **Marker unchanged:** re-enable a deliberate retry.
6. **Marker unavailable/ambiguous:** show unresolved state, keep submit disabled and provide a bounded return/support path.

Audit fields for each issue: actor/auth session/request ID, target ID, prior/new marker, outcome, reason where applicable, idempotency key/fingerprint. The secret is never included. This aligns with one-time output and does not turn early absence into proof of rejection.

### Acceptance

- Given the reset committed but its response was lost, when recovery GET reports a newer marker, then the UI never repeats automatically, states that the secret is lost, and a second issue requires a separately named confirmation.
- Given the server rejected before commit and the marker is unchanged, then one deliberate retry is possible.
- Given recovery cannot determine state, then the action remains unresolved and disabled.

## T-ADMIN-004 — Exact-ID incident recovery without D17 expansion

Proposed entry: `/admin/recovery` with a single exact UUID field, no browse-all list. Proposed read: `GET /api/v1/admin/matches/{id}/recovery`, active-admin only.

Minimum response:

- `id`, safe display title, `kind`, `status`, `version`;
- booleans/enums explaining which admin operation is currently permitted and why not;
- no participant names/IDs, score, judge, event log or ordinary live-detail payload by default.

The confirmation names title + exact ID, current status and the soft-cancel consequence. Force-close POST retains expected version, idempotency key/fingerprint, actor/state checks and D23 tournament/tutorial exclusions. After an unknown POST outcome, the client re-reads the same minimum recovery state; it never blindly retries. Immutable audit contains actor/auth/request, match ID, previous status/version, outcome, reason and idempotency reference.

### Acceptance

- Given an outsider active admin knows the exact ID of an active standalone match, when they use recovery lookup, then they see only minimum operational metadata while ordinary `/matches/:id`, list and history remain 403/hidden under D17.
- Given the match is eligible, when they confirm force-close, then the screen names the match/effect and success shows `cancelled` with the new version.
- Given a tournament/tutorial/finished/nonexistent match, then recovery explains the bounded refusal without disclosing live participants or score and performs no write.

## T-ADMIN-005 — Preserve scoped tournament exception

Keep the existing D35 path inside tournament detail. Active global admin may select a registered user and must see a named confirmation for consent override and bracket regeneration. Do not expose guest, invite, remove, settings, bracket editing or lifecycle controls. Pending/error behavior should inherit the shared UserPicker/Dialog remediation rather than create ADMIN-specific duplicates.
