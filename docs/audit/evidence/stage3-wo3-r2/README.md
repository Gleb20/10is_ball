# Stage 3 WO3 R2 — finite readback version correction

This bounded correction starts from frozen WO3 R1 manifest
`/private/tmp/tab10-wo3-freeze-fst0hwkm/manifest.json` (SHA-256
`5a9696df290b6dfbbfb45370047a79f38eb6da58b817a30b0d5dd6320a0404aa`).
WO3 R1, WO2 and WO1 evidence and logs remain unchanged. No WO4 runtime run or
product implementation occurred during this correction.

Terra found that `Number(undefined)` and `Number("invalid")` become `NaN`; the
former comparison `freshVersion < generatedVersion` was false for `NaN`, so a
confirmed POST at version 5 could close its Dialog after a readback without a
valid version. A table regression gave **Red: 2 failed / 11 passed**: missing
and nonnumeric GET versions incorrectly closed the Dialog; older version 4
already stayed blocked. Raw Red: `/private/tmp/tab10-wo3-r2-red.log`.

The primary readback now requires a finite GET version at least as new as the
positive version returned by POST. A later explicit state check uses the same
finite-version condition. The table test covers missing, nonnumeric and older
GET versions: the Dialog remains open with the confirmed-write message,
Confirm stays disabled, and there is one bracket POST. A further explicit GET
with version 5 closes the Dialog and shows the updated bracket. The existing
unknown-POST test still keeps retry blocked after GET.

Focused algorithm tests: **13/13**; the entire web suite passed **287/287** in
42 files. Web typecheck and docs audit passed (169 files, no broken links,
anchors or backlog definitions); `git diff --check` passed. Raw logs are under
`/private/tmp/tab10-wo3-r2-*` and are linked by the external handoff receipt.
The accepted WO3 R1 visual browser evidence remains applicable because R2
changes only readback version validation and its component regression. No new
browser, PostgreSQL, full Stage 3 CI, public mutation, physical iPhone, WebKit,
spoken AT, version change, commit, push or deployment was performed for R2.
