import { afterEach,expect,it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { eq } from "drizzle-orm";
import { createMigratedPgliteDb } from "./db/client.js";
import { matches,matchParticipants,matchInvitations,notifications,users } from "./db/schema.js";
import { NotificationService } from "./modules/notifications/notification-service.js";
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
