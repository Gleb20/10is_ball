import AxeBuilder from "@axe-core/playwright";
import { expect, request, test, type Page, type APIRequestContext } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
let sequence = 0;
const baseURL = process.env.TAB10_E2E_BASE_URL ?? "http://localhost:4273";
const email = process.env.E2E_ADMIN_EMAIL ?? "delivery.admin@tab10.test";
const password = process.env.E2E_ADMIN_PASSWORD ?? "DeliveryVerify9!";
const viewports = [{width:360,height:640},{width:390,height:844},{width:440,height:956},{width:768,height:1024},{width:1440,height:900}];
async function capture(page: Page, name: string) {
  const dir = path.join(process.env.VERIFY_EVIDENCE_DIR!, "f-captures"); await mkdir(dir,{recursive:true});
  await page.screenshot({path:path.join(dir,`${test.info().project.name}-${name}.png`)});
}
async function axe(page: Page, name: string) {
  const results = await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();
  const dir=path.join(process.env.VERIFY_EVIDENCE_DIR!,"f-axe"); await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,`${test.info().project.name}-${name}.json`),JSON.stringify({violations:results.violations,incomplete:results.incomplete},null,2));
  expect.soft(results.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),name).toEqual([]);
}
async function targets(page: Page) {
  const small=await page.locator('a[href], button, input:not([type=radio]):not([type=checkbox]):not([type=hidden]), select').evaluateAll(nodes=>nodes.flatMap(n=>{
    const r=n.getBoundingClientRect(); const style=getComputedStyle(n);
    return r.width && r.height && style.visibility!=="hidden" && (r.width<43.9 || r.height<43.9) ? [{tag:n.tagName,text:n.textContent?.trim().slice(0,45),width:r.width,height:r.height}] : [];
  }));
  expect.soft(small).toEqual([]);
}
async function enlargeText(page: Page) {
  await page.evaluate(() => {
    const sizes = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter(element => element instanceof HTMLElement)
      .map(element => [element, parseFloat(getComputedStyle(element).fontSize)] as const);
    for (const [element, size] of sizes) element.style.fontSize = `${size * 2}px`;
  });
}
async function noClippedActions(page: Page) {
  expect.soft(await page.locator('a[href], button, input:not([type=radio]):not([type=checkbox]), select').evaluateAll(nodes => nodes.flatMap(node => {
    if (node.closest('.tournament-bracket__scroll')) return [];
    const rect=node.getBoundingClientRect();
    return rect.width && rect.height && (rect.left < -1 || rect.right > innerWidth + 1) ? [node.getAttribute('aria-label') || node.textContent?.trim()] : [];
  }))).toEqual([]);
}
async function mutate(api:APIRequestContext,url:string,data:unknown={},method="POST") {
  const csrf=(await api.storageState()).cookies.find(c=>c.name==="tab10_csrf");
  const prefix=createHash("sha256").update(test.info().project.name+test.info().title).digest("hex").slice(0,8);
  const res=await api.fetch(url,{method,data,headers:{...(csrf?{"x-csrf-token":decodeURIComponent(csrf.value)}:{}),"idempotency-key":`${prefix}-0000-4000-8000-${String(++sequence).padStart(12,"0")}`}});
  expect(res.status(),`${method} ${url}: ${await res.text()}`).toBeLessThan(300);return res.json();
}
async function fixture() {
 const api=await request.newContext({baseURL});expect((await (await api.get('/health')).json()).release.environment).toBe('test');
 await mutate(api,'/api/v1/auth/login',{email,password});await mutate(api,'/api/v1/me/onboarding',{action:'complete'},'PATCH');return api;
}
async function login(page:Page, destination = /\/$/) {await page.goto('/login');await page.getByLabel('Email').fill(email);await page.getByLabel('Пароль').fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await expect(page).toHaveURL(destination);}

