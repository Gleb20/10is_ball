import { and, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import type { Clock } from "@tab10/test-utils";
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
  | "expired"
  | "cancelled";

type InvitationNotificationType =
  | "team_invitation"
  | "tournament_invitation";

export async function markInvitationNotificationsRead(
  db: Db,
  input: {
    userId: string;
    type: InvitationNotificationType;
    invitationIds: string[];
    readAt: Date;
  },
) {
  if (input.invitationIds.length === 0) return;
  const invitationIds = new Set(input.invitationIds);
  const rows = await db.query.notifications.findMany({
    where: and(
      eq(notifications.userId, input.userId),
      eq(notifications.type, input.type),
      isNull(notifications.readAt),
    ),
  });
  const notificationIds = rows
    .filter((row) => {
      const payload = (row.payload ?? {}) as { invitationId?: string };
      return Boolean(
        payload.invitationId && invitationIds.has(payload.invitationId),
      );
    })
    .map((row) => row.id);
  if (notificationIds.length === 0) return;
  await db
    .update(notifications)
    .set({ readAt: input.readAt })
    .where(inArray(notifications.id, notificationIds));
}

export class NotificationService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  async list(userId: string) {
    await this.synchronizeInvitationLifecycles(userId);
    const rows = await this.db.query.notifications.findMany({
      where: eq(notifications.userId, userId),
      orderBy: [desc(notifications.createdAt)],
    });
    return this.enrichLifecycle(rows);
  }

  async unread(userId: string) {
    await this.synchronizeInvitationLifecycles(userId);
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
    return enriched.filter(
      (notification) =>
        notification.lifecycle === "new" && notification.readAt === null,
    ).length;
  }

  async markRead(userId: string, id: string) {
    const [updated] = await this.db
      .update(notifications)
      .set({ readAt: this.clock.now() })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id, readAt: notifications.readAt });
    return updated ?? null;
  }

  async markVisibleRead(userId: string, notificationIds: string[]) {
    const ids = [...new Set(notificationIds)];
    if (ids.length === 0) return [];
    return this.db
      .update(notifications)
      .set({ readAt: this.clock.now() })
      .where(
        and(
          eq(notifications.userId, userId),
          inArray(notifications.id, ids),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id, readAt: notifications.readAt });
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

  private async synchronizeInvitationLifecycles(userId: string) {
    const now = this.clock.now();
    await this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      await db
        .update(teamInvitations)
        .set({ status: "expired", respondedAt: now })
        .where(
          and(
            eq(teamInvitations.invitedUserId, userId),
            eq(teamInvitations.status, "pending"),
            lte(teamInvitations.expiresAt, now),
          ),
        );
      await db
        .update(tournamentInvitations)
        .set({ status: "expired", respondedAt: now })
        .where(
          and(
            eq(tournamentInvitations.invitedUserId, userId),
            eq(tournamentInvitations.status, "pending"),
            lte(tournamentInvitations.expiresAt, now),
          ),
        );

      const unreadInvitationNotifications =
        await db.query.notifications.findMany({
          where: and(
            eq(notifications.userId, userId),
            isNull(notifications.readAt),
            inArray(notifications.type, [
              "team_invitation",
              "tournament_invitation",
            ]),
          ),
        });
      const referencedIds = (
        type: InvitationNotificationType,
      ): string[] => [
        ...new Set(
          unreadInvitationNotifications
            .filter((row) => row.type === type)
            .map((row) => {
              const payload = (row.payload ?? {}) as { invitationId?: string };
              return payload.invitationId;
            })
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const teamIds = referencedIds("team_invitation");
      const tournamentIds = referencedIds("tournament_invitation");
      const [referencedTeamInvites, referencedTournamentInvites] =
        await Promise.all([
          teamIds.length > 0
            ? db.query.teamInvitations.findMany({
                where: inArray(teamInvitations.id, teamIds),
              })
            : [],
          tournamentIds.length > 0
            ? db.query.tournamentInvitations.findMany({
                where: inArray(tournamentInvitations.id, tournamentIds),
              })
            : [],
        ]);
      const pendingTeamIds = new Set(
        referencedTeamInvites
          .filter((invite) => invite.status === "pending")
          .map((invite) => invite.id),
      );
      const pendingTournamentIds = new Set(
        referencedTournamentInvites
          .filter((invite) => invite.status === "pending")
          .map((invite) => invite.id),
      );
      await markInvitationNotificationsRead(db, {
        userId,
        type: "team_invitation",
        invitationIds: teamIds.filter((id) => !pendingTeamIds.has(id)),
        readAt: now,
      });
      await markInvitationNotificationsRead(db, {
        userId,
        type: "tournament_invitation",
        invitationIds: tournamentIds.filter(
          (id) => !pendingTournamentIds.has(id),
        ),
        readAt: now,
      });
    });
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
  ): Promise<
    Array<
      T & {
        lifecycle: NotificationLifecycle;
        actionable: boolean;
        reasonCode: string | null;
        lifecycleAt: Date | null;
        expiresAt: Date | null;
      }
    >
  > {
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
      let actionable = false;
      let reasonCode: string | null = null;
      let lifecycleAt: Date | null = null;
      let expiresAt: Date | null = null;

      if (
        n.type === "tournament_invitation" &&
        payload.invitationId
      ) {
        const inv = tById.get(payload.invitationId);
        expiresAt = inv?.expiresAt ?? null;
        lifecycleAt = inv?.respondedAt ?? null;
        if (!inv) {
          lifecycle = "expired";
          reasonCode = "source_unavailable";
          lifecycleAt = n.readAt;
        } else if (inv.status === "accepted") lifecycle = "accepted";
        else if (inv.status === "declined") lifecycle = "declined";
        else if (inv.status === "expired") {
          lifecycle = "expired";
          reasonCode = "timeout";
        } else if (inv.status === "cancelled") {
          lifecycle = "cancelled";
          reasonCode = "invitation_revoked";
        } else if (inv.status === "pending") actionable = true;
      } else if (
        n.type === "team_invitation" &&
        payload.invitationId
      ) {
        const inv = teamById.get(payload.invitationId);
        expiresAt = inv?.expiresAt ?? null;
        lifecycleAt = inv?.respondedAt ?? null;
        if (!inv) {
          lifecycle = "expired";
          reasonCode = "source_unavailable";
          lifecycleAt = n.readAt;
        } else if (inv.status === "accepted") lifecycle = "accepted";
        else if (inv.status === "declined") lifecycle = "declined";
        else if (inv.status === "expired") {
          lifecycle = "expired";
          reasonCode = "timeout";
        } else if (inv.status === "cancelled") {
          lifecycle = "cancelled";
          reasonCode = "invitation_revoked";
        } else if (inv.status === "pending") actionable = true;
      }

      return {
        ...n,
        lifecycle,
        actionable,
        reasonCode,
        lifecycleAt,
        expiresAt,
      };
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
