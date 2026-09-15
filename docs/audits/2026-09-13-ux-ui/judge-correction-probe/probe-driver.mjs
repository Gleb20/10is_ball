import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, request } from "@playwright/test";

const baseURL = process.env.TAB10_E2E_BASE_URL;
const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const outputDir = process.env.CORRECTION_PROBE_OUTPUT;
const candidateSourcePath = process.env.CANDIDATE_SOURCE_PATH;
const sourceRoot = process.env.PROBE_SOURCE_ROOT;
if (!baseURL || !adminEmail || !adminPassword || !outputDir || !candidateSourcePath || !sourceRoot) {
  throw new Error("Missing correction-probe runtime inputs");
}

const screenshotsDir = path.join(outputDir, "screenshots");
await mkdir(screenshotsDir, { recursive: true });
const assert = (value, message) => {
  if (!value) throw new Error(`ASSERT: ${message}`);
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = async (file) => JSON.parse(await readFile(file, "utf8"));

const candidate = await json(candidateSourcePath);
const mismatches = [];
for (const [relative, expected] of Object.entries(candidate.sha256)) {
  try {
    const actual = sha256(await readFile(path.join(sourceRoot, relative)));
    if (actual !== expected) mismatches.push(relative);
  } catch {
    mismatches.push(relative);
  }
}
assert(candidate.file_count === 323, "candidate file count");
assert(candidate.source_content_fingerprint === "8e8762575a07e71a17192da327cbe1b5906ca33c1c2ef762c0f9a37463b94cb3", "candidate fingerprint");
assert(mismatches.length === 0, `source hash mismatches: ${mismatches.slice(0, 5).join(", ")}`);
await writeFile(path.join(outputDir, "source-provenance.json"), `${JSON.stringify({
  status: "PASS",
  head: candidate.head,
  candidate: candidate.candidate,
  fileCount: candidate.file_count,
  verifiedFiles: Object.keys(candidate.sha256).length,
  sourceContentFingerprint: candidate.source_content_fingerprint,
  sourceExportManifestSha256: candidate.source_export_manifest_sha256,
  sourceRoot: "owned disposable copy of accepted frozen source",
  mismatches: [],
}, null, 2)}\n`);

let sequence = 0;
async function mutationHeaders(api, key = randomUUID()) {
  const storage = await api.storageState();
  const csrf = storage.cookies.find(({ name }) => name === "tab10_csrf");
  return {
    ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf.value) } : {}),
    "idempotency-key": key,
  };
}

async function mutate(api, endpoint, data = {}, method = "POST", expected = [200, 201]) {
  const response = await api.fetch(endpoint, {
    method,
    data,
    headers: await mutationHeaders(api),
  });
  const body = await response.json().catch(() => ({}));
  assert(expected.includes(response.status()), `${method} ${endpoint} -> ${response.status()} ${body.code ?? body.message ?? ""}`);
  return body;
}

async function createUser(admin, firstName) {
  const suffix = `${firstName.toLowerCase()}-${Date.now()}-${++sequence}`.replace(/[^a-z0-9-]/g, "u");
  const created = await mutate(admin, "/api/v1/admin/users", {
    email: `${suffix}@correction-probe.test`,
    firstName,
    lastName: "Синтетический probe",
    role: "user",
  });
  const newPassword = `${randomBytes(12).toString("hex")}Aa1!`;
  const api = await request.newContext({ baseURL, userAgent: `tab10-correction-probe-${sequence}` });
  await mutate(api, "/api/v1/auth/login", { email: created.user.email, password: created.temporaryPassword });
  await mutate(api, "/api/v1/auth/password/first-change", { newPassword });
  await mutate(api, "/api/v1/me/onboarding", { action: "complete" }, "PATCH");
  return { api, user: created.user };
}

async function getMatch(api, matchId) {
  const response = await api.get(`/api/v1/matches/${matchId}`);
  const body = await response.json();
  assert(response.ok(), `GET match -> ${response.status()}`);
  return body.match;
}

