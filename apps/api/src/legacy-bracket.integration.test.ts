import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { generateSingleEliminationBracket } from "@tab10/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import {
  matches,
  notifications,
  tournamentParticipants,
  tournaments,
} from "./db/schema.js";

const LEGACY_V1_DE_N5 = {
  schemaVersion: 1,
  size: 5,
  format: "double_elimination",
  thirdPlaceSlotId: null,
  championParticipantId: null,
  slots: [],
} as const;

describe("AT-TRN-015 legacy V1 double-elimination", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let db: Db;
  let closeDb: () => Promise<void>;
  let adminId: string;
  let adminCookie: string;

  beforeEach(async () => {
    const ctx = await createMigratedPgliteDb();
    db = ctx.db;
    closeDb = ctx.close;
    const built = await buildApp({ db, clock: new FakeClock() });
    app = built.app;
    services = built.services;
    const seeded = await services.auth.seedAdmin(
      "admin@tab10.local",
      "AdminPass1!",
    );
    adminId = seeded.user.id;
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "admin@tab10.local",
        password: "AdminPass1!",
      },
    });
    adminCookie = login.cookies.find(
      (cookie) => cookie.name === "tab10_session",
    )!.value;
  });

  afterEach(async () => {
    await app.close();
    await closeDb();
  });

  async function createLegacyTournament() {
    const [tournament] = await db
      .insert(tournaments)
      .values({
        title: "Legacy V1 DE N=5",
        status: "bracket_generated",
        format: "double_elimination",
        organizerParticipates: false,
        createdByUserId: adminId,
        bracketJson: LEGACY_V1_DE_N5,
        bracketStateVersion: 7,
        bracketConstructionAlgorithm: null,
      })
      .returning();
    for (let index = 0; index < 5; index += 1) {
      await db.insert(tournamentParticipants).values({
        tournamentId: tournament!.id,
        guestFirstName: `Guest${index}`,
        guestLastName: "Legacy",
        seed: index + 1,
      });
    }
    return tournament!;
  }

  async function expectRejectedWithoutMutation(input: {
    method: "PATCH" | "POST";
    suffix: string;
    payload?: unknown;
  }) {
    const tournament = await createLegacyTournament();
    const response = await app.inject({
      method: input.method,
      url: `/api/v1/tournaments/${tournament.id}${input.suffix}`,
      cookies: { tab10_session: adminCookie },
      ...(input.payload === undefined ? {} : { payload: input.payload }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "UNSUPPORTED_BRACKET_VERSION",
      message: "Неподдерживаемая версия сетки",
    });

    const stored = await db.query.tournaments.findFirst({
      where: eq(tournaments.id, tournament.id),
    });
    expect(stored).toMatchObject({
      status: "bracket_generated",
      bracketJson: LEGACY_V1_DE_N5,
      bracketStateVersion: 7,
      bracketConstructionAlgorithm: null,
    });
    expect(
      await db.query.matches.findMany({
        where: eq(matches.tournamentId, tournament.id),
      }),
    ).toHaveLength(0);
    expect(await db.query.notifications.findMany()).toHaveLength(0);
  }

  it.each([
    {
      label: "start",
      method: "POST" as const,
      suffix: "/start",
    },
    {
      label: "patch",
      method: "PATCH" as const,
      suffix: "/bracket",
      payload: { swaps: [] },
    },
    {
      label: "regenerate",
      method: "POST" as const,
      suffix: "/bracket",
      payload: { constructionAlgorithm: "power_of_two" },
    },
    {
      label: "dissolve",
      method: "POST" as const,
      suffix: "/dissolve-bracket",
    },
  ])("rejects $label before any mutation", async ({ label: _, ...input }) => {
    await expectRejectedWithoutMutation(input);
  });

  it("preserves the legacy V1 single-elimination start path", async () => {
    const [tournament] = await db
      .insert(tournaments)
      .values({
        title: "Supported V1 SE",
        status: "bracket_generated",
        format: "single_elimination",
        organizerParticipates: false,
        createdByUserId: adminId,
        bracketStateVersion: 3,
        bracketConstructionAlgorithm: null,
      })
      .returning();
    const participantIds: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const [participant] = await db
        .insert(tournamentParticipants)
        .values({
          tournamentId: tournament!.id,
          guestFirstName: `Single${index}`,
          guestLastName: "Legacy",
          seed: index + 1,
        })
        .returning();
      participantIds.push(participant!.id);
    }
    let slotId = 0;
    const bracket = generateSingleEliminationBracket(
      participantIds,
      () => `legacy_se_${++slotId}`,
    );
    await db
      .update(tournaments)
      .set({ bracketJson: bracket })
      .where(eq(tournaments.id, tournament!.id));

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${tournament!.id}/start`,
      cookies: { tab10_session: adminCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().tournament).toMatchObject({
      status: "in_progress",
      format: "single_elimination",
    });
    expect(response.json().tournament.matches).toHaveLength(2);
  });
});
