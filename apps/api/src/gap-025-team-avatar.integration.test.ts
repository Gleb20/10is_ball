import { afterEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { FakeClock } from "@tab10/test-utils";
import { buildApp } from "./app.js";
import { createMigratedPgliteDb } from "./db/client.js";
import { teams } from "./db/schema.js";

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

it("GAP-025 API: persists a bounded team avatar without changing captain authorization", async () => {
  const context = await createMigratedPgliteDb();
  const clock = new FakeClock(new Date("2026-10-03T10:00:00Z"));
  const { app, services } = await buildApp({ db: context.db, clock });
  cleanup = async () => {
    await app.close();
    await context.close();
  };

  await services.auth.seedAdmin("avatar-captain@contract.test", "AvatarCaptain9!");

  async function login(email: string, password: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
    });
    expect(response.statusCode).toBe(200);
    return {
      tab10_session: response.cookies.find(
        (cookie) => cookie.name === "tab10_session",
      )!.value,
    };
  }

  const captain = await login(
    "avatar-captain@contract.test",
    "AvatarCaptain9!",
  );
  const createdAdmin = await app.inject({
    method: "POST",
    url: "/api/v1/admin/users",
    cookies: captain,
    payload: {
      email: "avatar-outsider@contract.test",
      firstName: "Другой",
      lastName: "Администратор",
      role: "admin",
    },
  });
  expect(createdAdmin.statusCode).toBe(200);
  const adminData = createdAdmin.json();
  const firstLogin = await login(
    adminData.user.email,
    adminData.temporaryPassword,
  );
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/password/first-change",
        cookies: firstLogin,
        payload: { newPassword: "AvatarOutsider9!" },
      })
    ).statusCode,
  ).toBe(200);
  const outsiderAdmin = await login(
    "avatar-outsider@contract.test",
    "AvatarOutsider9!",
  );

  const created = await app.inject({
    method: "POST",
    url: "/api/v1/teams",
    cookies: captain,
    payload: { name: "Команда с аватаром", avatarKey: "avatar_3" },
  });
  expect(created.statusCode).toBe(200);
  expect(created.json().team).toMatchObject({
    name: "Команда с аватаром",
    avatarKey: "avatar_3",
    isCaptain: true,
  });
  const teamId = created.json().team.id as string;
  const url = `/api/v1/teams/${teamId}`;

  const listed = await app.inject({
    method: "GET",
    url: "/api/v1/teams",
    cookies: captain,
  });
  expect(listed.json().teams).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: teamId, avatarKey: "avatar_3" }),
    ]),
  );

  const textOnlyPatch = await app.inject({
    method: "PATCH",
    url,
    cookies: captain,
    payload: { slogan: "Поле avatarKey не прислано" },
  });
  expect(textOnlyPatch.statusCode).toBe(200);
  expect(textOnlyPatch.json().team.avatarKey).toBe("avatar_3");

  const cleared = await app.inject({
    method: "PATCH",
    url,
    cookies: captain,
    payload: { avatarKey: null },
  });
  expect(cleared.statusCode).toBe(200);
  expect(cleared.json().team.avatarKey).toBeNull();

  for (const payload of [
    { avatarKey: "avatar_11" },
    { avatarKey: "https://example.com/avatar.png" },
    { avatarUrl: "/avatars/avatar_1.png" },
  ]) {
    const rejected = await app.inject({
      method: "PATCH",
      url,
      cookies: captain,
      payload,
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().code).toBe("VALIDATION");
  }

  const restored = await app.inject({
    method: "PATCH",
    url,
    cookies: captain,
    payload: { avatarKey: "avatar_5" },
  });
  expect(restored.statusCode).toBe(200);

  const unauthorizedAdmin = await app.inject({
    method: "PATCH",
    url,
    cookies: outsiderAdmin,
    payload: { name: "Захваченная команда" },
  });
  expect(unauthorizedAdmin.statusCode).toBe(403);
  expect(unauthorizedAdmin.json().code).toBe("FORBIDDEN");

  await context.db
    .update(teams)
    .set({ status: "archived", archivedAt: clock.now() })
    .where(eq(teams.id, teamId));

  const archivedAdminAttempt = await app.inject({
    method: "PATCH",
    url,
    cookies: outsiderAdmin,
    payload: { name: "Всё ещё не капитан" },
  });
  expect(archivedAdminAttempt.statusCode).toBe(409);
  expect(archivedAdminAttempt.json().code).toBe("TEAM_ARCHIVED");

  const detail = await app.inject({ method: "GET", url, cookies: captain });
  expect(detail.statusCode).toBe(200);
  expect(detail.json().team).toMatchObject({
    name: "Команда с аватаром",
    avatarKey: "avatar_5",
    status: "archived",
  });
});
