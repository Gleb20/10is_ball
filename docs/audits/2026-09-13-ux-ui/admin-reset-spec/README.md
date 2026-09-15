# BUG-038 reset recovery specification

Status: **READY_FOR_REVIEW**. This is one bounded contract proposal for root/Terra acceptance. It is not implementation evidence and does not make BUG-038 ready by itself.

Read order:

1. `contract.md` — the single API/data/transaction proposal.
2. `statechart.md` — exact client states and allowed transitions.
3. `tests.md` — GWT and PostgreSQL both-order acceptance.
4. `source-evidence.md` — inspected current seams and constraints.
5. `handoff.md` — review checklist and explicit residual decisions.

No application, canonical documentation, database, runtime or previously frozen `admin/**` artifact was changed. No plaintext temporary password is stored or made recoverable.
