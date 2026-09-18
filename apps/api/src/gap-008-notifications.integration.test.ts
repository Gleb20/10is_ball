import { afterEach,expect,it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { eq } from "drizzle-orm";
import { createMigratedPgliteDb } from "./db/client.js";
import { authSessions,matches,matchParticipants,matchInvitations,notifications,users } from "./db/schema.js";
import { NotificationService } from "./modules/notifications/notification-service.js";
import { buildApp } from "./app.js";
import { hashToken } from "./modules/auth/auth-service.js";
let close:(()=>Promise<void>)|undefined;afterEach(async()=>{await close?.();});
async function fixture(){
 const c=await createMigratedPgliteDb();close=c.close;const db=c.db;const clock=new FakeClock(new Date("2026-09-13T10:00:00Z"));
 const people=await db.insert(users).values(["owner","invitee"].map(n=>({email:`${n}@notification.test`,firstName:n,lastName:"Synthetic",passwordHash:"x",mustChangePassword:false}))).returning();
 const [match]=await db.insert(matches).values({title:"Invitation fixture",format:"1v1",createdByUserId:people[0]!.id}).returning();
 await db.insert(matchParticipants).values({matchId:match!.id,side:"A",userId:people[0]!.id});
 const [participant]=await db.insert(matchParticipants).values({matchId:match!.id,side:"B",userId:people[1]!.id}).returning();
 const [invitation]=await db.insert(matchInvitations).values({matchId:match!.id,matchParticipantId:participant!.id,participantSide:"B",invitedUserId:people[1]!.id,invitedByUserId:people[0]!.id,kind:"player",expiresAt:new Date(clock.now().getTime()+600000)}).returning();
 const [notification]=await db.insert(notifications).values({userId:people[1]!.id,type:"match_invitation",title:"Invite",body:"Play",payload:{invitationId:invitation!.id,matchId:match!.id}}).returning();
 return{db,clock,match:match!,invitation:invitation!,participant:participant!,notification:notification!,invitee:people[1]!.id,service:new NotificationService(db,clock)};
}
it("GAP-008 read player invitation stays actionable until exact expiry, then history records timeout",async()=>{
 const f=await fixture();await f.service.markRead(f.invitee,f.notification.id);
 expect((await f.service.list(f.invitee))[0]).toMatchObject({actionable:true,lifecycle:"read"});
 f.clock.advanceMs(600000);
 expect((await f.service.list(f.invitee))[0]).toMatchObject({actionable:false,lifecycle:"expired",reasonCode:"timeout",lifecycleAt:f.clock.now()});
 expect(await f.db.query.matchInvitations.findFirst({where:eq(matchInvitations.id,f.invitation.id)})).toMatchObject({status:"expired",expiryReason:"timeout"});
 expect(await f.service.unreadCount(f.invitee)).toBe(0);
});
it("GAP-008 event and roster invalidation retain nonactionable invitation history",async()=>{
 const f=await fixture();await f.db.update(matches).set({status:"in_progress"}).where(eq(matches.id,f.match.id));
 expect((await f.service.list(f.invitee))[0]).toMatchObject({actionable:false,lifecycle:"cancelled",reasonCode:"match_started"});
 expect((await f.service.unread(f.invitee))).toHaveLength(0);
});

it.each([['cancelled','match_cancelled'],['finished','match_finished'],['stopped','match_finished']])("GAP-008 %s event keeps its terminal invitation reason",async(status,reasonCode)=>{
 const f=await fixture();await f.db.update(matches).set({status}).where(eq(matches.id,f.match.id));
 expect((await f.service.list(f.invitee))[0]).toMatchObject({actionable:false,lifecycle:"cancelled",reasonCode});
 expect(await f.service.unreadCount(f.invitee)).toBe(0);
});
it("GAP-008 removed participant keeps historical identity with a roster reason",async()=>{
 const f=await fixture();await f.db.delete(matchParticipants).where(eq(matchParticipants.id,f.participant.id));
 expect((await f.service.list(f.invitee))[0]).toMatchObject({actionable:false,lifecycle:"cancelled",reasonCode:"roster_changed"});
 expect(await f.db.query.matchInvitations.findFirst({where:eq(matchInvitations.id,f.invitation.id)})).toMatchObject({matchParticipantId:f.participant.id});
});

it("GAP-029 projects visible notifications before count and first five without reading hidden invitations", async () => {
 const f = await fixture();
 await f.db.insert(notifications).values([
  ...Array.from({length:6},(_,index)=>({userId:f.invitee,type:"judge_invitation",title:`Hidden ${index}`,body:"Hidden",createdAt:new Date(`2026-09-13T10:0${index}:00Z`)})),
  ...Array.from({length:6},(_,index)=>({userId:f.invitee,type:index===0?"team_invitation":"judge_handover_offered",title:`Visible ${index}`,body:"Visible",createdAt:new Date(`2026-09-13T09:0${index}:00Z`)})),
 ]);
 const snapshot = await f.service.visibleSnapshot(f.invitee);
 expect(snapshot.notifications.map((row)=>row.type)).not.toContain("match_invitation");
 expect(snapshot.notifications.map((row)=>row.type)).not.toContain("judge_invitation");
 expect(snapshot.notifications).toHaveLength(6);
 expect(snapshot.unreadCount).toBe(6);
 expect(snapshot.unreadNotifications).toHaveLength(5);
 expect(snapshot.unreadNotifications[0]?.title).toBe("Visible 5");
 expect(await f.db.query.matchInvitations.findFirst({where:eq(matchInvitations.id,f.invitation.id)})).toMatchObject({status:"pending"});
 expect(await f.db.query.notifications.findFirst({where:eq(notifications.id,f.notification.id)})).toMatchObject({readAt:null});
});

it("GAP-029 opt-in endpoints agree while legacy API and pending invitation remain intact", async () => {
 const f = await fixture();
 const built = await buildApp({db:f.db,clock:f.clock});
 const previousClose = close;
 close = async()=>{await built.app.close();await previousClose?.();};
 await f.db.insert(authSessions).values({userId:f.invitee,tokenHash:hashToken("visible-owner"),expiresAt:new Date("2026-09-20T10:00:00Z")});
 const [handover] = await f.db.insert(notifications).values({userId:f.invitee,type:"judge_handover_offered",title:"Handover",body:"Judge",payload:{matchId:f.match.id}}).returning();
 const cookies={tab10_session:"visible-owner"};
 const legacy=await built.app.inject({method:"GET",url:"/api/v1/notifications",cookies});
 expect(legacy.statusCode).toBe(200);
 expect(legacy.json().notifications.map((row:{type:string})=>row.type)).toContain("match_invitation");
 const available=await built.app.inject({method:"GET",url:"/api/v1/notifications?notificationView=available",cookies});
 expect(available.statusCode).toBe(200);
 expect(available.json()).toMatchObject({notificationView:"available",unreadCount:1});
 expect(available.json().notifications.map((row:{id:string})=>row.id)).toEqual([handover!.id]);
 const home=await built.app.inject({method:"GET",url:"/api/v1/home?notificationView=available",cookies});
 expect(home.statusCode).toBe(200);
 expect(home.json().unreadCount).toBe(1);
 expect(home.json().unreadNotifications.map((row:{id:string})=>row.id)).toEqual([handover!.id]);
 const read=await built.app.inject({method:"POST",url:"/api/v1/notifications/read-visible?notificationView=available",cookies,payload:{notificationIds:[handover!.id,f.notification.id]}});
 expect(read.statusCode).toBe(200);
 expect(read.json().notifications.map((row:{id:string})=>row.id)).toEqual([handover!.id]);
 expect(await f.db.query.matchInvitations.findFirst({where:eq(matchInvitations.id,f.invitation.id)})).toMatchObject({status:"pending"});
 expect(await f.db.query.notifications.findFirst({where:eq(notifications.id,f.notification.id)})).toMatchObject({readAt:null});
});

it("GAP-029 legacy read-visible still marks an own hidden invitation notification read", async () => {
 const f = await fixture();
 const built = await buildApp({db:f.db,clock:f.clock});
 const previousClose = close;
 close = async()=>{await built.app.close();await previousClose?.();};
 await f.db.insert(authSessions).values({userId:f.invitee,tokenHash:hashToken("legacy-read-owner"),expiresAt:new Date("2026-09-20T10:00:00Z")});
 const read=await built.app.inject({method:"POST",url:"/api/v1/notifications/read-visible",cookies:{tab10_session:"legacy-read-owner"},payload:{notificationIds:[f.notification.id]}});
 expect(read.statusCode).toBe(200);
 expect(read.json().notifications.map((row:{id:string})=>row.id)).toEqual([f.notification.id]);
 expect(await f.db.query.notifications.findFirst({where:eq(notifications.id,f.notification.id)})).toMatchObject({readAt:f.clock.now()});
 expect(await f.db.query.matchInvitations.findFirst({where:eq(matchInvitations.id,f.invitation.id)})).toMatchObject({status:"pending"});
});
