# TOURNAMENT source review

Frozen baseline: base `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221`; GAP-012 r6 source fingerprint `8e8762575a07e71a17192da327cbe1b5906ca33c1c2ef762c0f9a37463b94cb3`; candidate state local accepted 1257/1257, unpublished. Source inspection is corroboration, not browser evidence.

- `TournamentsPage.tsx`: defaults `organizerParticipates=true`, `requireParticipantConsent=false`; creation uses existing responsive single-column shell.
- `TournamentDetailPage.tsx`: settings → policy note → lifecycle actions → roster → matches → bracket → summary. Registered add always calls native `window.confirm`; cancel, dissolve and participant withdraw call mutation without a preceding named confirmation. Summary is rendered whenever DTO contains it rather than only in terminal states.
- `TournamentBracket.tsx`: separate winner/loser/third-place bands; visible BYE cards; scroll region is keyboard focusable and supports Arrow/Home/End. Zoom values start at 100% and only increase to 125/150.
- API/service behavior observed, not inferred: outsider/participant write errors are 403; post-start add is 400 with unchanged participants/bracket version; cancel→cancelled; dissolve→collecting with roster; generated withdraw→needs_regeneration; stop/finish summaries remain authoritative.

Known shared findings were not duplicated: BUG-018/019/020/023 cover picker keyboard/focus/geometry/search; BUG-021/022 cover dialog-local error and pending semantics. This package used pointer/touch for picker journeys and did not claim those issues fixed.

Discarded harness attempts: macOS denied the first sandboxed Chromium launch; that pre-browser attempt left synthetic labels which exposed a harness collision, so the runner added a unique run suffix. Subsequent harness-only corrections used the real band aria-name («Победители»), mapped the actual participant DTO through `userId`, and scored until `pending_confirmation` instead of assuming 1:0 satisfied the two-point margin. In the final recheck series, one attempt used `127.0.0.1` although preview listened on `localhost`, and two attempts expected inaccurate Russian strings for outsider error and regeneration status. All produced only disposable synthetic records, no accepted run result, and were replaced by final T-RUN-001…007. No user timing or behavior was inferred from automation retries.