async function createOwnedLiveMatch(creator, playerA, playerB, title) {
  const created = await mutate(creator.api, "/api/v1/matches", {
    title,
    format: "1v1",
    pointsToWin: 11,
    mercyEnabled: false,
    mercyPoints: null,
    firstServerMethod: "manual",
    source: "manual",
    sendPlayerInvitations: false,
    participants: [
      { side: "A", userId: playerA.user.id },
      { side: "B", userId: playerB.user.id },
    ],
  });
  const match = created.match;
  const sideA = match.participants.find(({ side }) => side === "A");
  await mutate(creator.api, `/api/v1/matches/${match.id}/start`, { firstServerParticipantId: sideA.id });
  await mutate(creator.api, `/api/v1/matches/${match.id}/judge/acquire`, {});
  await mutate(creator.api, `/api/v1/matches/${match.id}/judge/setup`, {
    firstServerParticipantId: sideA.id,
    swapSides: false,
  });
  const ready = await getMatch(creator.api, match.id);
  await mutate(creator.api, `/api/v1/matches/${match.id}/points`, {
    side: "A",
    expectedVersion: ready.version,
  });
  return getMatch(creator.api, match.id);
}

function sideMap(match) {
  return new Map(match.participants.map(({ id, side }) => [id, side]));
}

function matchState(match) {
  const sides = sideMap(match);
  return {
    status: match.status,
    version: match.version,
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    currentServerSide: sides.get(match.currentServerParticipantId) ?? null,
    manualCorrectionKeyCount: (match.idempotencyKeys ?? []).filter((key) => key.startsWith("manual-correction:")).length,
    manualCorrectionEventCount: (match.eventLog ?? []).filter(({ type }) => type === "manual_correction").length,
  };
}

function correctionEvent(match, prefixedKey) {
  const sides = sideMap(match);
  const event = (match.eventLog ?? []).find(({ type, idempotencyKey }) => type === "manual_correction" && idempotencyKey === prefixedKey);
  if (!event) return null;
  return {
    type: event.type,
    idempotencyKey: event.idempotencyKey,
    from: {
      scoreA: event.from.scoreA,
      scoreB: event.from.scoreB,
      currentServerSide: sides.get(event.from.currentServerId) ?? null,
    },
    to: {
      scoreA: event.to.scoreA,
      scoreB: event.to.scoreB,
      currentServerSide: sides.get(event.to.currentServerId) ?? null,
    },
  };
}

async function openCorrection(page, scoreA, scoreB, serverParticipantId) {
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page.getByRole("button", { name: "Исправить счёт и подачу", exact: true }).click();
  await page.getByRole("region", { name: "Ручная коррекция", exact: true }).waitFor();
  await page.getByLabel("Счёт стороны A", { exact: true }).fill(String(scoreA));
  await page.getByLabel("Счёт стороны B", { exact: true }).fill(String(scoreB));
  await page.getByRole("combobox", { name: "Текущий подающий", exact: true }).selectOption(serverParticipantId);
}

async function uiState(page) {
  const correction = page.getByRole("region", { name: "Ручная коррекция", exact: true });
  const open = await correction.count() === 1;
  return {
    correctionOpen: open,
    alert: await page.locator('[role="alert"]').allInnerTexts(),
    displayedScore: await page.locator(".judge-side__score").allInnerTexts(),
    displayedServe: await page.locator(".judge-serve-badge:not(.judge-serve-badge--empty)").allInnerTexts(),
    draft: open ? {
      scoreA: await page.getByLabel("Счёт стороны A", { exact: true }).inputValue(),
      scoreB: await page.getByLabel("Счёт стороны B", { exact: true }).inputValue(),
      serverLabel: await page.getByRole("combobox", { name: "Текущий подающий", exact: true }).locator("option:checked").innerText(),
    } : null,
    saveLabel: open ? await page.getByRole("button", { name: /Сохранить коррекцию|Сохраняем…/ }).innerText() : null,
    saveDisabled: open ? await page.getByRole("button", { name: /Сохранить коррекцию|Сохраняем…/ }).isDisabled() : null,
  };
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(screenshotsDir, `${name}.png`), fullPage: false });
}

