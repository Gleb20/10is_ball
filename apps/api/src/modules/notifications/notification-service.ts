import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { faqArticles, feedbackMessages, notifications } from "../../db/schema.js";

export class NotificationService {
  constructor(private readonly db: Db) {}

  async list(userId: string) {
    return this.db.query.notifications.findMany({
      where: eq(notifications.userId, userId),
      orderBy: [desc(notifications.createdAt)],
    });
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