test('Wave F auth geometry contrast and admin readable rows',async({page})=>{
 test.setTimeout(120000);
 let releaseBootstrap!: () => void;
 const bootstrap = new Promise<void>(resolve => { releaseBootstrap = resolve; });
 await page.route('**/api/v1/auth/me',async route=>{await bootstrap;await route.continue();});
 await page.goto('/login');await expect(page.getByRole('status')).toContainText(/Подключаемся|просыпается/);
 expect(await page.locator('.card').first().evaluate(e=>e.getBoundingClientRect().height)).toBeLessThan(400);
 await capture(page,'bootstrap-loading');releaseBootstrap();await expect(page.getByRole('heading',{name:'Вход',exact:true})).toBeVisible();await page.unrouteAll({behavior:'wait'});
 for(const viewport of viewports){
  await page.setViewportSize(viewport);await page.goto('/login');await expect(page.getByRole('heading',{name:'Вход',exact:true})).toBeVisible();
  await capture(page,`login-${viewport.width}`);await targets(page);await noClippedActions(page);await axe(page,`login-${viewport.width}`);
  expect.soft(await page.evaluate(()=>document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height+1);
 }
 await page.setViewportSize(viewports[0]!);await page.goto('/login');await enlargeText(page);await noClippedActions(page);await capture(page,'login-text200');
 const api=await fixture();try{
  const created = await mutate(api,'/api/v1/admin/users',{email:`f-geometry-${test.info().project.name}@tab10.test`,firstName:'Длинное',lastName:'СинтетическоеИмя',role:'user'});
  // Four active users including the seeded admin guarantee a non-podium row,
  // even when this test runs without earlier waves.
  for (let n=0;n<2;n++) await mutate(api,'/api/v1/admin/users',{
   email:`f-ranking-${test.info().project.name}-${n}@tab10.test`,firstName:'Игрок',lastName:`Рейтинг${n}`,role:'user',
  });
  await login(page);await page.goto('/admin');await expect(page.locator('.list-row--admin').first()).toBeVisible();
  for(const viewport of [viewports[0]!,viewports[4]!]){await page.setViewportSize(viewport);await capture(page,`admin-${viewport.width}`);await targets(page);await noClippedActions(page);
   expect.soft(await page.locator('.list-row--admin .list-row__body').evaluateAll(nodes=>Math.min(...nodes.map(e=>e.getBoundingClientRect().width)))).toBeGreaterThan(160);
  }
 // Wave B gives the shared admin team membership. Use this test's new user
 // for the real empty-team response; do not assume anything about admin teams.
 const rankingUser = await request.newContext({baseURL});
 try {
  await mutate(rankingUser,'/api/v1/auth/login',{email:created.user.email,password:created.temporaryPassword});
  await mutate(rankingUser,'/api/v1/auth/password/first-change',{newPassword:'GeometryFixture9!'});
  await mutate(rankingUser,'/api/v1/me/onboarding',{action:'complete'},'PATCH');
  await page.context().clearCookies();
  await page.context().addCookies((await rankingUser.storageState()).cookies);
  for (const viewport of [viewports[0]!,viewports[4]!]) {
   await page.setViewportSize(viewport);
   const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/rankings' && response.request().method() === 'GET');
   await page.goto('/rankings');
   const response = await loaded; expect(response.status()).toBe(200);
   const rankings = await response.json();
   expect(rankings.availableTeams).toEqual([]);
   expect(rankings.rankings.length).toBeGreaterThanOrEqual(4);
   await expect(page.getByRole('heading',{name:'Рейтинг',exact:true})).toBeVisible();
   await expect(page.getByRole('group',{name:'Период рейтинга',exact:true}).getByRole('button')).toHaveCount(3);
   await expect(page.getByRole('link',{name:'Создать команду',exact:true})).toBeVisible();
   const restRow = page.locator('.ranking-row').first();
   await expect(restRow).toBeVisible();
   const restPlayer = rankings.rankings[3];
   await expect(restRow.getByRole('link',{name:`Открыть карточку ${restPlayer.displayName}`,exact:true})).toBeVisible();
   await expect(restRow.getByText(restPlayer.displayName,{exact:true})).toBeVisible();
   await expect(restRow.locator('[role="img"]')).toHaveAttribute('aria-hidden','true');
   await expect(restRow.getByRole('img')).toHaveCount(0);
   await targets(page);await noClippedActions(page);await axe(page,`rankings-${viewport.width}`);await capture(page,`rankings-targets-${viewport.width}`);
  }
 } finally { await rankingUser.dispose(); }
 }finally{await api.dispose();}
});

test('Wave F algorithm focus and bracket keyboard geometry',async({page})=>{
 test.setTimeout(120000);const api=await fixture();try{
 const {tournament}=await mutate(api,'/api/v1/tournaments',{title:`F bracket ${test.info().project.name}`,organizerParticipates:false});
 for(let i=0;i<8;i++)await mutate(api,`/api/v1/tournaments/${tournament.id}/participants`,{guestFirstName:`Гость${i}`,guestLastName:'Проверочный'});
 await login(page);await page.goto(`/tournaments/${tournament.id}`);
 const trigger=page.getByTestId('tournament-build-bracket');await trigger.click();const dialog=page.getByRole('dialog');
 await expect(dialog).toBeVisible();await capture(page,'dialog-before');await targets(page);await axe(page,'dialog');
 const close=dialog.getByRole('button',{name:'Закрыть',exact:true});
 await close.focus();await page.keyboard.press('Shift+Tab');await expect(dialog.getByRole('button',{name:'Построить сетку',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(close).toBeFocused();
 const radio=dialog.getByRole('radio').last();await radio.focus();await radio.press('Space');await expect.soft(radio).toBeFocused();
 await radio.press('Escape');await expect(dialog).not.toBeVisible();await expect.soft(trigger).toBeFocused();
 await trigger.click();await page.setViewportSize(viewports[0]!);await enlargeText(page);await noClippedActions(page);await capture(page,'dialog-text200');const confirm=dialog.getByRole('button',{name:'Построить сетку',exact:true});await confirm.scrollIntoViewIfNeeded();await expect(confirm).toBeInViewport();await capture(page,'dialog-text200-actions');await page.keyboard.press('Escape');
 await mutate(api,`/api/v1/tournaments/${tournament.id}/bracket`,{constructionAlgorithm:'compact'});await page.reload();
 await expect(page.locator('.tournament-bracket__scroll').first()).toBeVisible();
 for(const viewport of viewports){await page.setViewportSize(viewport);await page.locator('.tournament-bracket__scroll').first().focus();await page.locator('.tournament-bracket__scroll').first().evaluate(e=>{e.scrollTop=0;e.scrollLeft=0;});await expect.poll(()=>page.locator('.tournament-bracket__round-title').first().evaluate(e=>Math.round(e.getBoundingClientRect().top))).toBe(await page.locator('.tournament-bracket__scroll').first().evaluate(e=>Math.round(e.getBoundingClientRect().top)));await capture(page,`bracket-${viewport.width}`);await targets(page);}
 const region=page.locator('.tournament-bracket__scroll').first();await expect.soft(region).toHaveAttribute('tabindex','0');
 await page.setViewportSize(viewports[0]!);await axe(page,'bracket');
 await region.focus();await page.keyboard.press('End');expect(await region.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0);await page.keyboard.press('Home');expect(await region.evaluate(e=>e.scrollLeft)).toBe(0);
 await region.evaluate(e=>{e.scrollTop=100;});
 await expect.poll(()=>page.locator('.tournament-bracket__round-title').first().evaluate(e=>Math.round(e.getBoundingClientRect().top))).toBe(await region.evaluate(e=>Math.round(e.getBoundingClientRect().top)));
 await region.evaluate(e=>{e.scrollTop=0;});
 if (test.info().project.name.includes('mobile')) {
   const box=await region.boundingBox();expect(box).not.toBeNull();
   const y=Math.round(Math.max(20, Math.min(550,box!.y+100)));const right=Math.round(box!.x+box!.width-30);const left=Math.round(box!.x+30);
   const cdp=await page.context().newCDPSession(page);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:right,y}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:left,y}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await expect.poll(()=>region.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0);await cdp.detach();
 }
 const zoomIn=page.getByRole('button',{name:/Увеличить сетку/}).first();const original=await page.locator('.tournament-bracket__column').first().evaluate(e=>e.getBoundingClientRect().width);
 await zoomIn.click();expect(await page.locator('.tournament-bracket__column').first().evaluate(e=>e.getBoundingClientRect().width)).toBeGreaterThan(original);await targets(page);
 await page.emulateMedia({reducedMotion:'reduce'});await enlargeText(page);await noClippedActions(page);await region.focus();await region.evaluate(e=>{e.scrollTop=0;e.scrollLeft=0;});await capture(page,'bracket-text200');
 }finally{await api.dispose();}
});

test('Wave F judge disclosure score and landscape',async({page})=>{
 test.setTimeout(120000);const api=await fixture();let id:string|undefined;try{
 await login(page);await page.goto('/matches/new');await page.getByLabel('Название').fill('F judge');await page.getByRole('button',{name:'Гость',exact:true}).click();await page.getByLabel('Гость (Имя Фамилия)').fill('Гость Проверочный');await page.getByRole('button',{name:'Создать матч',exact:true}).click();await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);id=page.url().split('/').at(-1);
 await page.getByRole('button',{name:'Судить',exact:true}).click();await page.getByRole('radio',{name:/Tab10 Admin/}).check();await page.getByRole('button',{name:'Начать матч',exact:true}).click();await expect(page.getByRole('group',{name:'Счёт матча',exact:true})).toBeVisible();
 for(const viewport of [...viewports,{width:640,height:360},{width:844,height:390}]){await page.setViewportSize(viewport);await capture(page,`judge-${viewport.width}`);await targets(page);expect.soft(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);}
 await page.getByRole('button',{name:'Ещё',exact:true}).click();await expect.soft(page.getByRole('menu')).toHaveCount(0);await axe(page,'judge-more');
 await page.getByRole('button',{name:'Поменять местами на экране',exact:true}).focus();await page.keyboard.press('Escape');await expect.soft(page.getByRole('button',{name:'Ещё',exact:true})).toBeFocused();
 await expect.soft(page.locator('[data-testid="judge-score-announcement"]')).toHaveAttribute('aria-live','polite');
 await page.getByRole('button',{name:/\+1 очко: Tab10 Admin/}).click();await expect(page.getByTestId('judge-score-announcement')).toContainText('Tab10 Admin: 1');
 expect((await (await api.get(`/api/v1/matches/${id}`)).json()).match.scoreA).toBe(1);
 await page.emulateMedia({reducedMotion:'reduce'});expect(await page.getByTestId('judge-side-A').evaluate(e=>parseFloat(getComputedStyle(e).animationDuration))).toBeLessThanOrEqual(.01);
 await page.setViewportSize(viewports[0]!);await enlargeText(page);await noClippedActions(page);await capture(page,'judge-text200');
 }finally{if(id) { const before=(await (await api.get(`/api/v1/matches/${id}`)).json()).match; await mutate(api,`/api/v1/matches/${id}/cancel`,{expectedVersion:before.version}); const terminal=(await (await api.get(`/api/v1/matches/${id}`)).json()).match; expect(terminal.status).toBe("cancelled"); expect(terminal.activeJudge).toBeNull(); }await api.dispose();}
});


test('Wave F onboarding heading and recovery states keep keyboard context', async ({page}) => {
  test.setTimeout(90000);
  const api=await fixture();
  try {
    await mutate(api,'/api/v1/me/onboarding',{action:'restart'},'PATCH');
    await login(page, /\/onboarding$/);
    await expect(page.getByRole('heading',{name:'Главная',exact:true})).toBeFocused();
    await page.getByRole('button',{name:'Далее',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Рейтинг',exact:true})).toBeFocused();
    await capture(page,'onboarding-focus');
    await mutate(api,'/api/v1/me/onboarding',{action:'complete'},'PATCH');
    await page.goto('/');await expect(page.getByRole('heading',{name:/Привет/})).toBeVisible();
    await page.keyboard.press('Tab');await page.getByRole('link',{name:'К содержимому',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.locator('#main-content')).toBeFocused();
    await page.goto('/notifications');await axe(page,'notifications');
    // A read failure must leave a visible recovery action and an announced error.
    await page.route('**/api/v1/notifications',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'UNAVAILABLE',message:'Синтетическая ошибка'})}));
    await page.reload();await expect(page.getByRole('button',{name:/Повторить|Обновить/}).first()).toBeVisible();await expect(page.getByRole('alert').first()).toBeVisible();
    await capture(page,'notifications-error');await page.unroute('**/api/v1/notifications');
  } finally { await api.dispose(); }
});

