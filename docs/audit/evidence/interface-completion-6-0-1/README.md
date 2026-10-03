# 6.0.1 acceptance supplement

BUG-042 corrects successful login being undone by a failed redundant account read. The login response now commits one destination with password-change, onboarding and safe-return priority. [Focused evidence](focused-receipt.json) records35/35 and an independent review; the source freeze contains426 paths.

The original [6.0.0 receipt](../interface-completion-6/receipt.json) remains historical. Notification deferred callbacks wait for their actual requests; Wave F restart verifies response and persisted state. The hosted mobile onboarding failure was not reproduced locally, and is not incorrectly attributed to the separate network-failure Red. Fresh complete local/hosted/public checks are required.

Physical iPhone, native WebKit and spoken assistive technology remain device limitations; the Google Maps cause remains unconfirmed. D37 invitation deferral and D40 rejection of ten-second Undo are unchanged.

## Full local gate

[Receipt](receipt.json) binds426 frozen source paths to [1884/1884](local-summary.json): quality1617, PostgreSQL119, browser144 (135 journeys plus9 migration checks), cleanup4. Zero failed/skipped/todo/interrupted. Fresh compiled desktop/390/360 runs passed the unchanged onboarding URL/focus assertions. This closes local acceptance only; hosted/public results are recorded separately.
