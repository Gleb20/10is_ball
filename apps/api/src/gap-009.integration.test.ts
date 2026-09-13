import { afterEach, expect, it } from "vitest";
import { createMigratedPgliteDb } from "./db/client.js";
import { FakeClock } from "@tab10/test-utils";
import { hashToken } from "./modules/auth/auth-service.js";
import { buildApp } from "./app.js";
import { HelpService } from "./modules/notifications/notification-service.js";
import { faqArticles, feedbackMessages, users, authSessions } from "./db/schema.js";
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); });
it("GAP-009 completes existing FAQ, corrects D7 and remains idempotent", async () => {
  const context = await createMigratedPgliteDb(); close = context.close;
  await context.db.insert(faqArticles).values({ category: "Матчи", title: "Кто может судить?", body: "Судейскую сессию может захватить любой участник или приглашённый судья. Одновременно активен только один судья.", sortOrder: 2 });
  const help = new HelpService(context.db);
  await help.seedFaq(); await help.seedFaq();
  const articles = await help.listFaq();
  for (const category of ["Матчи", "Турниры", "Подача", "Рейтинг", "Команды", "Уведомления"]) expect(articles.some(a => a.category === category)).toBe(true);
  expect(articles.filter(a => a.title === "Кто может судить?")).toHaveLength(1);
  expect(articles.find(a => a.title === "Кто может судить?")?.body).toContain("любой активный пользователь");
});
it("GAP-009 validates feedback kinds and text before persistence", async () => {
  const context = await createMigratedPgliteDb(); close = context.close;
  const [user] = await context.db.insert(users).values({ email: "help@test.local", passwordHash: "x", firstName: "Help", lastName: "Synthetic" }).returning();
  const help = new HelpService(context.db);
  for (const kind of ["bug", "idea", "question", "other"]) await help.submitFeedback({ userId: user!.id, kind, message: "Материалы: https://example.com/demo" });
  for (const input of [{kind:"bad",message:"x"},{kind:"bug",message:"   "},{kind:"idea",message:"x".repeat(4001)}]) await expect(help.submitFeedback({userId:user!.id,...input})).rejects.toMatchObject({code:"VALIDATION"});
  expect(await context.db.select().from(feedbackMessages)).toHaveLength(4);
});

it("GAP-009 feedback API rejects invalid and unauthenticated submissions", async () => {
  const context = await createMigratedPgliteDb(); const {app}=await buildApp({db:context.db,clock:new FakeClock(new Date("2026-09-13T10:00:00Z"))});
  close=async()=>{await app.close();await context.close();};
  const [user]=await context.db.insert(users).values({email:"help-api@test.local",passwordHash:"x",firstName:"Help",lastName:"API",mustChangePassword:false}).returning();
  await context.db.insert(authSessions).values({userId:user!.id,tokenHash:hashToken("help-api-synthetic"),expiresAt:new Date("2026-09-20T10:00:00Z")});
  const cookies={tab10_session:"help-api-synthetic"};
  expect((await app.inject({method:"POST",url:"/api/v1/feedback",payload:{kind:"bug",message:"test"}})).statusCode).toBe(401);
  for(const payload of [{kind:"bad",message:"test"},{kind:"idea",message:" "},{kind:"bug",message:"ok",extra:true}]) expect((await app.inject({method:"POST",url:"/api/v1/feedback",cookies,payload})).statusCode).toBe(400);
});
