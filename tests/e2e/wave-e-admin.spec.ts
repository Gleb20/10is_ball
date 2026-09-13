import { expect, request, test, type APIRequestContext } from "@playwright/test";
const baseURL=process.env.TAB10_E2E_BASE_URL??"http://localhost:4273";
const email=process.env.E2E_ADMIN_EMAIL??"delivery.admin@tab10.test";
const password=process.env.E2E_ADMIN_PASSWORD??"DeliveryVerify9!";
async function mutate(api:APIRequestContext,path:string,data:unknown,method="POST"){
 const cookie=(await api.storageState()).cookies.find(c=>c.name==="tab10_csrf");
 const response=await api.fetch(path,{method,data,headers:cookie?{"x-csrf-token":decodeURIComponent(cookie.value)}:{}});
 expect(response.status(),path).toBeLessThan(300);return response.json();
}
test("Wave E ADM catalog, first login, profile, role and block lifecycle",async({page,browser},info)=>{
 const admin=await request.newContext({baseURL});
 expect((await(await admin.get("/health")).json()).release.environment).toBe("test");
 await mutate(admin,"/api/v1/auth/login",{email,password});
 await mutate(admin,"/api/v1/me/onboarding",{action:"complete"},"PATCH");
 const targetEmail=`e-admin-${info.project.name}@tab10.test`;
 const member=await browser.newContext({baseURL,viewport:{width:390,height:844}});const memberPage=await member.newPage();
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));memberPage.on("pageerror",e=>errors.push(e.message));
 try{
  await page.goto("/login");await page.getByLabel("Email",{exact:true}).fill(email);await page.getByLabel("Пароль",{exact:true}).fill(password);await page.getByRole("button",{name:"Войти",exact:true}).click();await expect(page).toHaveURL(/\/$/);
  await page.goto("/admin");const create=page.getByRole("form",{name:"Создание пользователя"});
  await create.getByLabel("Email",{exact:true}).fill(targetEmail);await create.getByLabel("Имя",{exact:true}).fill("Новый");await create.getByLabel("Фамилия",{exact:true}).fill("Проверочный");
  await create.getByRole("button",{name:"Создать",exact:true}).click();
  const temporary=await page.getByTestId("temp-password-value").innerText();
  await page.getByRole("dialog").getByRole("button",{name:"Готово",exact:true}).click();
  await page.getByLabel("Имя или email").fill(targetEmail);await page.getByRole("button",{name:"Найти",exact:true}).click();
  const row=page.locator(".list-row--admin").filter({hasText:targetEmail});await expect(row).toHaveCount(1);await expect(row.getByText("Ещё не входил")).toBeVisible();
  await memberPage.goto("/login");await memberPage.getByLabel("Email",{exact:true}).fill(targetEmail);await memberPage.getByLabel("Пароль",{exact:true}).fill(temporary);await memberPage.getByRole("button",{name:"Войти",exact:true}).click();
  await expect(memberPage).toHaveURL(/\/first-password$/);
  await memberPage.getByLabel("Новый пароль",{exact:true}).fill("WaveEAdmin9!");
  await memberPage.getByLabel("Повторите пароль",{exact:true}).fill("WaveEAdmin9!");
  await memberPage.getByRole("button",{name:/Сохранить/}).click();
  await expect(memberPage).toHaveURL(/\/onboarding$/);await memberPage.getByRole("button",{name:"Закрыть онбординг",exact:true}).click();await expect(memberPage).toHaveURL(/\/$/);
  expect((await member.request.get("/api/v1/admin/users")).status()).toBe(403);
  await row.getByRole("button",{name:"Редактировать",exact:true}).click();const edit=page.getByRole("dialog",{name:"Профиль пользователя"});
  await expect(edit.getByLabel("Email",{exact:true})).toHaveAttribute("readonly","");
  await edit.getByLabel("Имя",{exact:true}).fill("Обновлённый");await edit.getByLabel("Дата рождения").fill("1990-02-03");await edit.getByLabel("Организация").fill("Синтетический клуб");await edit.getByLabel("Должность").fill("Участник");await edit.getByRole("button",{name:"Сохранить",exact:true}).click();await expect(edit).toHaveCount(0);
  const dto=(await(await admin.get(`/api/v1/admin/users?q=${encodeURIComponent(targetEmail)}`)).json()).users[0];
  expect(dto).toMatchObject({firstName:"Обновлённый",birthDate:"1990-02-03",organizationText:"Синтетический клуб",positionText:"Участник"});expect(dto.lastLoginAt).toBeTruthy();
  expect((await member.request.get("/api/v1/auth/me")).status()).toBe(200);
  await row.getByRole("button",{name:"Сделать админом",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:"Подтвердить",exact:true}).click();await expect(row.getByRole("button",{name:"Снять админа",exact:true})).toBeVisible();expect((await member.request.get("/api/v1/auth/me")).status()).toBe(401);
  await row.getByRole("button",{name:"Снять админа",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:"Подтвердить",exact:true}).click();
  await row.getByRole("button",{name:"Блок",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:"Подтвердить",exact:true}).click();await expect(row.getByRole("button",{name:"Разблокировать",exact:true})).toBeVisible();
  await page.getByLabel("Статус",{exact:true}).selectOption("blocked");await expect(row).toHaveCount(1);
  await row.getByRole("button",{name:"Разблокировать",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:"Подтвердить",exact:true}).click();await expect(page.getByText("Пользователи не найдены",{exact:true})).toBeVisible();
  await page.getByLabel("Статус",{exact:true}).selectOption("active");await expect(row).toHaveCount(1);expect((await member.request.get("/api/v1/auth/me")).status()).toBe(401);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath("admin-catalog.png"),fullPage:true});expect(errors).toEqual([]);
 }finally{await member.close();await admin.dispose();}
});
