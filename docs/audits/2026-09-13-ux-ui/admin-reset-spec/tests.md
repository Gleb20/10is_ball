# Acceptance and PostgreSQL ordering tests

All mutations use synthetic users and disposable PostgreSQL. Response-only assertions are insufficient: verify password behavior, active sessions, current pointer, request receipts, temporary issues, audit and notifications.

## Contract GWT

### RST-001 — committed response loss

**Given** request A has a fresh expected pointer and its transaction commits.  
**When** the HTTP response is lost and the client GETs receipt A.  
**Then** receipt A is `applied`, `secretAvailable=false`; old password and all prior sessions fail; exactly one issue/audit/notification exists; no POST retry occurs.

### RST-002 — no observed receipt

**Given** A is delayed or rolled back before commit.  
**When** receipt GET finds no exact committed target/request row.  
**Then** response is `outcome=unknown`; UI does not claim rejection and does not retry A.

### RST-003 — exact replay

**Given** A applied.  
**When** the same actor replays A with the exact fingerprint.  
**Then** 200 reports applied with `secretAvailable=false`; password hash, pointer, sessions, issue/audit/notification counts do not change.

### RST-004 — key reuse

**Given** request ID A exists.  
**When** actor/target/basis/supersedes/confirmation differs.  
**Then** 409 `IDEMPOTENCY_KEY_REUSED`; no target or receipt mutation occurs.

### RST-005 — unrelated state change

**Given** B was prepared from pointer P and another reset C becomes current.  
**When** B submits with expected P and does not supersede C.  
**Then** B is durably `rejected_state_changed`; C stays current; no B issue/audit/notification/session revocation occurs.

### RST-006 — self-reset

**Given** active admin resets their own account.  
**When** reset commits.  
**Then** the caller session is revoked with all others; a received response exposes the secret once. If lost, the same session gets 401 and no unauthenticated receipt path exists; another active admin can read the non-secret receipt.

### RST-007 — actor changes during request

**Given** requireAdmin passed, then actor is blocked or demoted before the reset transaction locks users.  
**When** reset rechecks `lockAdminMutationUsers`.  
**Then** 403, no receipt/password/pointer/session/issue/audit/notification write.

### RST-008 — atomic rollback

**Given** an injected failure at issue, audit or notification insertion.  
**When** A executes.  
**Then** the transaction rolls back receipt, password, pointer and session revocation together; GET A returns unknown and does not imply rejection.

## PostgreSQL both-order tests

### PG-RST-001 — A commits before replacement B

**Given** P is current, A expects P, and B is confirmed with expected P + supersedes A.  
**When** A holds the user lock first and commits before B.  
**Then** A applies, B subsequently passes the supersedes arm, B is final pointer/current password; both applied receipts exist, two reset audits exist, all sessions are revoked; only B's returned secret authenticates.

### PG-RST-002 — replacement B commits before delayed A

**Given** the same inputs.  
**When** B holds the user lock first.  
**Then** B applies and becomes pointer; delayed A is `rejected_state_changed`, creates no issue/audit/notification and cannot invalidate B's secret.

### PG-RST-003 — concurrent unrelated resets

**Given** A and C are separately confirmed from the same pointer P and neither supersedes the other.  
**When** transactions race.  
**Then** exactly one applies; the other has a committed rejected receipt. Final hash/issue/audit/notification belong to the winner only.

### PG-RST-004 — duplicate request race

**Given** two concurrent POSTs with identical request ID and fingerprint.  
**When** both reserve/select the receipt row.  
**Then** one executes once; the other waits and returns applied without secret. No duplicate write exists.

### PG-RST-005 — login first, reset second

**Given** old credentials are valid.  
**When** login locks the target and inserts a session before reset.  
**Then** reset waits, changes the hash and revokes that new session; the session cannot survive reset.

### PG-RST-006 — reset first, login second

**Given** login verified the old hash before taking its transaction lock.  
**When** reset commits first.  
**Then** login's locked hash recheck fails and no session is inserted.

### PG-RST-007 — first-password change first, reset second

**Given** a valid temporary session.  
**When** first-change commits before reset.  
**Then** reset waits, becomes final credential, sets must-change true and revokes the first-change session.

### PG-RST-008 — reset first, preauthorized first-change second

**Given** first-change passed HTTP preHandler before reset.  
**When** reset commits and revokes the session before first-change takes its user/session locks.  
**Then** first-change recheck rejects the revoked session and cannot overwrite the reset hash.

### PG-RST-009 — ordinary password change both orders

Repeat PG-RST-007/008 with ordinary change-password. The final operation follows lock order; a preauthorized but revoked session never overwrites reset.

### PG-RST-010 — replacement chain

**Given** A unknown, B unknown after attempting to supersede A, and fresh preflight returns pointer P2.  
**When** C is confirmed with expected P2 + supersedes B while A/B arrive in every order.  
**Then** C is final whenever no unrelated reset changes the pointer; every late predecessor is applied-before-and-replaced or rejected-after-C, never authoritative after C.

## API/browser checks after implementation

- OpenAPI requires UUID `Idempotency-Key`, documents the response union and both GET routes.
- Old cached UI receives a bounded `IDEMPOTENCY_KEY_REQUIRED` without mutation; refresh loads the correlated flow.
- 360/390/1440 UI covers pending, applied secret, applied secret lost, unknown, rejected, auth-blocked and replacement confirmation; Escape/cancel never submit.
- Network abort before commit, after commit and during receipt GET; count POSTs and assert generic Retry is GET-only.
- One-time secret is absent from DB, logs, screenshots, receipts, audit meta and browser persistence.
