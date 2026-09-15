# Client statechart

Only these states and transitions are allowed.

```text
IDLE
  └─ open reset → PREFLIGHT

PREFLIGHT
  ├─ GET state 200 → CONFIRM(expected pointer)
  └─ GET/auth error → BLOCKED_READ (Retry GET only)

CONFIRM
  ├─ cancel → IDLE
  └─ confirm → persist non-secret {requestId, expected pointer} in sessionStorage
                 → SUBMITTING(request A)

SUBMITTING(A)
  ├─ 200 applied + secretAvailable=true → APPLIED_SECRET_VISIBLE
  ├─ 200 applied + secretAvailable=false → APPLIED_SECRET_LOST
  ├─ 409 rejected_state_changed → REJECTED
  ├─ received 400/403/404/409 reused → REJECTED_OR_AUTH_BLOCKED by exact code
  └─ timeout/network/aborted response/ambiguous 5xx → UNKNOWN(A)

UNKNOWN(A)
  └─ GET receipt(A)
       ├─ applied,current=true  → APPLIED_SECRET_LOST
       ├─ applied,current=false → SUPERSEDED_BY_LATER_RESET
       ├─ rejected_state_changed → REJECTED
       ├─ unknown → UNRESOLVED(A)
       └─ 401/403/network → UNRESOLVED_AUTH_BLOCKED(A)

UNRESOLVED(A)
  ├─ close → retain non-secret request context; no mutation
  └─ choose “Выдать новый пароль” → fresh GET state → REPLACEMENT_CONFIRM(A, P)

REPLACEMENT_CONFIRM(A, P)
  ├─ cancel → UNRESOLVED(A)
  └─ confirm named consequences → new request B with
       expectedLastAppliedRequestId=P,
       supersedesRequestId=A,
       confirmReplacement=true
       → SUBMITTING(B)

APPLIED_SECRET_VISIBLE
  └─ close/copy → secret irrecoverably discarded; local auth invalidated on self-reset

APPLIED_SECRET_LOST
  ├─ no retry of same request
  └─ separately confirmed replacement follows the same B flow

REJECTED
  └─ reopen from fresh PREFLIGHT with a new request ID; never resubmit old payload blindly
```

Rules:

- The client creates and stores `requestId` and preflight pointer before POST. Storage contains no password and is cleared after a terminal received outcome or explicit operator dismissal; unresolved context survives route remount in the same tab.
- A receipt `unknown` never enables retry of A. The only mutation from that state is a newly confirmed B that supersedes A.
- If B becomes unknown, B replaces A as the immediate unknown request; any later C supersedes B after a fresh preflight.
- If receipt A is applied but not current, the UI says a later reset already replaced it and does not attribute that later reset to A.
- Generic Retry controls perform GET only. No automatic POST exists in any state.
- A 401 after self-reset moves to `UNRESOLVED_AUTH_BLOCKED`; it never opens a public receipt path.
