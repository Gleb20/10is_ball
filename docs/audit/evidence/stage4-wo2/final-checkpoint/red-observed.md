# WO2 observed Red evidence

These failures were observed before the corresponding implementation in this task.

## Pure recovery store

Command:

`pnpm --dir apps/web test -- judgeScoreRecovery.test.ts`

Exit: `1`

Observed failure:

`Failed to resolve import "./judgeScoreRecovery" from "src/pages/judgeScoreRecovery.test.ts". Does the file exist?`

The suite could not collect because the recovery helper did not exist.

## JudgePage integration

Command:

`pnpm --dir apps/web test -- JudgePage.test.tsx`

Exit: `1`

Observed summary:

`Test Files 1 failed (1)`

`Tests 3 failed | 37 passed (40)`

The new failures were:

- version-conflict recovery did not keep point controls blocked;
- restored `sending` correlation had no recovery region and therefore no GET-first recovery decision;
- an exact-key recovery did not expose explicit continuation for the retained queued tap.

The final retained suites and exact Green logs are in `logs/focused-green.log` and `logs/web-tests.log`.
