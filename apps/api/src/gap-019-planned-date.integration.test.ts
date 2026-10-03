import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import { authSessions, users } from "./db/schema.js";
import { hashToken } from "./modules/auth/auth-service.js";

describe("GAP-019 planned tournament date", () => {
  let db: Db;
  let app: FastifyInstance;
  let services: AppServices;
  let closeDb: () => Promise<void>;
  const organizer = "00000000-0000-4000-8000-000000019001";
  const outsider = "00000000-0000-4000-8000-000000019002";
  const cookies = (token = "organizer") => ({ tab10_session: token });
  beforeEach(async () => {
    const context = await createMigratedPgliteDb();
    db = context.db; closeDb = context.close;
    const built = await buildApp({ db, clock: new FakeClock(new Date("2026-10-03T12:00:00Z")), randomIndex: () => 0 });
    app = built.app; services = built.services;
    for (const [id, token] of [[organizer, "organizer"], [outsider, "outsider"]]) {
      await db.insert(users).values({ id, email: `${token}@planned.test`, passwordHash: "x", firstName: token!, lastName: "Date", mustChangePassword: false });
      await db.insert(authSessions).values({ userId: id!, tokenHash: hashToken(token!), expiresAt: new Date("2026-10-04T12:00:00Z") });
    }
  });
  afterEach(async () => { await app.close(); await closeDb(); });
  const create = (plannedDate?: unknown) => app.inject({ method: "POST", url: "/api/v1/tournaments", cookies: cookies(), payload: { title: "Planned cup", organizerParticipates: false, ...(plannedDate === undefined ? {} : { plannedDate }) } });

  it("stores an optional date without creating a timer or starting the event", async () => {
    const response = await create("2028-02-29");
    expect(response.statusCode).toBe(200);
    const { tournament } = response.json();
    expect(tournament).toMatchObject({ plannedDate: "2028-02-29", status: "collecting", startedAt: null });
    const detail = await app.inject({ method: "GET", url: `/api/v1/tournaments/${tournament.id}`, cookies: cookies() });
    expect(detail.json().tournament.plannedDate).toBe("2028-02-29");
    const legacy = await create();
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json().tournament.plannedDate).toBeNull();
  });

  it("rejects impossible dates, year zero, timestamps and non-string values before creation", async () => {
    for (const value of ["2027-02-29", "2026-04-31", "0000-01-01", "2026-10-03T00:00:00Z", "", 20261003]) {
      const response = await create(value);
      expect(response.statusCode, String(value)).toBe(400);
    }
    expect((await services.tournaments.list(organizer)).length).toBe(0);
  });

  it("keeps the bracket and its version on date-only edits, preserves omission and permits explicit clearing", async () => {
    const created = (await create("2027-01-01")).json().tournament;
    for (const firstName of ["One", "Two", "Three"]) await services.tournaments.addParticipant({ tournamentId: created.id, actorUserId: organizer, guestFirstName: firstName, guestLastName: "Guest" });
    const context = await services.tournaments.getBracketGenerationContext(created.id, organizer);
    const before = await services.tournaments.generateBracketVersioned(created.id, organizer, { expectedVersion: context.bracketStateVersion, constructionAlgorithm: "compact" });
    const patch = (payload: unknown, token = "organizer") => app.inject({ method: "PATCH", url: `/api/v1/tournaments/${created.id}`, cookies: cookies(token), payload: payload as object });
    expect((await patch({ plannedDate: "2027-02-01" }, "outsider")).statusCode).toBe(403);
    const changed = await patch({ plannedDate: "2027-02-01" });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().tournament).toMatchObject({ plannedDate: "2027-02-01", status: "bracket_generated", bracketStateVersion: before.bracketStateVersion, bracketJson: before.bracketJson });
    expect((await patch({ title: "Renamed" })).json().tournament.plannedDate).toBe("2027-02-01");
    expect((await patch({ plannedDate: null })).json().tournament.plannedDate).toBeNull();
    expect((await patch({ plannedDate: "2027-12-31" })).statusCode).toBe(200);
    const started = await services.tournaments.start(created.id, organizer);
    expect(started?.status).toBe("in_progress");
    const afterStart = await patch({ plannedDate: "2028-01-01" });
    expect(afterStart.statusCode).toBe(400);
    expect(afterStart.json().code).toBe("TOURNAMENT_ALREADY_STARTED");
    expect((await services.tournaments.get(created.id))?.plannedDate).toBe("2027-12-31");
  });
});
