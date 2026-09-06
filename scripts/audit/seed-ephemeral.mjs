#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const API = new URL(process.env.API_BASE ?? "http://127.0.0.1:3001");
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
if (API.protocol !== "http:" || !LOCAL_HOSTS.has(API.hostname)) {
  throw new Error("Audit fixtures may only target a local HTTP API.");
}

const adminEmail = process.env.AUDIT_ADMIN_EMAIL;
const adminPassword = process.env.AUDIT_ADMIN_PASSWORD;
const userPassword = process.env.AUDIT_FIXTURE_USER_PASSWORD;
if (!adminEmail || !adminPassword || !userPassword) {
  throw new Error(
    "AUDIT_ADMIN_EMAIL, AUDIT_ADMIN_PASSWORD and AUDIT_FIXTURE_USER_PASSWORD are required.",
  );
}

const healthResponse = await fetch(new URL("/health", API), { method: "GET" });
const health = await healthResponse.json().catch(() => ({}));
if (!healthResponse.ok || health?.auditEphemeral !== true) {
  throw new Error(
    "Refusing to seed: the local API did not attest an in-memory AUDIT_EPHEMERAL database.",
  );
}

const actors = [
  { key: "organizer", email: "audit.organizer@tab10.local", firstName: "Организатор", lastName: "Аудита" },
  { key: "participant", email: "audit.participant@tab10.local", firstName: "Участник", lastName: "Аудита" },
  { key: "judge", email: "audit.judge@tab10.local", firstName: "Судья", lastName: "Аудита" },
  { key: "outsider", email: "audit.outsider@tab10.local", firstName: "Наблюдатель", lastName: "Аудита" },
];

function client() {
  const cookies = new Map();
  const request = async (method, route, body) => {
    const headers = { "content-type": "application/json" };
    const cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    if (cookie) headers.cookie = cookie;
    const csrf = cookies.get("tab10_csrf");
    if (csrf && method !== "GET") headers["x-csrf-token"] = decodeURIComponent(csrf);
    const response = await fetch(new URL(route, API), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const value of response.headers.getSetCookie?.() ?? []) {
      const pair = value.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = payload && typeof payload === "object" ? payload.code : undefined;
      throw new Error(`${method} ${route} failed (${response.status}${code ? ` ${code}` : ""})`);
    }
    return payload;
  };
  return { request };
}

const admin = client();
await admin.request("POST", "/api/v1/auth/login", { email: adminEmail, password: adminPassword });

const users = {};
for (const actor of actors) {
  const created = await admin.request("POST", "/api/v1/admin/users", {
    email: actor.email,
    firstName: actor.firstName,
    lastName: actor.lastName,
    role: "user",
  });
  const actorClient = client();
  await actorClient.request("POST", "/api/v1/auth/login", {
    email: actor.email,
    password: created.temporaryPassword,
  });
  await actorClient.request("POST", "/api/v1/auth/password/first-change", {
    newPassword: userPassword,
  });
  users[actor.key] = { id: created.user.id, email: actor.email };
}

const organizer = client();
await organizer.request("POST", "/api/v1/auth/login", {
  email: users.organizer.email,
  password: userPassword,
});

const matchResult = await organizer.request("POST", "/api/v1/matches", {
  title: "Audit baseline: guest match",
  format: "1v1",
  pointsToWin: 11,
  mercyEnabled: false,
  mercyPoints: null,
  participants: [
    { side: "A", userId: users.organizer.id },
    { side: "B", guestFirstName: "Гость", guestLastName: "Аудита" },
  ],
});

const tournamentResult = await organizer.request("POST", "/api/v1/tournaments", {
  title: "Audit baseline: collecting tournament",
  format: "single_elimination",
  organizerParticipates: true,
  pointsToWin: 11,
  mercyEnabled: false,
  mercyPoints: null,
});
await organizer.request(
  "POST",
  `/api/v1/tournaments/${tournamentResult.tournament.id}/participants`,
  { userId: users.participant.id },
);
await organizer.request(
  "POST",
  `/api/v1/tournaments/${tournamentResult.tournament.id}/participants`,
  { guestFirstName: "Гость", guestLastName: "Турнира" },
);

const manifest = {
  schemaVersion: 1,
  environment: "local-ephemeral-only",
  apiBase: API.href,
  actors: users,
  guests: ["Гость Аудита", "Гость Турнира"],
  matchId: matchResult.match.id,
  tournamentId: tournamentResult.tournament.id,
};
await mkdir(path.join(ROOT, ".data"), { recursive: true });
await writeFile(path.join(ROOT, ".data/audit-fixture.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Created deterministic audit actors and baseline entities in the local API.");
console.log("Manifest: .data/audit-fixture.json (credentials are never written).");
