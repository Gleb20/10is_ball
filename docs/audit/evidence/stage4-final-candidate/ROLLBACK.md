# Rollback receipt

`rollback.patch` reverses the application, test, version, and canonical-document
delta represented by `candidate-forward.patch`. The final evidence directory is
excluded from both patches and can be removed separately only when preserving it
is no longer required.

Validation procedure:

1. Copy the current checkout to a disposable directory.
2. Apply `rollback.patch` with `git apply --check`, then `git apply`.
3. Compare every reverted tracked file with base
   `8b9d2650f7991e121052634ace758f5991ef25b5` and confirm candidate-only untracked
   files are absent.
4. Apply `candidate-forward.patch` with `git apply --check`, then `git apply`.
5. Compare the restored paths with the frozen candidate manifest, allowing only
   the documented post-gate documentation finalization.

This is a source rollback receipt. It does not authorize a public rollback,
history rewrite, database down-migration, or data restore.
