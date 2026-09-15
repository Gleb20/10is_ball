# Single proposal: request-correlated admin password reset

## Decision summary

Keep the existing mutation route, but make every new reset a UUID-identified request with a durable non-secret receipt and a target-scoped compare-and-set pointer:

- `Idempotency-Key` is the reset `requestId` and is required.
- `admin_password_reset_requests` records the exact request fingerprint and a terminal `applied` or `rejected_state_changed` outcome.
- `users.last_admin_password_reset_request_id` is the only ordering token. It tracks admin reset ordering, not a generic credential version.
- a successful request returns the plaintext temporary password only to the first executing HTTP call; receipt reads and exact replays never return it;
- a deliberate replacement uses a new request ID, the latest preflight pointer and `supersedesRequestId` of the immediately preceding unknown request. The CAS rule makes the replacement win whether the delayed prior request reaches PostgreSQL before or after it.

No timestamp, `issuedAt`, `updatedAt` or latest-row inference proves a request outcome. Absence of a receipt is `unknown`, never `rejected`.

## HTTP contract

All routes use existing `requireAdmin`, CSRF and current auth error handling. UUID path/header/body values use the existing UUID validator.

### 1. Preflight

`GET /api/v1/admin/users/{userId}/reset-password/state`

Response `200`:

```json
{
  "targetUserId": "uuid",
  "lastAppliedRequestId": "uuid-or-null"
}
```

The value comes only from `users.last_admin_password_reset_request_id`. It is non-secret and is not evidence about any request except the request ID it exactly names. Missing target is `404 USER_NOT_FOUND`; a non-active/non-admin actor receives the current `401/403` behavior.

### 2. Issue or deliberately replace

`POST /api/v1/admin/users/{userId}/reset-password`

Required header:

```text
Idempotency-Key: <UUID requestId>
```

Body for an ordinary confirmed reset:

```json
{
  "expectedLastAppliedRequestId": "uuid-or-null"
}
```

Body for a separately confirmed replacement of an unknown request:

```json
{
  "expectedLastAppliedRequestId": "uuid-or-null from a fresh preflight",
  "supersedesRequestId": "uuid of the immediately preceding unknown request",
  "confirmReplacement": true
}
```

Validation is exact:

- `supersedesRequestId` and `confirmReplacement: true` must occur together;
- `supersedesRequestId !== requestId`;
- `confirmReplacement` is rejected when no `supersedesRequestId` is supplied;
- no password, hash, receipt token or timestamp is accepted in the body.

First execution response `200`:

```json
{
  "requestId": "uuid",
  "outcome": "applied",
  "secretAvailable": true,
  "temporaryPassword": "one-time plaintext"
}
```

Exact replay after the request already committed returns `200` without a secret:

```json
{
  "requestId": "uuid",
  "outcome": "applied",
  "secretAvailable": false,
  "current": true
}
```

`current` is false if a later reset is now authoritative. The server never recreates or retrieves the earlier plaintext.

State-CAS rejection returns `409` and is durably receipted:

```json
{
  "code": "RESET_STATE_CHANGED",
  "requestId": "uuid",
  "outcome": "rejected_state_changed",
  "currentLastAppliedRequestId": "uuid-or-null"
}
```

Other exact errors:

- `400 IDEMPOTENCY_KEY_REQUIRED` for a missing header; no mutation or receipt;
- `400 VALIDATION` for malformed UUID/shape; no mutation or receipt;
- `403 FORBIDDEN` when the actor is no longer an active admin at the in-transaction recheck; no mutation or receipt;
- `404 USER_NOT_FOUND`; no mutation or receipt;
- `409 IDEMPOTENCY_KEY_REUSED` when an existing request ID has a different fingerprint;
- `500 INTERNAL` only after the transaction rolls back every password/session/issue/audit/notification/receipt/pointer write.

### 3. Request receipt

`GET /api/v1/admin/users/{userId}/reset-password/requests/{requestId}`

For an applied request, response `200`:

```json
{
  "requestId": "uuid",
  "targetUserId": "uuid",
  "outcome": "applied",
  "secretAvailable": false,
  "current": true,
  "completedAt": "UTC timestamp"
}
```

For a durably rejected CAS request, response `200` uses `outcome: "rejected_state_changed"`, `secretAvailable: false`, `current: false`, and the same `completedAt` field.

If no committed receipt exists for that exact target + request ID, response is deliberately still `200`:

```json
{
  "requestId": "uuid",
  "targetUserId": "uuid",
  "outcome": "unknown",
  "secretAvailable": false
}
```

This avoids teaching any caller that absence/404 proves rejection. A request ID belonging to another target is also reported as `unknown`, so the endpoint does not disclose cross-target activity.

## Request fingerprint

The stored SHA-256 fingerprint is over canonical JSON with this fixed field order:

```json
{
  "actorAdminId": "uuid",
  "targetUserId": "uuid",
  "expectedLastAppliedRequestId": "uuid-or-null",
  "supersedesRequestId": "uuid-or-null",
  "confirmReplacement": "boolean"
}
```

The plaintext password, its hash and timestamps are excluded. An exact request ID is replayable only with the same fingerprint.

## Data model

Add one focused receipt table:

```text
admin_password_reset_requests
  request_id uuid primary key
  actor_admin_id uuid not null references users(id)
  target_user_id uuid not null references users(id)
  expected_last_applied_request_id uuid null
  supersedes_request_id uuid null
  request_fingerprint text not null
  outcome text not null check (outcome in ('pending','applied','rejected_state_changed'))
  completed_at timestamptz null
  created_at timestamptz not null default now()
```

