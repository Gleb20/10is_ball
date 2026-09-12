# BUG-010 — self-challenge

## Scope

- MATCH-003 and AT-MATCH-013 distinct registered-user invariant.
- Ranking CTA guard and `/matches/new` query-prefill defense.
- Server no-write validation already delivered by DATA-001.

## Red

1. Render a ranking with the authenticated user on the podium and a rival.
2. Expect no `Вызов` within the self card and a working CTA within the rival card.
3. Open `/matches/new?opponentId=<current-user>` and expect a local rejection
   before `api.createMatch`.

Both new UI expectations failed before implementation; the existing API
`self versus self` case in `match-validation.integration.test.ts` stayed green.

## Green / regression

- `RankingsPage.test.tsx`: self CTA absent; rival CTA keeps encoded destination.
- `MatchCreatePage.test.tsx`: forged self query is cleared, explained inline and
  does not call the API on submit.
- `match-validation.integration.test.ts`: duplicate/self registered roster
  returns `400 VALIDATION` and leaves match/participant tables empty.
- Browser: local disposable actor on desktop 1280×800 and mobile 390×844; self
  card visible without CTA, rival CTA retained, forged URL remains on the form
  with no create/navigation.

## Gates

- Focused web tests and web typecheck.
- Full repository `pnpm run ci` because MATCH create spans UI/API trust layers.
- Production release/smoke requires separate approval and is not part of this
  work item.
