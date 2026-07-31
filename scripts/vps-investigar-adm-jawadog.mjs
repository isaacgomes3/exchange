#!/usr/bin/env node
/**
 * Investiga conta suspeita apontada no metadata de exclusão de desafios:
 *   admin_id 3b7e5b99-83f3-45f7-a390-855ffb2b8109
 *   e-mail   jawadog871@kierko.com
 *
 * Também lista TODOS os admins (user_roles) e cruza com Auth.
 *
 *   node scripts/vps-investigar-adm-jawadog.mjs
 *   REVOKE=1 node ...   # remove roles admin/master_admin dessa conta (não apaga Auth)
 *   BAN=1 node ...      # ban Auth (ban_duration 876000h) + remove roles
 */
import fs from "node:fs";
import path from "node:path";

const TARGET_ID = String(
  process.env.USER_ID || "3b7e5b99-83f3-45f7-a390-855ffb2b8109"
).trim();
const TARGET_EMAIL = String(
  process.env.EMAIL || "jawadog871@kierko.com"
)
  .trim()
  .toLowerCase();
const REVOKE = process.env.REVOKE === "1" || process.env.REVOKE === "true";
const BAN = process.env.BAN === "1" || process.env.BAN === "true";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
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
    if (!(key in process.env) || process.env[key] === "") process.env[key] = val;
  }
}

for (const f of [
  process.env.ENV_FILE,
  "/opt/arbishield/deploy/vps-supabase/.env",
  "/opt/arbishield/.env",
  path.resolve("deploy/vps-supabase/.env"),
  path.resolve(".env"),
].filter(Boolean)) {
  loadEnvFile(f);
}

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

if (!SERVICE_KEY) {
  console.error("ERRO: SERVICE_ROLE_KEY ausente");
  process.exit(1);
}

async function sb(p, { method = "GET", body, okNull = false } = {}) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    if (okNull) return { ok: false, status: res.status, data };
    throw new Error(`${res.status} ${p}: ${String(text).slice(0, 320)}`);
  }
  return data;
}

function fmt(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch {
    return String(iso);
  }
}

async function findAuthByEmail(email) {
  for (let page = 1; page <= 40; page++) {
    const r = await sb(`/auth/v1/admin/users?page=${page}&per_page=200`, {
      okNull: true,
    });
    const users = Array.isArray(r?.users) ? r.users : [];
    if (!users.length) break;
    const hit = users.find(
      (u) => String(u.email || "").toLowerCase() === email
    );
    if (hit) return hit;
    if (users.length < 200) break;
  }
  return null;
}

