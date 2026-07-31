#!/usr/bin/env node
/**
 * Auditoria de acessos/privilégios suspeitos (pós-incidente jawadog / Admin Probe).
 *
 *   node scripts/vps-auditoria-acessos-maliciosos.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ALLOWED_ADMIN_EMAILS = new Set(
  String(process.env.ALLOWED_ADMINS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);
if (!ALLOWED_ADMIN_EMAILS.size) {
  [
    "isaacgomes3@gmail.com",
    "financeiro@arbishield.com",
    "carlos@arbishield.com",
    "icaro@arbishield.com",
  ].forEach((e) => ALLOWED_ADMIN_EMAILS.add(e));
}

const KNOWN_BAD = new Set([
  "jawadog871@kierko.com",
  "admin.probe.1784500869@arbishield.local",
  "3b7e5b99-83f3-45f7-a390-855ffb2b8109",
  "a0f8a309-5bc6-4121-8e64-2b282b181485",
]);

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

function suspiciousEmail(email) {
  const e = String(email || "").toLowerCase();
  if (!e) return "sem-email";
  if (KNOWN_BAD.has(e)) return "incidente-conhecido";
  if (e.includes("kierko.com")) return "dominio-kierko";
  if (e.endsWith("@arbishield.local")) return "probe-local";
  if (/^(admin|test|probe|hack|root|tmp)/i.test(e.split("@")[0])) return "prefixo-suspeito";
  if (/mailinator|guerrillamail|tempmail|10minutemail|yopmail|trashmail/i.test(e))
    return "email-descartavel";
  return null;
}

async function loadAllAuthUsers() {
  const all = [];
  for (let page = 1; page <= 80; page++) {
    const r = await sb(`/auth/v1/admin/users?page=${page}&per_page=200`, {
      okNull: true,
    });
    const users = Array.isArray(r?.users) ? r.users : [];
    if (!users.length) break;
    all.push(...users);
    if (users.length < 200) break;
  }
  return all;
}

function authMap(users) {
  const byId = new Map();
  const byEmail = new Map();
  for (const u of users) {
    byId.set(u.id, u);
    if (u.email) byEmail.set(String(u.email).toLowerCase(), u);
  }
  return { byId, byEmail };
}

console.log("════════════════════════════════════════════════════════════════════════");
console.log("AUDITORIA · acessos / privilégios suspeitos");
console.log(`allowlist: ${[...ALLOWED_ADMIN_EMAILS].join(", ")}`);
console.log("════════════════════════════════════════════════════════════════════════");

const authUsers = await loadAllAuthUsers();
const { byId } = authMap(authUsers);
console.log(`\nAuth users carregados: ${authUsers.length}`);

const findings = [];

// 1) is_super_admin
console.log("\n══ 1) profiles.is_super_admin = true ══");
const supers = await sb(
  `/rest/v1/profiles?select=id,full_name,is_super_admin,account_status,created_at,updated_at&is_super_admin=eq.true&order=created_at.desc&limit=200`
);
const superList = Array.isArray(supers) ? supers : [];
if (!superList.length) console.log("  (nenhum)");
for (const p of superList) {
  const u = byId.get(p.id);
  const email = String(u?.email || "").toLowerCase();
  const ok = ALLOWED_ADMIN_EMAILS.has(email);
  const line = `  ${ok ? "OK " : "!! "} ${email || "—"} | ${p.full_name || "—"} | status=${p.account_status} | ban=${u?.banned_until || "—"} | criou=${fmt(p.created_at)}`;
  console.log(line);
  if (!ok) findings.push({ kind: "super_admin_fora_allowlist", email, id: p.id, p });
}

// 2) user_roles admin
console.log("\n══ 2) user_roles admin/master_admin ══");
const roles = await sb(
  `/rest/v1/user_roles?or=(role.eq.admin,role.eq.master_admin)&select=user_id,role,created_at&order=created_at.desc&limit=200`
);
const roleList = Array.isArray(roles) ? roles : [];
if (!roleList.length) console.log("  (nenhum)");
for (const r of roleList) {
  const u = byId.get(r.user_id);
  const email = String(u?.email || "").toLowerCase();
  const ok = ALLOWED_ADMIN_EMAILS.has(email);
  console.log(
    `  ${ok ? "OK " : "!! "} ${r.role.padEnd(12)} ${email || "—"} | ban=${u?.banned_until || "—"} | role_desde=${fmt(r.created_at)}`
  );
  if (!ok) findings.push({ kind: "role_admin_fora_allowlist", email, id: r.user_id, r });
}

// 3) Auth banidos
console.log("\n══ 3) Contas banidas (Auth) ══");
const banned = authUsers.filter((u) => u.banned_until);
if (!banned.length) console.log("  (nenhuma)");
for (const u of banned.slice(0, 40)) {
  console.log(
    `  ${u.email || "—"} | until=${u.banned_until} | last_sign_in=${fmt(u.last_sign_in_at)} | id=${u.id}`
  );
}

// 4) E-mails / nomes suspeitos (últimos 14 dias + padrões)
console.log("\n══ 4) Contas suspeitas por e-mail/padrão ══");
const cutoff = Date.now() - 14 * 864e5;
const susUsers = [];
for (const u of authUsers) {
  const email = String(u.email || "").toLowerCase();
  const reason = suspiciousEmail(email);
  const recent = u.created_at && new Date(u.created_at).getTime() >= cutoff;
  const metaName = String(u.user_metadata?.full_name || u.user_metadata?.name || "");
  const nameSus = /admin\s*probe|probe|test\s*admin|super\s*admin/i.test(metaName);
  if (!reason && !nameSus) continue;
  if (
    !recent &&
    reason !== "incidente-conhecido" &&
    !nameSus &&
    reason !== "dominio-kierko" &&
    reason !== "probe-local"
  )
    continue;
  susUsers.push({ u, email, reason: reason || "nome", metaName });
}
const profById = new Map();
if (susUsers.length) {
  const ids = susUsers.map((x) => x.u.id);
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const q = chunk.map(encodeURIComponent).join(",");
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,is_super_admin,account_status&id=in.(${q})`,
      { okNull: true }
    );
    for (const p of Array.isArray(rows) ? rows : []) profById.set(p.id, p);
  }
}
for (const { u, email, reason, metaName } of susUsers) {
  const prof = profById.get(u.id);
  console.log(
    `  !! ${email || "—"} | ${reason} | name=${prof?.full_name || metaName || "—"} | super=${prof?.is_super_admin} | status=${prof?.account_status} | criou=${fmt(u.created_at)} | last=${fmt(u.last_sign_in_at)} | ban=${u.banned_until || "—"}`
  );
  findings.push({ kind: "conta_suspeita", email, reason, id: u.id });
}
if (!susUsers.length) console.log("  (nenhuma além dos filtros)");

// 5) Desafios deleted/cancelled com admin fora da allowlist
console.log("\n══ 5) Desafios deleted/cancelled · admin fora allowlist (metadata) ══");
const desafios = await sb(
  `/rest/v1/desafios?select=id,title,status,deleted_at,updated_at,metadata&or=(status.eq.deleted,status.eq.cancelled)&order=updated_at.desc&limit=300`,
  { okNull: true }
);
const dlist = Array.isArray(desafios) ? desafios : [];
let badMeta = 0;
for (const d of dlist) {
  const m = d.metadata && typeof d.metadata === "object" ? d.metadata : {};
  const adminId =
    m.deleted_by || m.deleted_admin_id || m.cancelled_by || m.cancelled_admin_id || "";
  const adminEmail = String(
    m.deleted_by_email || m.cancelled_by_email || ""
  ).toLowerCase();
  let email = adminEmail;
  if (!email && adminId && byId.get(adminId)) {
    email = String(byId.get(adminId).email || "").toLowerCase();
  }
  if (!adminId && !email) continue;
  const ok = email && ALLOWED_ADMIN_EMAILS.has(email);
  if (ok) continue;
  badMeta++;
  console.log(
    `  !! #? ${d.title || d.id} status=${d.status} admin=${email || adminId || "—"} via=${m.deleted_via || m.cancelled_via || "—"} ip=${m.deleted_ip || m.cancelled_ip || "—"} updated=${fmt(d.updated_at)}`
  );
  findings.push({
    kind: "desafio_admin_suspeito",
    email: email || adminId,
    desafio: d.id,
  });
}
if (!badMeta) console.log("  (nenhum metadata apontando admin fora da allowlist)");

// 6) Contas criadas 29–31/07 com last_sign_in e privilégio
console.log("\n══ 6) Contas novas 29–31/07/2026 (janela do incidente) ══");
const winStart = new Date("2026-07-29T00:00:00-03:00").getTime();
const winEnd = new Date("2026-08-01T00:00:00-03:00").getTime();
const windowUsers = authUsers
  .filter((u) => {
    const t = u.created_at ? new Date(u.created_at).getTime() : 0;
    return t >= winStart && t < winEnd;
  })
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
console.log(`  total criadas na janela: ${windowUsers.length}`);
for (const u of windowUsers.slice(0, 80)) {
  const email = String(u.email || "").toLowerCase();
  const pRows = await sb(
    `/rest/v1/profiles?select=full_name,is_super_admin,account_status&id=eq.${u.id}&limit=1`,
    { okNull: true }
  );
  const p = Array.isArray(pRows) ? pRows[0] : null;
  const flag =
    p?.is_super_admin ||
    suspiciousEmail(email) ||
    ALLOWED_ADMIN_EMAILS.has(email)
      ? p?.is_super_admin
        ? "SUPER"
        : suspiciousEmail(email) || (ALLOWED_ADMIN_EMAILS.has(email) ? "allowlist" : "")
      : "";
  if (!flag && !p?.is_super_admin) {
    // lista compacta só se tiver sign-in
    if (!u.last_sign_in_at) continue;
  }
  console.log(
    `  ${fmt(u.created_at)} | ${email || "—"} | ${p?.full_name || "—"} | super=${!!p?.is_super_admin} | ${p?.account_status || "—"} | last=${fmt(u.last_sign_in_at)} | ban=${u.banned_until ? "SIM" : "não"} ${flag ? "[" + flag + "]" : ""}`
  );
}

// 7) Resumo
console.log("\n══ RESUMO ══");
console.log(`  findings: ${findings.length}`);
const byKind = {};
for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
for (const [k, n] of Object.entries(byKind)) console.log(`    ${k}: ${n}`);
if (!findings.length) {
  console.log("  Nenhum privilégio/conta fora do esperado além do já tratado.");
} else {
  console.log("  Revise itens !! acima. Para banir/revogar, use scripts vps-revogar-* / BAN=1.");
}
console.log("\nOK");
