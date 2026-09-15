import {chromium,request,expect} from '/private/tmp/tab10-ux-audit-20260913/node_modules/@playwright/test/index.mjs';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
const baseURL=process.env.TAB10_E2E_BASE_URL;
const out='/private/tmp/tab10-ux-audit-20260913/docs/audits/2026-09-13-ux-ui/coordinator-rechecks/judge-outcome';
if(!baseURL||!process.env.E2E_ADMIN_EMAIL||!process.env.E2E_ADMIN_PASSWORD) throw Error('Private runtime inputs required');
await mkdir(out,{recursive:true});
const actors=[];
async function mutate(ctx,url,data={},method='POST') {
 const cookie=(await ctx.storageState()).cookies.find(c=>c.name==='tab10_csrf');
 const res=await ctx.fetch(url,{method,data,headers:{'idempotency-key':randomUUID(),...(cookie?{'x-csrf-token':decodeURIComponent(cookie.value)}:{})}});
 if(!res.ok()) throw Error(`Setup ${method} ${url}: ${res.status()}`);
 return res.json();
}
const admin=await request.newContext({baseURL});
let browser;
try {
 const health=await (await admin.get('/health')).json();
 if(health.release?.environment!=='test') throw Error('Disposable test environment required');
 await mutate(admin,'/api/v1/auth/login',{email:process.env.E2E_ADMIN_EMAIL,password:process.env.E2E_ADMIN_PASSWORD});
 for(const [firstName,lastName] of [['Ведущий','Контрольный'],['ИгрокА','Контрольный'],['ИгрокБ','Контрольный']]){
  const created=await mutate(admin,'/api/v1/admin/users',{email:`root-${randomUUID()}@tab10.test`,firstName,lastName,role:'user'});
  const ctx=await request.newContext({baseURL});
  await mutate(ctx,'/api/v1/auth/login',{email:created.user.email,password:created.temporaryPassword});
  await mutate(ctx,'/api/v1/auth/password/first-change',{newPassword:randomBytes(12).toString('hex')+'Az1!'});
  await mutate(ctx,'/api/v1/me/onboarding',{action:'complete'},'PATCH');
  actors.push({ctx,user:created.user});
 }
 const operator=actors[0];
 const created=await mutate(operator.ctx,'/api/v1/matches',{title:'Проверка координатора: потеря ответа',format:'1v1',pointsToWin:11,mercyEnabled:false,mercyPoints:null,firstServerMethod:'manual',source:'manual',sendPlayerInvitations:false,participants:[{side:'A',userId:actors[1].user.id},{side:'B',userId:actors[2].user.id}]});
 const id=created.match.id;
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({baseURL,viewport:{width:390,height:844},storageState:await operator.ctx.storageState()});
 const page=await context.newPage();page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(15000);
 await page.goto(`/matches/${id}/judge`);
 await page.getByTestId('judge-setup').waitFor();
 await page.getByRole('radio').first().check();
 await page.getByRole('button',{name:'Начать матч',exact:true}).click();
 await page.getByRole('group',{name:'Счёт матча',exact:true}).waitFor();
 const read=async()=> (await (await operator.ctx.get(`/api/v1/matches/${id}`)).json()).match;
 const before=await read();
 let firstKey,secondKey,committedStatus;
 const pattern=new RegExp(`/api/v1/matches/${id}/points$`);
 await page.route(pattern,async route=>{
  firstKey=route.request().headers()['idempotency-key'];
  const committed=await route.fetch();committedStatus=committed.status();
  await route.abort('failed');
 });
 await page.getByRole('button',{name:/\+1 очко:/}).first().click();
 await expect(page.getByRole('alert')).toContainText('повторите');
 await expect(page.locator('.judge-side__score').first()).toHaveText('1');
 const afterLoss=await read();
 const alert=await page.getByRole('alert').innerText();
 await page.screenshot({path:`${out}/lost-response-390.png`});
 await page.unroute(pattern);
 page.on('request',r=>{if(pattern.test(r.url())&&r.method()==='POST')secondKey=r.headers()['idempotency-key'];});
 // Intentionally follow the misleading instruction in this disposable fixture.
 await page.getByRole('button',{name:/\+1 очко:/}).first().click();
 await expect(page.locator('.judge-side__score').first()).toHaveText('2');
 const afterRepeat=await read();
 await page.screenshot({path:`${out}/following-repeat-390.png`});
 const checks={beforeZero:before.scoreA===0,firstCommitted:committedStatus===200,afterLossOne:afterLoss.scoreA===1,exactFirstIntentPresent:afterLoss.idempotencyKeys.includes(firstKey),instructionSaysRepeat:/повторите/.test(alert),afterRepeatTwo:afterRepeat.scoreA===2,newIntent:!!secondKey&&secondKey!==firstKey,secondIntentPresent:afterRepeat.idempotencyKeys.includes(secondKey)};
 if(Object.values(checks).some(v=>!v)) throw Error('Minimal reproduction assertion failed');
 await writeFile(`${out}/receipt.json`,JSON.stringify({run:'ROOT-JUDGE-OUTCOME-01',verdict:'REPRODUCED',environment:'disposable_local',sourceFingerprint:'8e8762575a07e71a17192da327cbe1b5906ca33c1c2ef762c0f9a37463b94cb3',matchId:id,viewport:'390x844',browser:browser.version(),checks,scoreBefore:[before.scoreA,before.scoreB],scoreAfterLoss:[afterLoss.scoreA,afterLoss.scoreB],scoreAfterFollowingInstruction:[afterRepeat.scoreA,afterRepeat.scoreB],alert,limitation:'Controlled response loss and automated action; no human frequency observation; no production mutation'},null,2)+'\n');
 console.log(JSON.stringify({verdict:'REPRODUCED',checks,evidence:out}));
 await context.close();
}finally{
 if(browser)await browser.close();
 for(const a of actors)await a.ctx.dispose();
 await admin.dispose();
}
