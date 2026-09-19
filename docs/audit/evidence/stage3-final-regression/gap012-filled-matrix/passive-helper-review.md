# GAP-012 passive capture handoff

Scope: diagnostic harness only. No product fix, new full-suite run, backend change, or stand mutation is authorized by these artifacts. The c870 source/stand writer remains Sol. This agent wrote only the two named files under `/private/tmp` and did not run browser/tests/DB.

Helper: `/private/tmp/tab10-gap012-passive-helper.ts`, exported function `installTab10Gap012PassiveCapture`. It has no imports or outside runtime dependencies; pass the function itself plus its serializable argument to `page.addInitScript`. Do not pass a string containing TypeScript.

## Integrate without changing the critical order

1. Remove the previous init observer and `autocompleteDiagnostics` call from this diagnostic path. Retain `collectPageErrors`; harness failures must not be suppressed from the test. Copy/import the new function in the bounded test-only scope approved by root.
2. Install before `login`/`goto`. The function observes `document`, which exists at document-start, rather than assuming `document.documentElement` or `body` exists. Every browser callback is guarded; a diagnostic failure is reported in `diagnosticErrors` or `installationFailed`, not swallowed as a successful capture.

```ts
await page.addInitScript(installTab10Gap012PassiveCapture, {
  inputLabel: "Игрок A",
  expectedOptionLabel: playerA.label, // synthetic fixture only
  maxEvents: 400,
});
let createOptionsStatus: number | null = null;
const observeResponse = (response: import("@playwright/test").Response) => {
  if (new URL(response.url()).pathname === "/api/v1/matches/create-options") {
    createOptionsStatus = response.status();
  }
};
page.on("response", observeResponse);
```

3. Keep the original preceding form actions. Construct both locators before the critical pair. There must be NO awaited snapshot, readiness assertion, response wait, evaluate, frame wait, sleep, or retry between these two actions. Do not add `force` or change the existing action/test timeout to obtain a green result.

```ts
const playerAInput = page.getByRole("combobox", { name: "Игрок A", exact: true });
const playerAOption = page.getByRole("option", { name: playerA.label, exact: true });
let selectionFailed = false;
try {
  await playerAInput.fill(playerA.label);
  await playerAOption.click();
} catch (error) {
  selectionFailed = true;
  throw error; // preserve the original failure
} finally {
  // First additional awaited browser operation is AFTER attempted selection.
  // Do not await createOptionsResponse/json()/requestAnimationFrame first.
  let capture: unknown;
  try {
    capture = await page.evaluate(() => {
      const recorder = (window as unknown as {
        __tab10Gap012Passive?: { stopAndRead: () => unknown };
      }).__tab10Gap012Passive;
      return recorder?.stopAndRead() ?? { captureUnavailable: true };
    });
  } catch {
    capture = { captureUnavailable: true }; // e.g. page/context already closed
  }
  const project = info.project.name.replace(/[^a-z0-9_-]+/gi, "-");
  const filename = "gap012-passive-" + project + "-repeat" + info.repeatEachIndex + "-retry" + info.retry + ".json";
  const diagnostic = { version: 1, project, selectionFailed, createOptionsStatus, capture };
  // writeFile/Buffer are Node-side test helpers, NEVER used inside init/evaluate.
  const artifactPath = info.outputPath(filename);
  await writeFile(artifactPath, JSON.stringify(diagnostic, null, 2) + "\n");
  await info.attach(filename, { path: artifactPath, contentType: "application/json" });
  page.off("response", observeResponse);
}
```

Use the existing outer cleanup. Ensure diagnostic persistence errors do not replace an already-recorded selection error; retain/report both if writing or attachment fails. If the entire test times out before `finally` can finish, a scoped `afterEach` may perform the same capture while the page is still alive, with a synchronous `captureWritten` flag preventing duplicate output. Do not increase timeouts or start a polling loop for this purpose. A closed page/crashed browser cannot be promised to produce an in-page trace; report `captureUnavailable`, not invented evidence.

For the existing external diagnostic directory, additionally write the same safe JSON to a filename including the sanitized project, scenario, repeat index and retry index. Never let desktop/mobile overwrite one shared path. `info.outputPath` already separates test output directories. A scenario name in the narrow probe must also appear in its filename.

## What is observed

