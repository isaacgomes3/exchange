#!/usr/bin/env node
/**
 * Diagnóstico: cadastros/credenciais do Auth compartilhado (legado = novo).
 *
 * Uso na VPS (com SERVICE_ROLE_KEY no ambiente ou .env):
 *   node scripts/vps-diagnose-auth-credentials.mjs
 *   EMAIL=user@x.com node scripts/vps-diagnose-auth-credentials.mjs
 *   CONFIRM=1 EMAIL=user@x.com node ...          # confirma e-mail desse usuário
 *   CONFIRM_ALL=1 node ...                       # confirma todos sem email_confirmed_at
 *
 * Não imprime SERVICE_ROLE_KEY. Não redefine senhas.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const EMAIL = String(process.env.EMAIL || "izypolzebets@gmail.com")
  .trim()
  .toLowerCase();
const CONFIRM = process.env.CONFIRM === "1" || process.env.CONFIRM === "true";
const CONFIRM_ALL =
  process.env.CONFIRM_ALL === "1" || process.env.CONFIRM_ALL === "true";
const MAX_PAGES = Number(process.env.AUTH_USERS_MAX_PAGES || 30);

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

const envCandidates = [
  process.env.ENV_FILE,
  "/opt/arbishield/deploy/vps-supabase/.env",
  "/opt/arbishield/.arbishield-odds-sync.env",
  "/opt/arbishield/.env",
  path.resolve("deploy/vps-supabase/.env"),
  path.resolve(".env"),
].filter(Boolean);

for (const f of envCandidates) loadEnvFile(f);

const SERVICE_KEY =
  process.env.ARBISHIELD_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SUPABASE_URL = (
  process.env.ARBISHIELD_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.API_EXTERNAL_URL ||
  "http://127.0.0.1:8000"
).replace(/\/$/, "");

const PUBLIC_URL = (
  process.env.SITE_URL ||
  process.env.PUBLIC_URL ||
  "https://arbishield.app"
).replace(/\/$/, "");

if (!SERVICE_KEY) {
  console.error(
    "ERRO: SERVICE_ROLE_KEY ausente. Defina no .env da VPS ou exporte SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

async function admin(pathname, { method = "GET", body } = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, data };
}

async function listUsers() {
  const users = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { ok, status, data } = await admin(
      `/auth/v1/admin/users?page=${page}&per_page=200`
    );
    if (!ok) {
      throw new Error(`admin/users page ${page}: HTTP ${status} ${JSON.stringify(data)}`);
    }
    const batch = Array.isArray(data?.users)
      ? data.users
      : Array.isArray(data)
        ? data
        : [];
    users.push(...batch);
    if (batch.length < 200) break;
  }
  return users;
}

async function findUserByEmail(email) {
  // GoTrue: filter by email when supported
  const q = await admin(
    `/auth/v1/admin/users?page=1&per_page=200&email=${encodeURIComponent(email)}`
  );
  if (q.ok) {
    const batch = Array.isArray(q.data?.users)
      ? q.data.users
      : Array.isArray(q.data)
        ? q.data
        : [];
    const hit = batch.find(
      (u) => String(u.email || "").toLowerCase() === email
    );
    if (hit) return hit;
  }
  const all = await listUsers();
  return all.find((u) => String(u.email || "").toLowerCase() === email) || null;
}

async function confirmUser(user) {
  const { ok, status, data } = await admin(`/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    body: { email_confirm: true },
  });
  if (!ok) {
    throw new Error(`confirm ${user.email}: HTTP ${status} ${JSON.stringify(data)}`);
  }
  return data;
}

function summarizeUser(u) {
  const identities = Array.isArray(u.identities) ? u.identities : [];
  return {
    id: u.id,
    email: u.email,
    email_confirmed_at: u.email_confirmed_at || null,
    phone_confirmed_at: u.phone_confirmed_at || null,
    last_sign_in_at: u.last_sign_in_at || null,
    created_at: u.created_at || null,
    banned_until: u.banned_until || null,
    providers: identities.map((i) => i.provider).filter(Boolean),
    has_email_identity: identities.some((i) => i.provider === "email"),
  };
}

function trySqlProbe(email) {
  const composeDir =
    process.env.COMPOSE_DIR || "/opt/arbishield/deploy/vps-supabase";
  if (!fs.existsSync(path.join(composeDir, "docker-compose.yml"))) {
    return { skipped: true, reason: "compose não encontrado" };
  }
  const sql = `
SELECT
  id::text,
  email,
  email_confirmed_at IS NOT NULL AS confirmed,
  (encrypted_password IS NOT NULL AND length(encrypted_password) > 0) AS has_password,
  last_sign_in_at,
  banned_until,
  created_at
FROM auth.users
WHERE lower(email) = lower('${email.replace(/'/g, "''")}');
`.trim();
  const r = spawnSync(
    "docker",
    ["compose", "exec", "-T", "db", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-F", "|", "-c", sql],
    { cwd: composeDir, encoding: "utf8", timeout: 30000 }
  );
  if (r.status !== 0) {
    return {
      skipped: true,
      reason: (r.stderr || r.stdout || "psql falhou").slice(0, 300),
    };
  }
  const line = String(r.stdout || "")
    .trim()
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)[0];
  if (!line) return { found: false };
  const [id, em, confirmed, has_password, last_sign_in_at, banned_until, created_at] =
    line.split("|");
  return {
    found: true,
    id,
    email: em,
    confirmed: confirmed === "t",
    has_password: has_password === "t",
    last_sign_in_at: last_sign_in_at || null,
    banned_until: banned_until || null,
    created_at: created_at || null,
  };
}

async function probePublicAuth() {
  const anon =
    process.env.ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg0NDc5OTk4LCJleHAiOjE5NDIxNTk5OTh9.mxLqs20sCUNn58jWlsD0sznclCOr8rbksjTEAuQee3s";

  async function hit(host, pathname, body) {
    const res = await fetch(`${host}${pathname}`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 200) };
    }
    return { status: res.status, data };
  }

  const hosts = [PUBLIC_URL, "https://legado.arbishield.app"];
  const out = {};
  for (const host of hosts) {
    out[host] = {
      signup_probe: await hit(host, "/auth/v1/signup", {
        email: EMAIL,
        password: "TempProbePass-DoNotUse-9x!",
      }),
      recover_probe: await hit(host, "/auth/v1/recover", { email: EMAIL }),
      wrong_password: await hit(host, "/auth/v1/token?grant_type=password", {
        email: EMAIL,
        password: "definitely-wrong-password-xyz",
      }),
    };
  }

  const settingsRes = await fetch(`${PUBLIC_URL}/auth/v1/settings`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  });
  const settings = await settingsRes.json().catch(() => ({}));
  return {
    mailer_autoconfirm: settings.mailer_autoconfirm,
    disable_signup: settings.disable_signup,
    hosts: out,
  };
}

function printVerdict({ user, sql, publicProbe, unconfirmedCount, total }) {
  console.log("\n========== VEREDITO ==========");
  console.log(
    "Legado e novo usam o MESMO Auth (same-origin / mesma anon key)."
  );
  console.log(
    "Se a senha funciona em um, funciona no outro — e vice-versa."
  );
  if (!user) {
    console.log(
      `Conta ${EMAIL}: NÃO encontrada em auth.users da VPS → precisa migrar ou recriar.`
    );
  } else {
    const confirmed = Boolean(user.email_confirmed_at);
    console.log(`Conta ${EMAIL}: EXISTE (id ${user.id})`);
    console.log(`  e-mail confirmado: ${confirmed ? "sim" : "NÃO"}`);
    if (sql?.found) {
      console.log(
        `  hash de senha (SQL): ${sql.has_password ? "presente" : "AUSENTE"}`
      );
    }
    if (!confirmed) {
      console.log(
        "  → Com mailer_autoconfirm=false, login retorna 'Invalid login credentials' mesmo com senha correta."
      );
    }
    if (sql?.found && !sql.has_password) {
      console.log(
        "  → Sem encrypted_password: migração incompleta; usuário precisa redefinir senha (SMTP) ou admin setar senha."
      );
    }
  }
  const recover =
    publicProbe?.hosts?.[PUBLIC_URL]?.recover_probe ||
    publicProbe?.hosts?.["https://arbishield.app"]?.recover_probe;
  if (recover && recover.status >= 500) {
    console.log(
      "SMTP/recovery: QUEBRADO (recover HTTP 500) — usuário não consegue resetar senha sozinho."
    );
  }
  console.log(
    `Usuários listados: ${total}; sem confirmação de e-mail: ${unconfirmedCount}`
  );
  console.log("==============================\n");
}

const users = await listUsers();
const unconfirmed = users.filter((u) => !u.email_confirmed_at);
const user = await findUserByEmail(EMAIL);
const sql = trySqlProbe(EMAIL);
let publicProbe = null;
try {
  publicProbe = await probePublicAuth();
} catch (e) {
  publicProbe = { error: String(e?.message || e) };
}

console.log(
  JSON.stringify(
    {
      supabase_url: SUPABASE_URL,
      public_url: PUBLIC_URL,
      target_email: EMAIL,
      user: user ? summarizeUser(user) : null,
      sql_probe: sql,
      totals: {
        listed: users.length,
        unconfirmed: unconfirmed.length,
        confirmed: users.length - unconfirmed.length,
      },
      sample_unconfirmed: unconfirmed.slice(0, 15).map((u) => u.email),
      public_probe: publicProbe,
    },
    null,
    2
  )
);

printVerdict({
  user,
  sql,
  publicProbe,
  unconfirmedCount: unconfirmed.length,
  total: users.length,
});

if (CONFIRM && user && !user.email_confirmed_at) {
  console.log(`Confirmando e-mail de ${EMAIL}...`);
  const updated = await confirmUser(user);
  console.log(
    "OK confirmado:",
    summarizeUser(updated?.user || updated || user)
  );
}

if (CONFIRM_ALL) {
  console.log(`Confirmando ${unconfirmed.length} usuários sem e-mail confirmado...`);
  let ok = 0;
  let fail = 0;
  for (const u of unconfirmed) {
    try {
      await confirmUser(u);
      ok += 1;
      process.stdout.write(".");
    } catch (e) {
      fail += 1;
      console.error(`\nFalha ${u.email}:`, e.message || e);
    }
  }
  console.log(`\nCONFIRM_ALL: ok=${ok} fail=${fail}`);
}
