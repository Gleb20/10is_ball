# Stage 4 WO0/1 checkpoint

Base: Stage 3 public release `8b9d2650f7991e121052634ace758f5991ef25b5`, version `4.1.1`.

WO0 confirmed remote `main`, live web/API release metadata, unchanged Stage 3 JudgePage/test hashes, and unchanged API base blobs. It also records the expected receipt bridge: frozen `docs/PROJECT_STATUS.md` retains the pre-publication snapshot, while separate terminal receipts and live metadata establish public 4.1.1 without a self-SHA commit loop. This is a WO6 documentation residual, not API or behavior drift. The prepared R2 patch survived the fast-forward byte-for-byte.

WO1 changes only the three authorized API paths. It documents the existing complete GET match key/version contract and tests:

- raw point UUIDs and `manual-correction:<UUID>` keys;
- no OpenAPI truncation limit;
- nondecreasing persisted version while HTTP responses may arrive out of order;
- authorized participant reads plus existing outsider/unauthenticated denials;
- raw point-key retention after Undo;
- prefixed correction-key retention after later point/Undo mutations;
- exact agreement between final authorized GET and the persisted PGlite row, with current score checked separately.

Fresh evidence: OpenAPI contract 10/10, GAP-005 integration 13/13, API typecheck PASS, diff check PASS. The accepted R2 patch, the extra key-preservation patch, and the integrated source patch have separate hashes in `checkpoint.json`. Forward/reverse trials used disposable copies only.

This is a contract checkpoint, not full Stage 4 acceptance. No UI, mutation service, reducer, schema, migration, authorization, event-log semantics, version, commit, push, deployment, browser, PostgreSQL concurrency suite, or physical-device check was performed.
