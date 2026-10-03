# Stage 4 WO2 frozen source checkpoint

- Base and `origin/main`: `8b9d2650f7991e121052634ace758f5991ef25b5`
- Product version baseline: `4.1.1`
- Scope: `JudgePage.tsx`, `JudgePage.test.tsx`, `judgeScoreRecovery.ts`, `judgeScoreRecovery.test.ts`
- No commit, push, deploy, migration, version change, API source change, shared-style change or production mutation was performed.

## Behavior covered

- actor/match-scoped versioned `sessionStorage` correlation with SPA-memory fallback;
- durable intent and transition writes before POST;
- separate ordered unsent intents and sent attempts with immutable key, side and expected version;
- fresh mount generations and late-callback rejection;
- nondecreasing shared authoritative reads for init, live refresh and recovery;
- restored sends become unknown and require a fresh GET, with zero POST replay;
- exact raw-key matching resolves only the matching attempt;
- mutation errors pause the queue until explicit continue or confirmed discard;
- no-key acceptance performs zero POSTs and retains the attempt;
- the next explicit point uses a new UUID and the reviewed version as a CAS fence;
- storage faults and corrupt records fail closed without deleting correlation;
- Undo, correction and Finish remain blocked while recovery is unresolved;
- release, handover and lost ownership do not act as outcome proof.

## Verification

- Focused: 2 files, 58 tests passed.
- Web package: 43 files, 312 tests passed.
- Web typecheck: passed.
- `git diff --check`: passed.
- Reverse rollback applicability: `git apply --check --reverse .../rollback.patch` passed.
- WO1 API source hashes remain `6f6624...`, `cb972a...`, and `5dccc5...` as recorded in `wo1-integrity-sha256.txt`.

Browser and real PostgreSQL ordering checks, repository-wide acceptance, integration commit/push/deploy and product versioning remain deferred to the Stage 4 integration gate as required by the work order.

The earlier `helper-checkpoint` remains immutable. Its later review finding about cached read decisions was corrected in the final source and covered by the remount regression test; final hashes supersede that helper checkpoint for WO2 acceptance.
