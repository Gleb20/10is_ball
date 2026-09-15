# RESULTS source evidence map

Baseline: `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221` + exact GAP012r6 candidate tree.

| Evidence | Source seam | What it establishes |
|---|---|---|
| History row content | `apps/web/src/pages/HistoryPage.tsx:45-60,281-294` | Match rows expose score/result/status but not counterpart, date, role or format. |
| History state | `apps/web/src/pages/HistoryPage.tsx:66-94,132-160,211-239` | Search/filter/pagination are component/session state; detail return is restored, but route query is unchanged. |
| Notification actual filter | `apps/web/src/pages/NotificationsPage.tsx:95-145,255-291` | Visible set depends on stale local lifecycle `new`; batch read updates `readAt` without changing lifecycle. |
| Profile validation | `apps/web/src/pages/ProfilePage.tsx:262-292` | Editable fields do not expose the server length limits or field-level invalid association. |
| Profile session revoke | `apps/web/src/pages/ProfilePage.tsx:350-373` | Current/other session distinction, confirmation and pending controls are present. |
| Reauthentication | `apps/web/src/auth-recovery.test.tsx:40-145` | Same actor keeps draft, different actor clears protected state, failed mutation is not replayed. |
| Historical judge label | `apps/api/src/modules/home/home-service.ts:203-218` | Home chooses the latest judge session even if released; it is not proof of the current auth-session judge right. |
| Home inventory/order | `apps/web/src/pages/HomePage.tsx:145-225,255-345` | All five metrics, rival, action, active events, notification/profile entries, ranking period and recent events exist; current order is metrics-first. |
| Ranking response race guard | `apps/web/src/pages/RankingsPage.tsx:38-66` | Superseded period/team responses are discarded by effect cleanup. |

This map is source evidence, not a substitute for the browser observations in `runtime/runtime-facts.json` and screenshots.