async function main() {
  console.log("═".repeat(72));
  console.log("INVESTIGAÇÃO · conta apontada como admin no delete de desafios");
  console.log(`id:    ${TARGET_ID}`);
  console.log(`email: ${TARGET_EMAIL}`);
  console.log("═".repeat(72));

  // 1) Auth por ID
  console.log("\n══ 1) Auth por ID ══");
  const byId = await sb(`/auth/v1/admin/users/${encodeURIComponent(TARGET_ID)}`, {
    okNull: true,
  });
  if (!byId || byId.ok === false) {
    console.log("  Auth: usuário NÃO encontrado por esse ID");
  } else {
    const u = byId.user || byId;
    console.log(`  email: ${u.email || "—"}`);
    console.log(`  created: ${fmt(u.created_at)}`);
    console.log(`  last_sign_in: ${fmt(u.last_sign_in_at)}`);
    console.log(`  confirmed: ${u.email_confirmed_at ? fmt(u.email_confirmed_at) : "NÃO"}`);
    console.log(`  banned_until: ${u.banned_until || "—"}`);
    console.log(`  providers: ${(u.app_metadata && u.app_metadata.providers) || u.app_metadata || "—"}`);
    console.log(`  user_metadata: ${JSON.stringify(u.user_metadata || {}).slice(0, 300)}`);
    console.log(`  identities: ${JSON.stringify((u.identities || []).map((i) => i.provider)).slice(0, 200)}`);
  }

  // 2) Auth por e-mail
  console.log("\n══ 2) Auth por e-mail ══");
  const byEmail = await findAuthByEmail(TARGET_EMAIL);
  if (!byEmail) {
    console.log("  Auth: e-mail NÃO encontrado");
  } else {
    console.log(`  id: ${byEmail.id}`);
    console.log(`  email: ${byEmail.email}`);
    console.log(`  created: ${fmt(byEmail.created_at)}`);
    console.log(`  last_sign_in: ${fmt(byEmail.last_sign_in_at)}`);
    console.log(
      `  id bate com target? ${String(byEmail.id).toLowerCase() === TARGET_ID.toLowerCase() ? "SIM" : "NÃO — DIVERGENTE"}`
    );
  }

  // 3) Profile
  console.log("\n══ 3) profiles ══");
  const prof = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(TARGET_ID)}&select=*&limit=1`,
    { okNull: true }
  );
  const p = Array.isArray(prof) ? prof[0] : null;
  if (!p) console.log("  profile ausente");
  else {
    console.log(`  full_name: ${p.full_name || "—"}`);
    console.log(`  account_status: ${p.account_status || "—"}`);
    console.log(`  created: ${fmt(p.created_at)}`);
    console.log(`  updated: ${fmt(p.updated_at)}`);
    const moneyKeys = [
      "balance_cents",
      "desafio_balance_cents",
      "reusable_balance_cents",
      "investor_balance_cents",
    ];
    for (const k of moneyKeys) {
      if (p[k] != null) console.log(`  ${k}: ${p[k]}`);
    }
  }

  // 4) Roles
  console.log("\n══ 4) user_roles (desta conta) ══");
  const roles = await sb(
    `/rest/v1/user_roles?user_id=eq.${encodeURIComponent(TARGET_ID)}&select=*`,
    { okNull: true }
  );
  const roleList = Array.isArray(roles) ? roles : [];
  if (!roleList.length) console.log("  nenhuma role");
  for (const r of roleList) {
    console.log(
      `  role=${r.role}  id=${r.id}  created=${fmt(r.created_at)}  ${JSON.stringify(r).slice(0, 200)}`
    );
  }
  const isAdminRole = roleList.some(
    (r) => r.role === "admin" || r.role === "master_admin"
  );
  console.log(`  É admin no banco? ${isAdminRole ? "SIM ⚠" : "NÃO"}`);

  // 5) Todos os admins
  console.log("\n══ 5) TODOS os admins/master_admin ══");
  const allAdmins = await sb(
    `/rest/v1/user_roles?or=(role.eq.admin,role.eq.master_admin)&select=user_id,role,created_at&order=created_at.desc&limit=200`,
    { okNull: true }
  );
  const admins = Array.isArray(allAdmins) ? allAdmins : [];
  console.log(`  total roles admin: ${admins.length}`);
  for (const a of admins) {
    const u = await sb(`/auth/v1/admin/users/${encodeURIComponent(a.user_id)}`, {
      okNull: true,
    });
    const email = u?.email || u?.user?.email || "?";
    const pr = await sb(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(a.user_id)}&select=full_name&limit=1`,
      { okNull: true }
    );
    const name = Array.isArray(pr) ? pr[0]?.full_name : null;
    const mark =
      String(a.user_id).toLowerCase() === TARGET_ID.toLowerCase() ||
      String(email).toLowerCase() === TARGET_EMAIL
        ? " ◀◀ SUSPEITO"
        : "";
    console.log(
      `  ${a.role.padEnd(12)} ${email.padEnd(36)} ${(name || "—").toString().slice(0, 24).padEnd(24)} ${String(a.user_id).slice(0, 8)}…  desde ${fmt(a.created_at)}${mark}`
    );
  }

  // 6) Desafios com esse deleted_by / cancelled_by
  console.log("\n══ 6) Desafios com metadata apontando esse admin ══");
  const dz = await sb(
    `/rest/v1/desafios?select=id,number,title,status,deleted_at,updated_at,metadata&order=updated_at.desc&limit=100`,
    { okNull: true }
  );
  const dzList = (Array.isArray(dz) ? dz : []).filter((d) => {
    const m = d.metadata || {};
    const blob = JSON.stringify(m);
    return (
      blob.includes(TARGET_ID) ||
      blob.toLowerCase().includes(TARGET_EMAIL) ||
      m.deleted_by === TARGET_ID ||
      m.cancelled_by === TARGET_ID ||
      m.deleted_admin_id === TARGET_ID ||
      m.cancelled_admin_id === TARGET_ID
    );
  });
  console.log(`  desafios ligados: ${dzList.length}`);
  for (const d of dzList) {
    const m = d.metadata || {};
    console.log(
      `  #${d.number} ${d.title || "—"} status=${d.status} updated=${fmt(d.updated_at)}`
    );
    console.log(
      `    deleted_by=${m.deleted_by || m.deleted_admin_id || "—"} ip=${m.deleted_ip || "—"} via=${m.deleted_via || "—"}`
    );
    console.log(
      `    cancelled_by=${m.cancelled_by || m.cancelled_admin_id || "—"} ip=${m.cancelled_ip || "—"} via=${m.cancelled_via || "—"}`
    );
  }

  // 7) Revogar / banir
  if (REVOKE || BAN) {
    console.log("\n══ 7) AÇÃO ══");
    if (isAdminRole || REVOKE) {
      for (const r of roleList.filter(
        (x) => x.role === "admin" || x.role === "master_admin"
      )) {
        console.log(`  removendo role ${r.role} id=${r.id}`);
        await sb(`/rest/v1/user_roles?id=eq.${encodeURIComponent(r.id)}`, {
          method: "DELETE",
        });
      }
      console.log("  roles admin removidas");
    }
    if (BAN) {
      const uid = byId?.id || byId?.user?.id || TARGET_ID;
      console.log(`  banindo Auth ${uid}`);
      await sb(`/auth/v1/admin/users/${encodeURIComponent(uid)}`, {
        method: "PUT",
        body: { ban_duration: "876000h" },
      });
      console.log("  ban OK");
    }
  } else {
    console.log("\n══ Próximos passos (se confirmar invasão) ══");
    console.log("  Remover role admin:");
    console.log(
      "    REVOKE=1 node /opt/arbishield/scripts/vps-investigar-adm-jawadog.mjs"
    );
    console.log("  Remover role + banir login:");
    console.log(
      "    BAN=1 REVOKE=1 node /opt/arbishield/scripts/vps-investigar-adm-jawadog.mjs"
    );
  }

  console.log("\nOK");
}

main().catch((e) => {
  console.error("ERRO:", e instanceof Error ? e.message : e);
  process.exit(1);
});
