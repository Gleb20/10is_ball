import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { buildApp } from "./app.js";
import { type Db } from "./db/client.js";
import { runPostgresMigrations } from "./db/migrations.js";
import { resolveTestDatabaseUrl } from "./db/test-database-url.js";
import * as schema from "./db/schema.js";
import { MatchService } from "./modules/matches/match-service.js";
const databaseUrl = resolveTestDatabaseUrl(process.env,{required:process.env.REQUIRE_TEST_DATABASE_URL === "1"});
const suite = databaseUrl ? describe : describe.skip;
suite.sequential("GAP-010 canonical admin user locks",()=>{
 const clients:postgres.Sql[]=[];
 let closeApp:()=>Promise<void>;
 beforeAll(async()=>{
  const reset=postgres(databaseUrl!,{max:1});
  try {await reset.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public");} finally {await reset.end();}
  await runPostgresMigrations(databaseUrl!,"apply");
 });
 afterAll(async()=>{await closeApp?.();await Promise.all(clients.map(c=>c.end({timeout:5})));});
 it("a block waiting for a lower UUID target never holds the higher UUID admin",async()=>{
  const user="00000000-0000-4000-8000-000000000001";
  const admin="00000000-0000-4000-8000-000000000002";
  const client=postgres(databaseUrl!,{max:1,connection:{application_name:"gap010_block_order"}});
  const holder=postgres(databaseUrl!,{max:1});const observer=postgres(databaseUrl!,{max:1});clients.push(client,holder,observer);
  const db=drizzle(client,{schema}) as unknown as Db;
  const built=await buildApp({db,clock:new FakeClock(new Date("2026-09-13T12:00:00Z"))});closeApp=()=>built.app.close();
  await db.insert(schema.users).values([{id:user,email:"normal@lock.test",passwordHash:"x",firstName:"Normal",lastName:"Synthetic",mustChangePassword:false},{id:admin,email:"admin@lock.test",passwordHash:"x",firstName:"Admin",lastName:"Synthetic",role:"admin",mustChangePassword:false}]);
  let release!:()=>void;let ready!:()=>void;let inspect!:()=>void;
  const released=new Promise<void>(resolve=>{release=resolve;});const heldReady=new Promise<void>(resolve=>{ready=resolve;});const inspectNow=new Promise<void>(resolve=>{inspect=resolve;});
  const held=holder.begin(async tx=>{
    await tx`select id from users where id=${user} for update`;
    ready();await inspectNow;
    try {await tx`select id from users where id=${admin} for update nowait`;} finally {release();}
  });
  const heldResult=held.then(()=>({ok:true}),error=>({ok:false,code:error.code}));
  await heldReady;
  const blocked=built.services.auth.blockUser(admin,user);
  const blockedResult=blocked.then(()=>({ok:true}),error=>({ok:false,code:error.code}));
  try {
    let waiting=false;
    for(let i=0;i<200;i++){
      const [row]=await observer`select exists(select 1 from pg_stat_activity where application_name='gap010_block_order' and wait_event_type='Lock') as waiting`;
      if(row?.waiting){waiting=true;break;}
      await new Promise<void>(resolve=>setImmediate(resolve));
    }
    expect(waiting).toBe(true);
  } finally {inspect();}
  await released;
  expect(await heldResult).toEqual({ok:true});
  expect(await blockedResult).toEqual({ok:true});
 });
 it("admin delete waits for a match lock and rejects a concurrently finished match",async()=>{
  const setupClient=postgres(databaseUrl!,{max:1});
  const setupDb=drizzle(setupClient,{schema}) as unknown as Db;
  const admin="00000000-0000-4000-8000-000000000011";
  const player="00000000-0000-4000-8000-000000000012";
  const matchId="00000000-0000-4000-8000-000000000013";
  await setupDb.insert(schema.users).values([
   {id:admin,email:"delete-admin@lock.test",passwordHash:"x",firstName:"Delete",lastName:"Admin",role:"admin",mustChangePassword:false},
   {id:player,email:"delete-player@lock.test",passwordHash:"x",firstName:"Delete",lastName:"Player",mustChangePassword:false},
  ]);
  await setupDb.insert(schema.matches).values({id:matchId,title:"Delete race",kind:"standalone",status:"waiting",format:"1v1",createdByUserId:admin});
  await setupDb.insert(schema.matchParticipants).values([
   {matchId,side:"A",userId:admin},
   {matchId,side:"B",userId:player},
  ]);
  const holder=postgres(databaseUrl!,{max:1,connection:{application_name:"gap010-delete-holder"}});
  const deleter=postgres(databaseUrl!,{max:1,connection:{application_name:"gap010-delete-waiter"}});
  const observer=postgres(databaseUrl!,{max:1});
  clients.push(setupClient,holder,deleter,observer);
  const deleteService=new MatchService(drizzle(deleter,{schema}) as unknown as Db,new FakeClock(new Date("2026-09-13T12:00:00Z")));
  let ready!:()=>void;
  let inspect!:()=>void;
  const heldReady=new Promise<void>((resolve)=>{ready=resolve;});
  const inspectNow=new Promise<void>((resolve)=>{inspect=resolve;});
  const held=holder.begin(async(tx)=>{
   await tx`select id from matches where id=${matchId} for update`;
   ready();
   await inspectNow;
   await tx`update matches set status='finished', score_a=11, score_b=7, winner_side='A', started_at=now(), finished_at=now(), version=version+1 where id=${matchId}`;
  });
  await heldReady;
  const deletion=deleteService.adminDeleteMatch({matchId,actorAdminId:admin}).then(
   ()=>({ok:true as const}),
   (error:unknown)=>({ok:false as const,code:(error as {code?:string}).code}),
  );
  let waiting=false;
  for(let attempt=0;attempt<200;attempt+=1){
   const [row]=await observer<{waiting:boolean}[]>`select exists(select 1 from pg_stat_activity where application_name='gap010-delete-waiter' and wait_event_type='Lock') as waiting`;
   if(row?.waiting){waiting=true;break;}
   await new Promise<void>((resolve)=>setImmediate(resolve));
  }
  expect(waiting).toBe(true);
  inspect();
  await held;
  await expect(deletion).resolves.toEqual({ok:false,code:"MATCH_IMMUTABLE"});
  const retained=await setupDb.query.matchParticipants.findMany({where:(row,{eq})=>eq(row.matchId,matchId)});
  expect(retained).toHaveLength(2);
  expect(await setupDb.query.matches.findFirst({where:(row,{eq})=>eq(row.id,matchId)})).toMatchObject({status:"finished",winnerSide:"A",scoreA:11,scoreB:7});
 });
});
