import { and, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import type { Clock } from "@tab10/test-utils";
import type { Db } from "../../db/client.js";
import {
  faqArticles,
  matches,
  matchParticipants,
  matchInvitations,
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
  | "tournament_invitation"
  | "match_invitation"
  | "judge_invitation";

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
    await this.synchronizeMatchInvitations(userId);
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

  private async synchronizeMatchInvitations(userId: string) {
    const pending = await this.db.query.matchInvitations.findMany({
      where: and(eq(matchInvitations.invitedUserId, userId), eq(matchInvitations.status, "pending")),
    });
    for (const matchId of [...new Set(pending.map((invitation) => invitation.matchId))].sort()) {
      await this.db.transaction(async (transaction) => {
        const db = transaction as unknown as Db;
        const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).for("update");
        const invitations = await db.query.matchInvitations.findMany({
          where: and(eq(matchInvitations.matchId, matchId), eq(matchInvitations.invitedUserId, userId), eq(matchInvitations.status, "pending")),
        });
        const participants = await db.query.matchParticipants.findMany({ where: eq(matchParticipants.matchId, matchId) });
        const ids = new Set(participants.map((participant) => participant.id));
        const now = this.clock.now();
        for (const invitation of invitations) {
          let reason: string | null = null;
          if (!match) reason = "source_unavailable";
          else if (match.status === "cancelled") reason = "match_cancelled";
          else if (["finished", "stopped", "voided"].includes(match.status)) reason = "match_finished";
          else if (match.status !== "waiting") reason = "match_started";
          else if (invitation.kind === "player" && !ids.has(invitation.matchParticipantId ?? "")) reason = "roster_changed";
          else if (invitation.expiresAt.getTime() <= now.getTime()) reason = "timeout";
          if (!reason) continue;
          await db.update(matchInvitations).set({ status: reason === "timeout" ? "expired" : "cancelled", expiryReason: reason, respondedAt: now }).where(and(eq(matchInvitations.id, invitation.id), eq(matchInvitations.status, "pending")));
          await markInvitationNotificationsRead(db, { userId, type: invitation.kind === "player" ? "match_invitation" : "judge_invitation", invitationIds: [invitation.id], readAt: now });
        }
      });
    }
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
    const matchIds: string[] = [];
    for (const n of rows) {
      const payload = (n.payload ?? {}) as { invitationId?: string };
      if (
        n.type === "tournament_invitation" &&
        payload.invitationId
      ) {
        tournamentIds.push(payload.invitationId);
      }
      if (["match_invitation", "judge_invitation"].includes(n.type) && payload.invitationId) matchIds.push(payload.invitationId);
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
    const matchInv = matchIds.length ? await this.db.query.matchInvitations.findMany({ where: inArray(matchInvitations.id, matchIds) }) : [];
    const matchById = new Map(matchInv.map((invitation) => [invitation.id, invitation]));
    const tById = new Map(tInv.map((i) => [i.id, i]));
    const teamById = new Map(teamInv.map((i) => [i.id, i]));

    return rows.map((n) => {
      const payload = (n.payload ?? {}) as { invitationId?: string; reasonCode?: string };
      let lifecycle: NotificationLifecycle = n.readAt ? "read" : "new";
      let actionable = false;
      let reasonCode: string | null = null;
      let lifecycleAt: Date | null = null;
      let expiresAt: Date | null = null;

      if (["match_invitation", "judge_invitation"].includes(n.type) && payload.invitationId) {
        const invitation = matchById.get(payload.invitationId);
        expiresAt = invitation?.expiresAt ?? null;
        lifecycleAt = invitation?.respondedAt ?? null;
        reasonCode = invitation?.expiryReason === "expired" ? "timeout" : invitation?.expiryReason ?? null;
        if (!invitation) { lifecycle = "expired"; reasonCode = "source_unavailable"; }
        else if (invitation.status === "pending") actionable = true;
        else if (["accepted", "declined", "expired", "cancelled"].includes(invitation.status)) lifecycle = invitation.status as NotificationLifecycle;
      } else if (
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
          reasonCode = payload.reasonCode ?? "invitation_revoked";
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
    const articles = [
      ["Начало", "Как войти?", "Администратор создаёт аккаунт и выдаёт временный пароль. При первом входе нужно задать свой пароль."],
      ["Матчи", "Кто может судить?", "Свободное место судьи может занять любой активный пользователь клуба. Одновременно у матча только один активный судья."],
      ["Турниры", "Сколько игроков нужно?", "От 3 до 64. Для двоих создайте обычный матч. После изменения состава готовую сетку нужно построить заново."],
      ["Подача", "Как меняется подача?", "Выберите первую подачу в настройках матча. До равного счёта у порога победы подача меняется каждые два очка, затем — после каждого. Ошибка счёта исправляется через Undo или коррекцию судьи."],
      ["Рейтинг", "Как считается рейтинг?", "Сначала сравниваются победы, затем процент побед и число матчей. Можно выбрать всё время, текущую неделю или месяц по московскому времени. Учебные и аннулированные матчи не учитываются."],
      ["Команды", "Как устроена команда?", "Капитан приглашает участников и управляет составом. Перед выходом капитан передаёт свою роль. Если активных участников не осталось, команда архивируется."],
      ["Уведомления", "Где найти приглашения?", "Откройте уведомления с главной или из профиля. Приглашения в матч, турнир и судейство действуют 10 минут, в команду — 14 дней. История сохраняет причину завершения приглашения."],
    ] as const;
    await this.db.transaction(async (tx) => {
      for (const [index, [category, title, body]] of articles.entries()) {
        const existing = await tx.query.faqArticles.findFirst({ where: eq(faqArticles.title, title) });
        if (existing) {
          if (existing.body !== body || existing.category !== category) {
            await tx.update(faqArticles).set({ category, body }).where(eq(faqArticles.id, existing.id));
          }
        } else {
          await tx.insert(faqArticles).values({
            id: `00000000-0000-4000-8000-00000000900${index + 1}`,
            category, title, body, sortOrder: index + 1,
          }).onConflictDoNothing();
        }
      }
    });
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
    if (!['bug', 'idea', 'question', 'other'].includes(input.kind) ||
        typeof input.message !== 'string' || !input.message.trim() || input.message.trim().length > 4000) {
      throw Object.assign(new Error("Укажите категорию и сообщение от 1 до 4000 символов"), { code: "VALIDATION" });
    }
    const [row] = await this.db
      .insert(feedbackMessages)
      .values({ ...input, message: input.message.trim() })
      .returning();
    return row;
  }
}
