import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { and, eq, isNull } from "drizzle-orm";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import {
  auditLogs,
  authSessions,
  notifications,
  teamInvitations,
  teamMemberships,
  teams,
  users,
} from "./db/schema.js";

const CAPTAIN = "00000000-0000-4000-8000-000000000701";
const EARLY = "00000000-0000-4000-8000-000000000702";
const LATE = "00000000-0000-4000-8000-000000000703";
const OUTSIDER = "00000000-0000-4000-8000-000000000704";
const ADMIN = "00000000-0000-4000-8000-000000000705";

describe("GAP-007 team lifecycle", () => {
  let db: Db;
  let services: AppServices;
  let close: () => Promise<void>;
  let appClose: () => Promise<void>;
  const clock = new FakeClock(new Date("2026-09-13T08:00:00.000Z"));

  beforeEach(async () => {
    const context = await createMigratedPgliteDb();
    db = context.db;
    close = context.close;
    const built = await buildApp({ db, clock });
    services = built.services;
    appClose = () => built.app.close();
    services.auth.setUserBlockedHook((userId, transactionDb) =>
      services.teams.transferCaptainOnBlock(userId, transactionDb),
    );
    await db.insert(users).values([
      { id: CAPTAIN, email: "captain@gap007.test", passwordHash: "x", firstName: "Captain", lastName: "One", mustChangePassword: false },
      { id: EARLY, email: "early@gap007.test", passwordHash: "x", firstName: "Early", lastName: "Member", generatedAvatarKey: "avatar_2", mustChangePassword: false },
      { id: LATE, email: "late@gap007.test", passwordHash: "x", firstName: "Late", lastName: "Member", mustChangePassword: false },
      { id: OUTSIDER, email: "outsider@gap007.test", passwordHash: "x", firstName: "Outside", lastName: "User", mustChangePassword: false },
      { id: ADMIN, email: "admin@gap007.test", passwordHash: "x", firstName: "Admin", lastName: "User", role: "admin", mustChangePassword: false },
    ]);
  });

  afterEach(async () => {
    await appClose();
    await close();
  });

  async function seedTeam() {
    const team = await services.teams.create({
      name: "Ракетки",
      captainUserId: CAPTAIN,
      slogan: "Играем честно",
      welcomeText: "Добро пожаловать",
    });
    await db.insert(teamMemberships).values([
      { teamId: team!.id, userId: EARLY, joinedAt: new Date("2026-01-01T00:00:00Z") },
      { teamId: team!.id, userId: LATE, joinedAt: new Date("2026-02-01T00:00:00Z") },
    ]);
    return team!;
  }

  it("TEAM-001: captain membership failure rolls back team creation", async () => {
    await db.execute(`create or replace function gap007_fail_membership() returns trigger language plpgsql as $$ begin raise exception 'injected'; end; $$`);
    await db.execute(`create trigger gap007_fail_membership before insert on team_memberships for each row execute function gap007_fail_membership()`);
    await expect(services.teams.create({ name: "Не сохранится", captainUserId: CAPTAIN })).rejects.toThrow();
    expect(await db.query.teams.findMany({ where: eq(teams.name, "Не сохранится") })).toHaveLength(0);
  });

  it("TEAM-001/003/006: exposes safe member DTO and enforces captain lifecycle rights", async () => {
    const team = await seedTeam();
    const detail = await services.teams.getForUser(team.id, EARLY);
    expect(detail).toMatchObject({
      id: team.id,
      name: "Ракетки",
      isMember: true,
      isCaptain: false,
      members: expect.arrayContaining([
        expect.objectContaining({ userId: EARLY, displayName: "Member Early", avatarKey: "avatar_2" }),
      ]),
    });
    expect(JSON.stringify(detail)).not.toMatch(/email|passwordHash/);
    await expect(services.teams.getForUser(team.id, OUTSIDER)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(services.teams.update(team.id, EARLY, { name: "Чужая правка" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await services.teams.update(team.id, CAPTAIN, { name: "Новая команда", slogan: "Новый слоган" });
    await expect(services.teams.leave(team.id, CAPTAIN)).rejects.toMatchObject({ code: "CAPTAIN_TRANSFER_REQUIRED" });
    await expect(services.teams.removeMember(team.id, CAPTAIN, CAPTAIN)).rejects.toMatchObject({ code: "CAPTAIN_TRANSFER_REQUIRED" });
    await services.teams.transferCaptain(team.id, CAPTAIN, EARLY);
    await services.teams.leave(team.id, CAPTAIN);
    const updated = await services.teams.getForUser(team.id, CAPTAIN);
    expect(updated).toMatchObject({ name: "Новая команда", captainUserId: EARLY, isMember: false });
    expect(updated.members.map((member) => member.userId)).not.toContain(CAPTAIN);
  });

  it("TEAM-004: pending invitee may read metadata but only captain sees invitations", async () => {
    const team = await seedTeam();
    const invitation = await services.teams.invite({ teamId: team.id, invitedUserId: OUTSIDER, invitedByUserId: CAPTAIN });
    const inviteeView = await services.teams.getForUser(team.id, OUTSIDER);
    expect(inviteeView.isMember).toBe(false);
    expect(inviteeView.invitations).toBeUndefined();
    const captainView = await services.teams.getForUser(team.id, CAPTAIN);
    expect(captainView.invitations).toEqual([
      expect.objectContaining({ id: invitation!.id, invitedUserId: OUTSIDER, status: "pending" }),
    ]);
  });

  it("TEAM-007: blocking a captain atomically revokes sessions, audits, and assigns earliest active member", async () => {
    const team = await seedTeam();
    await db.insert(authSessions).values({ userId: CAPTAIN, tokenHash: "gap007-session", expiresAt: new Date("2027-01-01T00:00:00Z") });
    await services.auth.blockUser(ADMIN, CAPTAIN);
    expect(await db.query.users.findFirst({ where: eq(users.id, CAPTAIN) })).toMatchObject({ status: "blocked" });
    expect(await db.query.authSessions.findFirst({ where: eq(authSessions.userId, CAPTAIN) })).toMatchObject({ revokeReason: "blocked" });
    expect(await db.query.teams.findFirst({ where: eq(teams.id, team.id) })).toMatchObject({ captainUserId: EARLY, status: "active" });
    expect(await db.query.notifications.findMany({ where: eq(notifications.userId, EARLY) })).toEqual([
      expect.objectContaining({ type: "captain_assigned", payload: { teamId: team.id } }),
    ]);
    expect(await db.query.auditLogs.findMany({ where: eq(auditLogs.entityId, CAPTAIN) })).toEqual([
      expect.objectContaining({ action: "user.blocked" }),
    ]);
  });

  it("ADM-003: block revalidates the acting administrator inside the transaction", async () => {
    await db.update(users).set({ status: "blocked" }).where(eq(users.id, ADMIN));
    await expect(services.auth.blockUser(ADMIN, OUTSIDER)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.query.users.findFirst({ where: eq(users.id, OUTSIDER) })).toMatchObject({ status: "active" });
    expect(await db.query.auditLogs.findMany({ where: eq(auditLogs.entityId, OUTSIDER) })).toHaveLength(0);
  });

  it("TEAM-008: blocking a sole captain archives the team and cancels pending invitations", async () => {
    const team = await services.teams.create({ name: "Один", captainUserId: CAPTAIN });
    const invitation = await services.teams.invite({ teamId: team!.id, invitedUserId: OUTSIDER, invitedByUserId: CAPTAIN });
    await services.auth.blockUser(ADMIN, CAPTAIN);
    expect(await db.query.teams.findFirst({ where: eq(teams.id, team!.id) })).toMatchObject({ status: "archived", archivedAt: clock.now() });
    expect(await db.query.teamInvitations.findFirst({ where: eq(teamInvitations.id, invitation!.id) })).toMatchObject({ status: "cancelled", respondedAt: clock.now() });
    expect(await services.teams.listForUser(CAPTAIN)).toEqual([]);
    await expect(services.teams.respondInvitation({ invitationId: invitation!.id, userId: OUTSIDER, accept: true })).rejects.toMatchObject({ code: "EXPIRED" });
    expect(await db.query.teamMemberships.findMany({ where: and(eq(teamMemberships.teamId, team!.id), eq(teamMemberships.userId, OUTSIDER), isNull(teamMemberships.leftAt)) })).toHaveLength(0);
  });

  it("TEAM-007: downstream captain notification failure rolls back the complete block", async () => {
    const team = await seedTeam();
    await db.execute(`create or replace function gap007_fail_captain_notification() returns trigger language plpgsql as $$ begin if NEW.type = 'captain_assigned' then raise exception 'injected'; end if; return NEW; end; $$`);
    await db.execute(`create trigger gap007_fail_captain_notification before insert on notifications for each row execute function gap007_fail_captain_notification()`);
    await expect(services.auth.blockUser(ADMIN, CAPTAIN)).rejects.toThrow();
    expect(await db.query.users.findFirst({ where: eq(users.id, CAPTAIN) })).toMatchObject({ status: "active" });
    expect(await db.query.teams.findFirst({ where: eq(teams.id, team.id) })).toMatchObject({ captainUserId: CAPTAIN, status: "active" });
    expect(await db.query.auditLogs.findMany({ where: eq(auditLogs.entityId, CAPTAIN) })).toHaveLength(0);
  });

  it("TEAM-001: a blocked user cannot create a team", async () => {
    await services.auth.blockUser(ADMIN, OUTSIDER);

    await expect(
      services.teams.create({ name: "Недоступная команда", captainUserId: OUTSIDER }),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    expect(
      await db.query.teams.findMany({ where: eq(teams.name, "Недоступная команда") }),
    ).toHaveLength(0);
  });
});