const admin = await request.newContext({ baseURL, userAgent: "tab10-correction-probe-bootstrap" });
const healthResponse = await admin.get("/health");
assert(healthResponse.ok(), "health");
const health = await healthResponse.json();
assert(health.release?.environment === "test", "runtime environment test");
assert(health.release?.sha === candidate.head, "runtime SHA matches accepted baseline");
await mutate(admin, "/api/v1/auth/login", { email: adminEmail, password: adminPassword });
await mutate(admin, "/api/v1/me/onboarding", { action: "complete" }, "PATCH");

const [creator, playerA, playerB, playerC, playerD] = await Promise.all([
  createUser(admin, "Оператор"),
  createUser(admin, "Анна"),
  createUser(admin, "Борис"),
  createUser(admin, "Вера"),
  createUser(admin, "Глеб"),
]);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL,
  viewport: { width: 1440, height: 900 },
  storageState: await creator.api.storageState(),
});
const page = await context.newPage();
const consoleErrors = [];
page.on("pageerror", (error) => consoleErrors.push({ type: "pageerror", message: error.message }));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push({ type: "console", message: message.text() });
});

const results = {
  status: "PASS",
  runtime: {
    environment: health.release.environment,
    version: health.release.version,
    sha: health.release.sha,
    browser: "Chromium via Playwright 1.63",
    viewport: "1440x900",
  },
  branches: {},
  console: null,
};

