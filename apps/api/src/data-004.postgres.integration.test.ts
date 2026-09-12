import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { and, eq, isNull } from "drizzle-orm";
import postgres from "postgres";
import { buildApp, type AppServices } from "./app.js";
import { createPostgresDb, type Db } from "./db/client.js";
import { runPostgresMigrations } from "./db/migrations.js";
import { resolveTestDatabaseUrl } from "./db/test-database-url.js";
import {
  teamInvitations,
  teamMemberships,
  tournamentParticipants,
  users,
} from "./db/schema.js";

const databaseUrl = resolveTestDatabaseUrl(process.env, {
  required: process.env.REQUIRE_TEST_DATABASE_URL === "1",
});
const describePostgres = databaseUrl ? describe : describe.skip;
const ORGANIZER_ID = "00000000-0000-4000-8000-000000000201";
const INVITEE_ID = "00000000-0000-4000-8000-000000000202";

describePostgres.sequential(
  "DATA-004 concurrency on a dedicated PostgreSQL test DB",
  () => {
    let db: Db;
    let services: AppServices;
    let close: () => Promise<void>;
    let appClose: () => Promise<void>;

    beforeAll(async () => {
      const resetClient = postgres(databaseUrl!, { max: 1 });
      try {
        await resetClient.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public");
      } finally {
        await resetClient.end({ timeout: 5 });
      }
      await runPostgresMigrations(databaseUrl!, "apply");
      const context = await createPostgresDb(databaseUrl!);
      db = context.db;
      close = context.close;
      const built = await buildApp({
        db,
        clock: new FakeClock(new Date("2026-09-07T10:00:00.000Z")),
      });
      services = built.services;
      appClose = () => built.app.close();
      await db.insert(users).values([
        {
          id: ORGANIZER_ID,
          email: "organizer@data-004-postgres.test",
          passwordHash: "synthetic-hash",
          firstName: "Organizer",
          lastName: "Postgres",
          mustChangePassword: false,
        },
        {
          id: INVITEE_ID,
          email: "invitee@data-004-postgres.test",
          passwordHash: "synthetic-hash",
          firstName: "Invitee",
          lastName: "Postgres",
          mustChangePassword: false,
        },
      ]);
    });

    afterAll(async () => {
      await appClose?.();
      await close?.();
    });

    it("serializes same-pair team invite and accept", async () => {
      const team = await services.teams.create({
        name: "DATA-004 PostgreSQL team",
        captainUserId: ORGANIZER_ID,
      });
      const invitations = await Promise.all([
        services.teams.invite({
          teamId: team!.id,
          invitedUserId: INVITEE_ID,
          invitedByUserId: ORGANIZER_ID,
        }),
        services.teams.invite({
          teamId: team!.id,
          invitedUserId: INVITEE_ID,
          invitedByUserId: ORGANIZER_ID,
        }),
      ]);
      expect(new Set(invitations.map((invite) => invite!.id)).size).toBe(1);
      await Promise.all(
        invitations.map((invite) =>
          services.teams.respondInvitation({
            invitationId: invite!.id,
            userId: INVITEE_ID,
            accept: true,
          }),
        ),
      );
      expect(
        await db.query.teamMemberships.findMany({
          where: and(
            eq(teamMemberships.teamId, team!.id),
            eq(teamMemberships.userId, INVITEE_ID),
            isNull(teamMemberships.leftAt),
          ),
        }),
      ).toHaveLength(1);
      expect(
        await db.query.teamInvitations.findMany({
          where: and(
            eq(teamInvitations.teamId, team!.id),
            eq(teamInvitations.invitedUserId, INVITEE_ID),
            eq(teamInvitations.status, "pending"),
          ),
        }),
      ).toHaveLength(0);
    });

    it("serializes tournament invitation acceptance against direct roster add", async () => {
      const tournament = await services.tournaments.create({
        title: "DATA-004 PostgreSQL tournament",
        format: "single_elimination",
        createdByUserId: ORGANIZER_ID,
        organizerParticipates: false,
      });
      const invitation = await services.tournaments.invite({
        tournamentId: tournament!.id,
        invitedUserId: INVITEE_ID,
        invitedByUserId: ORGANIZER_ID,
      });
      const results = await Promise.allSettled([
        services.tournaments.respondInvitation({
          invitationId: invitation!.id,
          userId: INVITEE_ID,
          accept: true,
        }),
        services.tournaments.addParticipant({
          tournamentId: tournament!.id,
          actorUserId: ORGANIZER_ID,
          userId: INVITEE_ID,
        }),
      ]);
      expect(results[0]).toEqual({
        status: "fulfilled",
        value: { status: "accepted" },
      });
      if (results[1]?.status === "rejected") {
        expect(results[1].reason).toMatchObject({
          code: "ALREADY_IN_TOURNAMENT",
        });
      }
      expect(
        await db.query.tournamentParticipants.findMany({
          where: and(
            eq(tournamentParticipants.tournamentId, tournament!.id),
            eq(tournamentParticipants.userId, INVITEE_ID),
            eq(tournamentParticipants.status, "active"),
          ),
        }),
      ).toHaveLength(1);
    });
  },
);
