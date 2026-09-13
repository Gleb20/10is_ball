import { afterEach, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { buildApp } from "./app.js";
import { createMigratedPgliteDb } from "./db/client.js";
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); });
it("GAP-007 API: strict team lifecycle routes enforce actors and preserve full DTOs", async () => {
  const context = await createMigratedPgliteDb();
  const { app, services } = await buildApp({ db: context.db, clock: new FakeClock(new Date("2026-09-13T09:00:00Z")) });
  cleanup = async () => { await app.close(); await context.close(); };
  await services.auth.seedAdmin("team-admin@contract.test", "TeamAdmin9!");
  async function login(email: string, password: string) {
    const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
    expect(response.statusCode).toBe(200); return { tab10_session: response.cookies.find((cookie) => cookie.name === "tab10_session")!.value };
  }
  const captain = await login("team-admin@contract.test", "TeamAdmin9!");
  async function user(name: string) {
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/users", cookies: captain, payload: { email: `${name}@contract.test`, firstName: name, lastName: "Team" } });
    const data = created.json(); const cookies = await login(data.user.email, data.temporaryPassword);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/password/first-change", cookies, payload: { newPassword: "ContractUser9!" } })).statusCode).toBe(200);
    return { id: data.user.id as string, cookies: await login(data.user.email, "ContractUser9!") };
  }
  const member = await user("member"); const outsider = await user("outsider");
  for (const payload of [{ name: " " }, { name: "Valid", captainUserId: member.id }]) {
    expect((await app.inject({ method: "POST", url: "/api/v1/teams", cookies: captain, payload })).statusCode).toBe(400);
  }
  const created = await app.inject({ method: "POST", url: "/api/v1/teams", cookies: captain, payload: { name: " Contract team ", welcomeText: "Welcome" } });
  expect(created.statusCode).toBe(200); const team = created.json().team;
  expect(team).toMatchObject({ name: "Contract team", isCaptain: true, isMember: true }); expect(team.members).toHaveLength(1);
  expect(team.members[0]).not.toHaveProperty("email"); expect(team.members[0]).not.toHaveProperty("passwordHash");
  const url = `/api/v1/teams/${team.id}`;
  for (const [method, path, payload] of [
    ["GET", url, undefined], ["PATCH", url, { name: "New" }], ["POST", `${url}/invitations`, { userId: member.id }],
    ["POST", `${url}/leave`, {}], ["DELETE", `${url}/members/${member.id}`, undefined], ["POST", `${url}/captain-transfer`, { userId: member.id }],
  ] as const) expect((await app.inject({ method, url: path, payload })).statusCode).toBe(401);
  expect((await app.inject({ method: "GET", url, cookies: outsider.cookies })).statusCode).toBe(403);
  expect((await app.inject({ method: "PATCH", url, cookies: outsider.cookies, payload: { name: "Hijack" } })).statusCode).toBe(403);
  expect((await app.inject({ method: "PATCH", url, cookies: captain, payload: {} })).statusCode).toBe(400);
  expect((await app.inject({ method: "GET", url: "/api/v1/teams/not-a-uuid", cookies: captain })).statusCode).toBe(400);
  const invited = await app.inject({ method: "POST", url: `${url}/invitations`, cookies: captain, payload: { userId: member.id } });
  expect(invited.statusCode).toBe(200); const inviteId = invited.json().invitation.id;
  const acceptUrl = `/api/v1/team-invitations/${inviteId}/accept`;
  expect((await app.inject({ method: "POST", url: acceptUrl })).statusCode).toBe(401);
  expect((await app.inject({ method: "POST", url: acceptUrl, cookies: outsider.cookies })).statusCode).toBe(404);
  const accepted = await app.inject({ method: "POST", url: acceptUrl, cookies: member.cookies });
  expect(accepted.json()).toEqual({ status: "accepted", teamId: team.id });
  const update = await app.inject({ method: "PATCH", url, cookies: captain, payload: { slogan: "Ready" } });
  expect(update.json().team).toMatchObject({ slogan: "Ready", isCaptain: true }); expect(update.json().team.members).toHaveLength(2);
  const transferred = await app.inject({ method: "POST", url: `${url}/captain-transfer`, cookies: captain, payload: { userId: member.id } });
  expect(transferred.json().team).toMatchObject({ captainUserId: member.id, isCaptain: false, isMember: true }); expect(transferred.json().team.members).toHaveLength(2);
  const left = await app.inject({ method: "POST", url: `${url}/leave`, cookies: captain, payload: {} });
  expect(left.json().team).toMatchObject({ isMember: false, isCaptain: false }); expect(left.json().team.members).toHaveLength(1);
  const invitation2 = await app.inject({ method: "POST", url: `${url}/invitations`, cookies: member.cookies, payload: { userId: outsider.id } });
  const declineUrl = `/api/v1/team-invitations/${invitation2.json().invitation.id}/decline`;
  expect((await app.inject({ method: "POST", url: declineUrl })).statusCode).toBe(401);
  expect((await app.inject({ method: "POST", url: declineUrl, cookies: outsider.cookies })).json()).toEqual({ status: "declined", teamId: team.id });
});