Add one narrowly named nullable pointer:

```text
users.last_admin_password_reset_request_id uuid null
  references admin_password_reset_requests(request_id)
```

`pending` may exist only inside an open transaction: a check requires `completed_at IS NULL` for pending and non-null for terminal outcomes. No committed code path leaves pending. Existing rows need no backfill; null means no reset performed under this protocol.

On successful application, insert the existing `temporary_password_issues` row normally and retain its existing meaning. The receipt does not duplicate the secret or hash and does not pretend a rejected request issued a password.

## Transaction and ordering algorithm

Generate the candidate temporary password and Argon-compatible hash in process memory before taking row locks. Then, in one PostgreSQL transaction:

1. Insert a `pending` receipt by `request_id` with `ON CONFLICT DO NOTHING`, then select that request row `FOR UPDATE`.
2. If a receipt already exists, compare its fingerprint. Mismatch → `IDEMPOTENCY_KEY_REUSED`; remember an exact terminal outcome but do not return it before authorization is rechecked.
3. Reuse `AuthService.lockAdminMutationUsers(actorAdminId, targetUserId, db)`. This locks active admins and target in the existing sorted order and rechecks that the actor is still active admin. A demoted/blocked actor cannot obtain even a replay result through a stale preHandler decision.
4. Read `current = target.lastAdminPasswordResetRequestId` from the locked target. If the exact receipt was already terminal, return its stored outcome now; an applied replay has `secretAvailable=false` and `current` is computed from this locked pointer.
5. For a new request, accept iff either:
   - `current === expectedLastAppliedRequestId`; or
   - this is a confirmed replacement and `current === supersedesRequestId`.
6. Otherwise update this receipt to `rejected_state_changed`, set `completed_at`, commit without touching user/session/issue/audit/notification state, then return 409. The service returns a discriminated result instead of throwing, so this rejection receipt is not rolled back.
7. For an accepted request, update the target password hash, set `must_change_password=true`, set `updated_at`, and set `last_admin_password_reset_request_id=requestId`.
8. Revoke every active target session with `password_reset`, including the caller when target == actor.
9. Insert `temporary_password_issues`, `user.password_reset` audit and the existing access-change notification.
10. Update the receipt to `applied` with `completed_at` and commit.
11. Return the in-memory plaintext only from this first executing call; clear references after serialization.

### Why the replacement order is definitive

Let A be the unknown request, B its separately confirmed replacement, and P the last pointer observed immediately before B. B sends `expected=P`, `supersedes=A`.

- **A locks first:** A applies and pointer becomes A. B then passes the second CAS arm, applies, and pointer becomes B.
- **B locks first:** B passes the first CAS arm, applies, and pointer becomes B. Delayed A later fails its original CAS and is durably rejected.

Therefore B is authoritative in both commit orders. An unrelated reset C changes the pointer to neither P nor A; B rejects and forces a fresh operator decision rather than overwriting C silently.

## Credential-operation serialization

The reset lock alone is insufficient because current login/first-change/change-password code does not share its target-row ordering. Keep the seam inside `AuthService`; do not add a new domain service.

- **Login:** password verification may start outside the transaction. Before session insert, lock the user row, recheck active status and that the locked `passwordHash` equals the hash just verified. If reset committed first, old-password login fails; if login commits first, subsequent reset sees and revokes the new session.
- **First password change / ordinary password change:** hash the proposed password before locking. In a transaction lock the user row first, then the current auth-session row; recheck the session is still active and that the credential state used for authorization is unchanged. If reset committed first, the revoked session cannot overwrite it. If password change commits first, reset waits and then becomes authoritative and revokes the session.
- **Other admin reset:** every request uses the same user-row lock and CAS pointer. Two unrelated requests from the same basis cannot both apply; the loser receives a receipted `RESET_STATE_CHANGED` and must be reconfirmed from fresh state.
- **User login during reset:** login-first creates a session that reset revokes; reset-first changes the hash before login recheck, so old credentials cannot create a post-reset session.

## Self-reset

Self-reset remains allowed and revokes the caller session in the same transaction. On a received success, the client displays the one-time password and immediately invalidates local auth state. On a lost response, that same session cannot use the admin receipt endpoint; the UI must not bypass auth. Another active admin may inspect the known request ID and issue a separately confirmed replacement. If this was the only active admin, recovery is the existing approval-gated operational bootstrap path; no unauthenticated receipt or secret recovery endpoint is introduced.

The self-reset confirmation must state before POST that the current session ends and a lost response may require another admin/operations recovery.

## API compatibility

The path, method and first-success `temporaryPassword` field remain unchanged, and the new success fields are additive. To make the ordering guarantee real, missing `Idempotency-Key` fails closed with `400 IDEMPOTENCY_KEY_REQUIRED`; an old cached client may require refresh but cannot perform an unsafe uncorrelated reset. This is the sole intentional compatibility tightening. Exact replay uses the new discriminated response and never fabricates the legacy secret field.

Deployment order is server first (accept/validate the new contract and safely reject missing keys), then web. No period permits an uncorrelated legacy reset to race a correlated replacement.

## Retention and disclosure

- Receipts and `temporary_password_issues` remain indefinitely retained under the current no-deletion policy, like the related audit record. This specification adds no cleanup job.
- Receipt/state endpoints require an active admin on every call.
- Responses never contain `passwordHash`, plaintext password, session/token/cookie, request fingerprint, IP/user-agent or audit metadata.
- Logs and audit metadata include request ID, actor, target and terminal outcome, never plaintext or password hash.
- Request ID is correlation data, not an authentication token.
