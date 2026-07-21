import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  faqArticles,
  feedbackMessages,
  notifications,
  teamInvitations,
  tournamentInvitations,
} from "../../db/schema.js";

export type NotificationLifecycle =
  | "new"
  | "accepted"
  | "declined"
  | "read"
  | "expired";

export class NotificationService {
  constructor(private readonly db: Db) {}

  async list(userId: string) {
    const rows = await this.db.query.notifications.findMany({
      where: eq(notifications.userId, userId),
      orderBy: [desc(notifications.createdAt)],
    });
    return this.enrichLifecycle(rows);
  }

  async unread(userId: string) {
    return this.db.query.notifications.findMany({
      where: and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
      orderBy: [desc(notifications.createdAt)],
    });
  }

  /** Count of actionable / unread items (for badges). */
  async unreadCount(userId: string) {
    const enriched = await this.list(userId);
    return enriched.filter((n) => n.lifecycle === "new").length;
  }

  async markRead(userId: string, id: string) {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(notifications.id, id), eq(notifications.userId, userId)),
      );
  }

  async create(input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
  }) {
    const [row] = await this.db
      .insert(notifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        payload: input.payload,
      })
      .returning();
    return row;
  }

  private async enrichLifecycle<
    T extends {
      id: string;
      type: string;
      readAt: Date | null;
      payload: unknown;
    },
  >(
    rows: T[],
  ): Promise<Array<T & { lifecycle: NotificationLifecycle }>> {
    const tournamentIds: string[] = [];
    const teamIds: string[] = [];
    for (const n of rows) {
      const payload = (n.payload ?? {}) as { invitationId?: string };
      if (
        n.type === "tournament_invitation" &&
        payload.invitationId
      ) {
        tournamentIds.push(payload.invitationId);
      }
      if (n.type === "team_invitation" && payload.invitationId) {
        teamIds.push(payload.invitationId);
      }
    }

    const tInv =
      tournamentIds.length > 0
        ? await this.db.query.tournamentInvitations.findMany({
            where: inArray(tournamentInvitations.id, tournamentIds),
          })
        : [];
    const teamInv =
      teamIds.length > 0
        ? await this.db.query.teamInvitations.findMany({
            where: inArray(teamInvitations.id, teamIds),
          })
        : [];
    const tById = new Map(tInv.map((i) => [i.id, i]));
    const teamById = new Map(teamInv.map((i) => [i.id, i]));

    return rows.map((n) => {
      const payload = (n.payload ?? {}) as { invitationId?: string };
      let lifecycle: NotificationLifecycle = n.readAt ? "read" : "new";

      if (
        n.type === "tournament_invitation" &&
        payload.invitationId
      ) {
        const inv = tById.get(payload.invitationId);
        if (inv?.status === "accepted") lifecycle = "accepted";
        else if (inv?.status === "declined") lifecycle = "declined";
        else if (inv?.status === "expired") lifecycle = "expired";
        else if (inv?.status === "pending") lifecycle = "new";
      } else if (
        n.type === "team_invitation" &&
        payload.invitationId
      ) {
        const inv = teamById.get(payload.invitationId);
        if (inv?.status === "accepted") lifecycle = "accepted";
        else if (inv?.status === "declined") lifecycle = "declined";
        else if (inv?.status === "expired") lifecycle = "expired";
        else if (inv?.status === "pending") lifecycle = "new";
      }

      return { ...n, lifecycle };
    });
  }
}

export class HelpService {
  constructor(private readonly db: Db) {}

  async seedFaq() {
    const existing = await this.db.query.faqArticles.findMany({ limit: 1 });
    if (existing.length > 0) return;
    await this.db.insert(faqArticles).values([
      {
        category: "Начало",
        title: "Как войти?",
        body: "Администратор создаёт аккаунт и выдаёт временный пароль. При первом входе нужно задать свой пароль.",
        sortOrder: 1,
      },
      {
        category: "Матчи",
        title: "Кто может судить?",
        body: "Судейскую сессию может захватить любой участник или приглашённый судья. Одновременно активен только один судья.",
        sortOrder: 2,
      },
      {
        category: "Турниры",
        title: "Сколько игроков нужно?",
        body: "От 3 до 64. Для двоих создайте обычный матч.",
        sortOrder: 3,
      },
    ]);
  }

  async listFaq() {
    return this.db.query.faqArticles.findMany({
      orderBy: (a, { asc }) => [asc(a.sortOrder)],
    });
  }

  async submitFeedback(input: {
    userId: string;
    kind: string;
    message: string;
  }) {
    const [row] = await this.db
      .insert(feedbackMessages)
      .values(input)
      .returning();
    return row;
  }
}