test('Wave F dialog review recovers hidden removed and busy focus', async ({ page }) => {
  test.setTimeout(90000);
  const api = await fixture();
  let releaseRequest: (() => void) | undefined;
  try {
    const { tournament } = await mutate(api, '/api/v1/tournaments', {
      title: `F dialog review ${test.info().project.name}`, organizerParticipates: false,
    });
    for (let n = 0; n < 3; n++) await mutate(api, `/api/v1/tournaments/${tournament.id}/participants`, {
      guestFirstName: `Гость${n}`, guestLastName: 'Диалог',
    });
    await login(page); await page.goto(`/tournaments/${tournament.id}`);
    const trigger = page.getByTestId('tournament-build-bracket'); await trigger.click();
    const dialog = page.getByRole('dialog');
    const close = dialog.getByRole('button', { name: 'Закрыть', exact: true });
    const submit = dialog.getByRole('button', { name: 'Построить сетку', exact: true });
    await dialog.evaluate(panel => {
      const hidden = document.createElement('div'); hidden.id = 'f-hidden-control'; hidden.style.display = 'none';
      hidden.innerHTML = '<button>Скрытая кнопка</button>'; panel.append(hidden);
    });
    await close.focus(); await page.keyboard.press('Shift+Tab');
    await expect.soft(submit).toBeFocused({ timeout: 1000 });
    await dialog.evaluate(panel => {
      panel.querySelector('#f-hidden-control')?.remove();
      const temporary = document.createElement('button'); temporary.id = 'f-temporary-control'; temporary.textContent = 'Временная';
      panel.append(temporary); temporary.focus(); temporary.remove();
    });
    await expect.soft(close).toBeFocused({ timeout: 1000 });
    const heldRequest = new Promise<void>(resolve => { releaseRequest = resolve; });
    await page.route(`**/api/v1/tournaments/${tournament.id}/bracket`, async route => {
      await heldRequest;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'UNAVAILABLE', message: 'Синтетическая ошибка' }) });
    });
    await submit.focus(); await page.keyboard.press('Enter');
    await expect(dialog.getByRole('button', { name: '…', exact: true })).toBeDisabled();
    await expect.soft(close).toBeFocused({ timeout: 1000 });
    await page.keyboard.press('Tab'); await expect.soft(close).toBeFocused({ timeout: 1000 });
    await page.keyboard.press('Shift+Tab'); await expect.soft(close).toBeFocused({ timeout: 1000 });
    await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
    await capture(page, 'dialog-review-busy');
    releaseRequest();
    await expect(submit).toBeEnabled(); await page.unrouteAll({ behavior: 'wait' });
    await close.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
  } finally {
    releaseRequest?.(); await page.unrouteAll({ behavior: 'wait' }); await api.dispose();
  }
});