- Only the targeted synthetic combobox query equality/length is recorded. Other inputs, labels, values, text, IDs, auth headers, storage, payloads and credentials are not captured. Node descriptions contain a WeakMap token, tag and role.
- Focus/blur/beforeinput/input/pointerdown/mousedown/scroll/resize are passive capture listeners. No focus, typing, scroll, network, keyboard, or click action is performed by the helper.
- Target listbox/option additions and removals are observed, including an option that appears after fill and disappears during click autoscroll. `aria-expanded` records old value and the next value reconstructed from the next matching mutation or current DOM; `currentValueAtDelivery` is separately labelled.
- Input and exact-option rectangles, active node token, effective clipping and chosen scroll container are captured. The h$ DOM seam is `input -> x1 control -> controlRef S -> y1 root`. Clipping starts at `root.parentElement`, uses only computed `overflowY`, and intersects ancestor bounds with visualViewport minus the safe-bottom inset, with the same 12px outside test. Treat `vendorDOMShapeMatches=false` or `safeBottom=null` as incomplete geometry evidence.
- A single hidden fixed zero-size probe measures `env(safe-area-inset-bottom)` once a body exists. It is not focused and is removed after capture. It creates no layout space; its own mutation is not an option mutation. All layout reads/instrumentation still have overhead: a non-reproduction under capture is not proof the race is absent.
- `directoryDOM` includes loading presence, suggestions rectangle/height and button counts for frequent/recent/team groups. Changes are reported as `target-dom-commit-observed`. This is MutationObserver **delivery time**, not an exact React commit timestamp. Event snapshots provide the ready/loading state at focus/beforeinput/input as stronger ordering bounds.
- Resource timing reports only the create-options path's numeric timing/status. The synchronous Node response listener supplies actual HTTP status where browser `responseStatus` is absent/zero. No response body is needed for capture.
- Buffer keeps the first 200 or 400 events, plus `dropped`, `diagnosticErrors`, and a final snapshot. Nonzero dropped means the trace is incomplete; it is not a successful absence-of-event assertion. The final capture drains pending mutation records, then disconnects all listeners/observers.

## Required controlled fixture: nonempty suggestion groups

Root found a material fixture difference: the full suite had admin-owned teams/history before GAP-012. Its successful diagnostic showed input document Y 956, then a +326px ready-layout insertion, with window scroll 224 -> 550 and input viewport Y 732 retained. Ten narrow probes on a fresh database reached only scroll 212. Empty create-options groups therefore do not reproduce the same layout boundary.

For narrow discrimination, keep the same users/labels and viewport and serve one schema-valid create-options response with **all three groups nonempty**, using existing synthetic player IDs from that response. The type is `{ users, teams: [{ id, name, userIds }], recentOpponentIds, frequentOpponentIds }`. Preserve `users`; use existing active non-admin fixture IDs in the two ID arrays and team membership. Team ID/name may be synthetic UI fixture values in this route-only response; no persistent team creation is required. Do not log the payload or broaden backend queries/cache/limits.

Match the observed group counts/button wrapping and ready-region height as closely as evidence allows, and record the actual numeric height. Merely setting arrays nonempty does not prove an equivalent 326px layout shift. An empty-groups response is a useful one-variable control, not the primary reproduction fixture. There is no need to replay the preceding 60 tests to obtain this UI condition.

## Small decisive phase scenarios, no full-suite authorization

Use one narrow first-player flow, the controlled nonempty payload above, and an event-driven held route. No arbitrary millisecond sleeps. Preserve the unmodified fill->click pair for the original-order baseline; split actions only in explicitly named diagnostic phase cases.

| Scenario | Scheduling | Evidence required to classify it |
| --- | --- | --- |
| Before focus | Release the response and, in this named control only, observe the suggestions DOM before focusing/filling. | Focus event snapshot already has all groups; input token is unchanged. |
| Between focus and input | Focus the input, release response, observe the ready DOM, then fill and immediately click. | Focus snapshot loading; beforeinput/input snapshot ready. No intervening blur/remount. This deliberately splits the interaction; it is not a replacement production test. |
| Release requested on input | A one-shot capture input listener for this field calls a scenario-only exposed binding that releases the held route. Do not block/cancel input or await the binding in the browser listener. | Label by **observed** commit order. A request released on input often commits after fill; do not falsely name that an in-input DOM commit. |
| After fill | Await fill, synchronously resolve the held route gate in Node, immediately await option.click; no intervening browser snapshot/readiness await. | Response was withheld throughout fill. Keep capture through the click attempt and first resulting scroll/option removal. |

Only fixture construction and explicit phase gates differ; don't refocus/type/click a second time to rescue a failed selection. Register any one-shot binding/listener before the critical action. Remove it after that scenario. Gate routing uses the same prepared payload in every case. Resource responseEnd is not DOM readiness. If mutation delivery and input occur within an interval that cannot be ordered, report the phase as indeterminate rather than infer from `route.fulfill` invocation.

Decisive close signature: expected query retained + same focused input token + no blur/outside mousedown + `aria-expanded true -> false`, with a scroll and `outsideMargin12=true` at that boundary. Also distinguish option never mounted from option mounted and removed after click-associated scrolling. A later settled snapshot with the input back in bounds does not exclude an earlier transient outside measurement. These remain source-derived hypotheses until the trace demonstrates the ordering.

## Acceptance and provenance

Before trusting a narrow result, require `installationFailed` absent, `diagnosticErrors=0`, complete capture for the critical interval, and no new browser pageerror. Original application assertions and pageErrors assertion remain. A fixture/phase run passing only proves that specific run. No source cause or product fix is accepted from this artifact alone.

The helper was source-reviewed here; browser/runtime/typecheck were not run. Sol/root own the bounded runtime verification and any subsequent decision. No new full suite or product patch is requested by this handoff.
