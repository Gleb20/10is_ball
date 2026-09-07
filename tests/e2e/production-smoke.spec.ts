import { expect, test } from "@playwright/test";

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";
const release = {
  sha: process.env.TAB10_RELEASE_SHA ??
    "0123456789abcdef0123456789abcdef01234567",
  version: process.env.TAB10_RELEASE_VERSION ?? "1.10.1",
  environment: process.env.TAB10_ENVIRONMENT ?? "test",
  dirty: process.env.TAB10_RELEASE_DIRTY === "true",
};

test("compiled web and API work through the same-origin production-like proxy", async ({
  page,
  request,
}) => {
  const health = await request.get("/health");
  expect(health.ok()).toBeTruthy();
  const healthBody = await health.json();
  expect(healthBody.status).toBe("ok");
  expect(healthBody.release).toEqual(release);
  expect(healthBody).not.toHaveProperty("auditEphemeral");

  const ready = await request.get("/ready");
  expect(ready.ok()).toBeTruthy();
  const readyBody = await ready.json();
  expect(readyBody.status).toBe("ready");
  expect(readyBody.release).toEqual(release);

  const webRelease = await request.get("/release.json");
  expect(webRelease.ok()).toBeTruthy();
  const webReleaseBody = await webRelease.json();
  expect(webReleaseBody).toEqual(release);
  expect([healthBody.release, readyBody.release, webReleaseBody]).toEqual([
    release,
    release,
    release,
  ]);

  const openApi = await request.get("/api/v1/openapi.json");
  expect(openApi.ok()).toBeTruthy();
  expect(await openApi.json()).toMatchObject({
    info: { title: "Tab-10 API" },
  });

  await page.goto("/login");
  await expect(page).toHaveTitle(/Tab-10/i);
  await expect(page.getByRole("form", { name: "Форма входа" })).toBeVisible();
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Пароль").fill(adminPassword);
  await page.getByRole("button", { name: "Войти" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Привет, Admin" })).toBeVisible();

  const sessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "tab10_session",
  );
  expect(sessionCookie).toMatchObject({ secure: true, sameSite: "Lax" });

  const me = await page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/me", { credentials: "include" });
    return { ok: response.ok, body: await response.json() };
  });
  expect(me).toMatchObject({
    ok: true,
    body: { user: { email: adminEmail, role: "admin" } },
  });

  // This state-changing proof is executed only against the disposable local
  // database. The public post-deploy smoke remains GET-only.
  expect(release.environment).toBe("test");
  const csrfProof = await page.evaluate(async () => {
    const rejectedPayload = JSON.stringify({
      organizationText: "CSRF request without matching header",
    });
    const withoutHeader = await fetch("/api/v1/me/profile", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: rejectedPayload,
    });
    const withoutHeaderBody = await withoutHeader.json();

    const csrfCookie = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith("tab10_csrf="));
    const csrfToken = csrfCookie
      ? decodeURIComponent(csrfCookie.slice("tab10_csrf=".length))
      : "";
    if (!csrfToken) throw new Error("Synthetic session has no readable CSRF cookie");

    const acceptedOrganization = "Tab10 synthetic CSRF verification";
    const withHeader = await fetch("/api/v1/me/profile", {
      method: "PATCH",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        onboardingCompleted: true,
        organizationText: acceptedOrganization,
      }),
    });
    const withHeaderBody = await withHeader.json();
    return {
      withoutHeader: {
        status: withoutHeader.status,
        code: withoutHeaderBody.code,
      },
      withHeader: {
        status: withHeader.status,
        email: withHeaderBody.user?.email,
        organizationText: withHeaderBody.user?.organizationText,
      },
    };
  });
  expect(csrfProof.withoutHeader).toEqual({
    status: 403,
    code: "CSRF_INVALID",
  });
  expect(csrfProof.withHeader).toMatchObject({
    status: 200,
    email: adminEmail,
    organizationText: "Tab10 synthetic CSRF verification",
  });
});