let probeFailure;
try {
  // Branch A: server commit completes, then the browser response is aborted.
  const committedMatch = await createOwnedLiveMatch(creator, playerA, playerB, "Correction probe commit then abort");
  const committedSides = sideMap(committedMatch);
  const serverB = committedMatch.participants.find(({ side }) => side === "B");
  await page.goto(`/matches/${committedMatch.id}/judge`);
  await page.getByRole("group", { name: "Счёт матча", exact: true }).waitFor();
  await openCorrection(page, 4, 2, serverB.id);

  const correctionPatternA = new RegExp(`/api/v1/matches/${committedMatch.id}/manual-correction$`);
  let firstKey = "";
  let firstBody;
  let fetchStatus;
  let fetchMatch;
  let resolveFetch;
  const fetchCompleted = new Promise((resolve) => { resolveFetch = resolve; });
  await page.route(correctionPatternA, async (route) => {
    firstKey = route.request().headers()["idempotency-key"] ?? "";
    firstBody = route.request().postDataJSON();
    const response = await route.fetch();
    fetchStatus = response.status();
    fetchMatch = (await response.json()).match;
    resolveFetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Сохранить коррекцию", exact: true }).click();
  await fetchCompleted;
  await page.getByRole("alert").waitFor();
  const prefixedFirstKey = `manual-correction:${firstKey}`;
  const afterFirstCommit = await getMatch(creator.api, committedMatch.id);
  const uiAfterLost = await uiState(page);
  await screenshot(page, "c01-commit-then-lost-response");
  assert(fetchStatus === 200, "route.fetch confirmed 200 commit");
  assert(fetchMatch.version === committedMatch.version + 1, "route.fetch returned incremented version");
  assert(afterFirstCommit.idempotencyKeys.includes(prefixedFirstKey), "prefixed correction key persisted");
  assert(afterFirstCommit.scoreA === 4 && afterFirstCommit.scoreB === 2, "absolute correction persisted");
  assert(committedSides.get(afterFirstCommit.currentServerParticipantId) === "B", "serve side B persisted");
  assert(correctionEvent(afterFirstCommit, prefixedFirstKey), "manual correction audit event persisted");
  assert(uiAfterLost.correctionOpen && uiAfterLost.draft.scoreA === "4" && uiAfterLost.draft.scoreB === "2", "draft preserved after lost response");
  await page.unroute(correctionPatternA);

  // Explicit resend uses a new key but the stale UI version, so the server returns 409 and writes nothing.
  let resendKey = "";
  let resendBody;
  await page.route(correctionPatternA, async (route) => {
    resendKey = route.request().headers()["idempotency-key"] ?? "";
    resendBody = route.request().postDataJSON();
    await route.continue();
  });
  const resendResponsePromise = page.waitForResponse((response) => correctionPatternA.test(response.url()) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Сохранить коррекцию", exact: true }).click();
  const resendResponse = await resendResponsePromise;
  const resendResponseBody = await resendResponse.json().catch(() => ({}));
  await page.getByRole("alert").filter({ hasText: "Матч изменился" }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".judge-side__score")[0]?.textContent === "4");
  const afterStaleResend = await getMatch(creator.api, committedMatch.id);
  const prefixedResendKey = `manual-correction:${resendKey}`;
  const uiAfterStaleResend = await uiState(page);
  await screenshot(page, "c02-explicit-stale-resend");
  assert(resendResponse.status() === 409, "explicit stale resend returns 409");
  assert(afterStaleResend.version === afterFirstCommit.version, "stale resend did not increment version");
  assert(afterStaleResend.scoreA === 4 && afterStaleResend.scoreB === 2, "stale resend did not alter absolute score");
  assert(!afterStaleResend.idempotencyKeys.includes(prefixedResendKey), "rejected resend key not stored");
  assert(matchState(afterStaleResend).manualCorrectionEventCount === matchState(afterFirstCommit).manualCorrectionEventCount, "stale resend did not add audit event");
  assert(uiAfterStaleResend.correctionOpen && uiAfterStaleResend.draft.scoreA === "4" && uiAfterStaleResend.draft.scoreB === "2", "draft preserved after stale conflict");
  await page.unroute(correctionPatternA);

  results.branches.commitThenAbort = {
    request: {
      idempotencyKey: firstKey,
      storedKey: prefixedFirstKey,
      expectedVersion: firstBody.expectedVersion,
      scoreA: firstBody.scoreA,
      scoreB: firstBody.scoreB,
      currentServerSide: committedSides.get(firstBody.currentServerParticipantId),
    },
    routeFetch: { status: fetchStatus, returned: matchState(fetchMatch) },
    before: matchState(committedMatch),
    authoritativeAfterCommit: matchState(afterFirstCommit),
    auditEvent: correctionEvent(afterFirstCommit, prefixedFirstKey),
    uiAfterLostResponse: uiAfterLost,
    explicitStaleResend: {
      request: {
        idempotencyKey: resendKey,
        storedKey: prefixedResendKey,
        expectedVersion: resendBody.expectedVersion,
        scoreA: resendBody.scoreA,
        scoreB: resendBody.scoreB,
        currentServerSide: committedSides.get(resendBody.currentServerParticipantId),
      },
      response: { status: resendResponse.status(), code: resendResponseBody.code ?? null },
      authoritativeAfter: matchState(afterStaleResend),
      storedKeyPresent: afterStaleResend.idempotencyKeys.includes(prefixedResendKey),
      uiAfter: uiAfterStaleResend,
    },
  };

  await mutate(creator.api, `/api/v1/matches/${committedMatch.id}/judge/release`, {});

  // Branch B: the request is observed but held before route.fetch; an early GET cannot prove rejection.
  const delayedMatch = await createOwnedLiveMatch(creator, playerC, playerD, "Correction probe early GET absence");
  const delayedSides = sideMap(delayedMatch);
  const delayedServerB = delayedMatch.participants.find(({ side }) => side === "B");
  await page.goto(`/matches/${delayedMatch.id}/judge`);
  await page.getByRole("group", { name: "Счёт матча", exact: true }).waitFor();
  await openCorrection(page, 2, 1, delayedServerB.id);

  const correctionPatternB = new RegExp(`/api/v1/matches/${delayedMatch.id}/manual-correction$`);
  let delayedKey = "";
  let delayedBody;
  let releaseRequest;
  let resolveRequestSeen;
  let resolveDelayedFetch;
  const requestGate = new Promise((resolve) => { releaseRequest = resolve; });
  const requestSeen = new Promise((resolve) => { resolveRequestSeen = resolve; });
  const delayedFetchCompleted = new Promise((resolve) => { resolveDelayedFetch = resolve; });
  let delayedFetchStatus;
  await page.route(correctionPatternB, async (route) => {
    delayedKey = route.request().headers()["idempotency-key"] ?? "";
    delayedBody = route.request().postDataJSON();
    resolveRequestSeen();
    await requestGate;
    const response = await route.fetch();
    delayedFetchStatus = response.status();
    resolveDelayedFetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Сохранить коррекцию", exact: true }).click();
  await requestSeen;
  const prefixedDelayedKey = `manual-correction:${delayedKey}`;
  const earlyRead = await getMatch(creator.api, delayedMatch.id);
  const uiWhilePending = await uiState(page);
  await screenshot(page, "c03-request-held-early-get");
  assert(!earlyRead.idempotencyKeys.includes(prefixedDelayedKey), "early GET key absent before request forwarded");
  assert(earlyRead.version === delayedMatch.version, "early GET version unchanged");
  assert(uiWhilePending.correctionOpen && uiWhilePending.saveDisabled && uiWhilePending.saveLabel === "Сохраняем…", "UI honestly pending while request held");
  releaseRequest();
  await delayedFetchCompleted;
  await page.getByRole("alert").waitFor();
  const lateRead = await getMatch(creator.api, delayedMatch.id);
  const uiAfterDelayedLost = await uiState(page);
  await screenshot(page, "c04-delayed-commit-then-lost-response");
  assert(delayedFetchStatus === 200, "delayed route.fetch confirmed commit");
  assert(lateRead.idempotencyKeys.includes(prefixedDelayedKey), "delayed prefixed key persisted after commit");
  assert(lateRead.scoreA === 2 && lateRead.scoreB === 1, "delayed absolute correction persisted");
  assert(delayedSides.get(lateRead.currentServerParticipantId) === "B", "delayed serve side B persisted");
  assert(correctionEvent(lateRead, prefixedDelayedKey), "delayed manual correction event persisted");
  assert(uiAfterDelayedLost.correctionOpen && uiAfterDelayedLost.draft.scoreA === "2" && uiAfterDelayedLost.draft.scoreB === "1", "delayed draft preserved after lost response");
  await page.unroute(correctionPatternB);

  results.branches.earlyGetBeforeForward = {
    request: {
      idempotencyKey: delayedKey,
      storedKey: prefixedDelayedKey,
      expectedVersion: delayedBody.expectedVersion,
      scoreA: delayedBody.scoreA,
      scoreB: delayedBody.scoreB,
      currentServerSide: delayedSides.get(delayedBody.currentServerParticipantId),
    },
    before: matchState(delayedMatch),
    earlyAuthoritativeRead: {
      ...matchState(earlyRead),
      storedKeyPresent: earlyRead.idempotencyKeys.includes(prefixedDelayedKey),
    },
    uiWhileRequestHeld: uiWhilePending,
    routeFetchStatusAfterRelease: delayedFetchStatus,
    lateAuthoritativeRead: {
      ...matchState(lateRead),
      storedKeyPresent: lateRead.idempotencyKeys.includes(prefixedDelayedKey),
    },
    auditEvent: correctionEvent(lateRead, prefixedDelayedKey),
    uiAfterLostResponse: uiAfterDelayedLost,
  };
} catch (error) {
  probeFailure = error;
  results.status = "FAIL";
  results.failure = error instanceof Error ? error.message : String(error);
  await page.screenshot({ path: path.join(screenshotsDir, "probe-failure.png"), fullPage: false }).catch(() => undefined);
} finally {
  results.console = {
    total: consoleErrors.length,
    pageErrors: consoleErrors.filter(({ type }) => type === "pageerror").length,
    messages: consoleErrors,
  };
  await writeFile(path.join(outputDir, "probe-results.json"), `${JSON.stringify(results, null, 2)}\n`);
  await Promise.allSettled([context.close(), browser.close(), admin.dispose(), creator.api.dispose(), playerA.api.dispose(), playerB.api.dispose(), playerC.api.dispose(), playerD.api.dispose()]);
}

if (probeFailure) throw probeFailure;

console.log(JSON.stringify({
  status: results.status,
  branches: Object.keys(results.branches),
  screenshots: 4,
  consoleProblems: results.console.total,
}));
