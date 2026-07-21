#!/usr/bin/env node
/**
 * LOCAL ONLY — seed 20 meme test players into the running API.
 * Do not run against production. Data lives in local PGlite dir or Postgres.
 *
 * Usage (API must be up):
 *   node scripts/seed-local-meme-players.mjs
 */
const API = process.env.API_BASE ?? "http://localhost:3001";

const PLAYERS = [
  { email: "ivan.ivanov@tab10.local", firstName: "Иван", lastName: "Иванов" },
  { email: "olga.babusina@tab10.local", firstName: "Ольга", lastName: "Бабусина" },
  { email: "kuzma.domovoy@tab10.local", firstName: "Кузьма", lastName: "Домовой" },
  { email: "petr.pelmenev@tab10.local", firstName: "Пётр", lastName: "Пельменёв" },
  { email: "maria.samovarnaya@tab10.local", firstName: "Мария", lastName: "Самоварная" },
  { email: "sergey.borschev@tab10.local", firstName: "Сергей", lastName: "Борщев" },
  { email: "anna.varenichnaya@tab10.local", firstName: "Анна", lastName: "Вареничная" },
  { email: "dmitry.kotleta@tab10.local", firstName: "Дмитрий", lastName: "Котлета" },
  { email: "elena.grechneva@tab10.local", firstName: "Елена", lastName: "Гречнева" },
  { email: "alexey.shashlykov@tab10.local", firstName: "Алексей", lastName: "Шашлыков" },
  { email: "natalya.blinova@tab10.local", firstName: "Наталья", lastName: "Блинова" },
  { email: "mikhail.holodilnikov@tab10.local", firstName: "Михаил", lastName: "Холодильников" },
  { email: "tatyana.smetanina@tab10.local", firstName: "Татьяна", lastName: "Сметанина" },
  { email: "nikolay.pirozhkov@tab10.local", firstName: "Николай", lastName: "Пирожков" },
  { email: "svetlana.chaynikova@tab10.local", firstName: "Светлана", lastName: "Чайникова" },
  { email: "andrey.valenkov@tab10.local", firstName: "Андрей", lastName: "Валенкофф" },
  { email: "yulia.kvasnaya@tab10.local", firstName: "Юлия", lastName: "Квасная" },
  { email: "vladimir.utyugov@tab10.local", firstName: "Владимир", lastName: "Утюгов" },
  { email: "ekaterina.plyushkina@tab10.local", firstName: "Екатерина", lastName: "Плюшкина" },
  { email: "boris.balalaykin@tab10.local", firstName: "Борис", lastName: "Балалайкин" },
];

const PASSWORD = "UserPass1!";

function makeClient() {
  const jar = new Map();
  function parseSetCookie(cookies) {
    if (!cookies) return;
    for (const raw of cookies) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  async function request(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    const cookies = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookies) headers.Cookie = cookies;
    const csrf = jar.get("tab10_csrf");
    if (csrf && method !== "GET") {
      headers["X-CSRF-Token"] = decodeURIComponent(csrf);
    }
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (typeof res.headers.getSetCookie === "function") {
      parseSetCookie(res.headers.getSetCookie());
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(`${method} ${path} → ${res.status}: ${text}`);
      err.status = res.status;
      err.json = json;
      throw err;
    }
    return json;
  }
  return { request };
}

async function main() {
  const admin = makeClient();
  await admin.request("POST", "/api/v1/auth/login", {
    email: "admin@tab10.local",
    password: "AdminPass1!",
  });
  console.log("Admin OK");

  let ok = 0;
  for (const p of PLAYERS) {
    try {
      const created = await admin.request("POST", "/api/v1/admin/users", {
        email: p.email,
        firstName: p.firstName,
        lastName: p.lastName,
        role: "user",
      });
      const temp = created.temporaryPassword;
      const user = makeClient();
      const login = await user.request("POST", "/api/v1/auth/login", {
        email: p.email,
        password: temp,
      });
      if (login.user?.mustChangePassword) {
        await user.request("POST", "/api/v1/auth/password/first-change", {
          currentPassword: temp,
          newPassword: PASSWORD,
        });
      }
      ok += 1;
      console.log(`✓ ${p.firstName} ${p.lastName} <${p.email}>`);
    } catch (e) {
      if (String(e.message).includes("EMAIL_TAKEN") || String(e.message).includes("409")) {
        console.log(`· already exists ${p.email}`);
        ok += 1;
      } else {
        console.log(`✗ ${p.email}: ${e.message}`);
      }
    }
  }
  console.log(`\nDone: ${ok}/${PLAYERS.length}`);
  console.log(`Password for all: ${PASSWORD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
