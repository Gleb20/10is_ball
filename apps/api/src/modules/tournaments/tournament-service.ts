import { eq } from "drizzle-orm";
import {
  generateDoubleEliminationBracket,
  generateSingleEliminationBracket,
  seedParticipants,
} from "@tab10/shared";
import { randomUUID } from "node:crypto";
import type { Clock } from "@tab10/test-utils";
import type { Db } from "../../db/client.js";
import {
  tournamentParticipants,
  tournaments,
  userStats,
} from "../../db/schema.js";

export class TournamentService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async create(input: {
    title: string;
    format: "single_elimination" | "double_elimination";
    createdByUserId: string;
    defaultJudgeUserId?: string;
  }) {
    const [row] = await this.db
      .insert(tournaments)
      .values({
        title: input.title,
        format: input.format,
        createdByUserId: input.createdByUserId,
        defaultJudgeUserId: input.defaultJudgeUserId ?? input.createdByUserId,
        status: "collecting",
      })
      .returning();
    return row;
  }

  async addParticipant(input: {
    tournamentId: string;
    userId?: string;
    guestFirstName?: string;
    guestLastName?: string;
  }) {
    const t = await this.get(input.tournamentId);
    if (!t) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (t.status !== "collecting" && t.status !== "needs_regeneration" && t.status !== "bracket_generated") {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "INVALID_STATUS" });
    }
    const parts = await this.db.query.tournamentParticipants.findMany({
      where: eq(tournamentParticipants.tournamentId, input.tournamentId),
    });
    if (parts.length >= 64) {
      throw Object.assign(new Error("TOO_MANY"), { code: "TOO_MANY" });
    }
    let winsSnapshot = 0;
    if (input.userId) {
      const stats = await this.db.query.userStats.findFirst({
        where: eq(userStats.userId, input.userId),
      });
      winsSnapshot = stats?.winsAllTime ?? 0;
    }
    const [row] = await this.db
      .insert(tournamentParticipants)
      .values({
        tournamentId: input.tournamentId,
        userId: input.userId,
        guestFirstName: input.guestFirstName,
        guestLastName: input.guestLastName,
        winsSnapshot,
      })
      .returning();
    if (t.status === "bracket_generated") {
      await this.db
        .update(tournaments)
        .set({ status: "needs_regeneration", updatedAt: this.clock.now() })
        .where(eq(tournaments.id, input.tournamentId));
    }
    return row;
  }

  async get(id: string) {
    const t = await this.db.query.tournaments.findFirst({
      where: eq(tournaments.id, id),
    });
    if (!t) return null;
    const participants = await this.db.query.tournamentParticipants.findMany({
      where: eq(tournamentParticipants.tournamentId, id),
    });
    return { ...t, participants };
  }

  async list() {
    return this.db.query.tournaments.findMany();
  }

  async generateBracket(tournamentId: string) {
    const t = await this.get(tournamentId);
    if (!t) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    if (t.participants.length < 3) {
      throw Object.assign(new Error("TOO_FEW"), { code: "TOO_FEW" });
    }
    if (t.participants.length === 2) {
      throw Object.assign(new Error("USE_MATCH"), { code: "USE_MATCH" });
    }
    const seeded = seedParticipants(
      t.participants.map((p) => ({
        id: p.id,
        wins: p.winsSnapshot,
      })),
    );
    const bracket =
      t.format === "double_elimination"
        ? generateDoubleEliminationBracket(seeded, () => randomUUID())
        : generateSingleEliminationBracket(seeded, () => randomUUID());

    // Write seeds
    for (let i = 0; i < seeded.length; i += 1) {
      await this.db
        .update(tournamentParticipants)
        .set({ seed: i + 1 })
        .where(eq(tournamentParticipants.id, seeded[i]!));
    }

    const [row] = await this.db
      .update(tournaments)
      .set({
        status: "bracket_generated",
        bracketJson: bracket,
        updatedAt: this.clock.now(),
      })
      .where(eq(tournaments.id, tournamentId))
      .returning();
    return { ...row, participants: t.participants, bracket };
  }

  async start(tournamentId: string) {
    const t = await this.get(tournamentId);
    if (!t || t.status !== "bracket_generated") {
      throw Object.assign(new Error("INVALID_STATUS"), { code: "INVALID_STATUS" });
    }
    const [row] = await this.db
      .update(tournaments)
      .set({ status: "in_progress", updatedAt: this.clock.now() })
      .where(eq(tournaments.id, tournamentId))
      .returning();
    return row;
  }

  async stop(tournamentId: string) {
    const [row] = await this.db
      .update(tournaments)
      .set({
        status: "stopped",
        finishedAt: this.clock.now(),
        updatedAt: this.clock.now(),
      })
      .where(eq(tournaments.id, tournamentId))
      .returning();
    return row;
  }
}
