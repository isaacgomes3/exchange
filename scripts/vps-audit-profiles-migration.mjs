#!/usr/bin/env node
/**
 * Auditoria: dados de clientes (profiles) após migração Cloud → VPS / site novo.
 *
 * Na VPS:
 *   node /opt/arbishield/scripts/vps-audit-profiles-migration.mjs
 *   # ou via wrapper:
 *   bash scripts/vps-audit-profiles-migration.sh
 *
 * Opcional — reescrever avatar_url do Cloud antigo para o domínio atual:
 *   FIX_AVATAR_URLS=1 PUBLIC_ORIGIN=https://arbishield.app node scripts/vps-audit-profiles-migration.mjs
 */
import fs from "node:fs";
import path from "node:path";

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
const PUBLIC_ORIGIN = (
  process.env.PUBLIC_ORIGIN ||
  process.env.SITE_URL ||
  "https://arbishield.app"
).replace(/\/$/, "");
const FIX_AVATAR_URLS =
  process.env.FIX_AVATAR_URLS === "1" || process.env.FIX_AVATAR_URLS === "true";
const PAGE = Math.min(1000, Math.max(50, Number(process.env.PAGE_SIZE || 500)));

if (!SERVICE_KEY) {
  console.error("ERRO: SERVICE_ROLE_KEY ausente");
  process.exit(1);
}

async function sb(pathname, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    method: opts.method || "GET",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: opts.prefer || "return=representation",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      (data && data.message) ||
      (typeof data === "string" ? data : JSON.stringify(data));
    throw new Error(`${res.status} ${pathname}: ${msg}`);
  }
  return data;
}

function filled(v) {
  return v != null && String(v).trim() !== "";
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "(inválida)";
  }
}

function rewriteAvatarUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const old =
      /\.supabase\.co$/i.test(u.host) ||
      u.host === "127.0.0.1:8000" ||
      u.host === "localhost:8000";
    if (!old) return null;
    const m = u.pathname.match(
      /\/storage\/v1\/object\/(?:public|sign|authenticated)\/(.+)$/
    );
    if (!m) return null;
    return `${PUBLIC_ORIGIN}/storage/v1/object/public/${m[1]}${u.search || ""}`;
  } catch {
    return null;
  }
}

async function fetchAllProfiles() {
  const select = [
    "id",
    "full_name",
    "phone",
    "location",
    "cpf",
    "pix_key",
    "pix_priority_type",
    "pix_bank",
    "pix_account",
    "pix_account_holder",
    "avatar_url",
    "account_status",
    "balance_cents",
    "created_at",
    "updated_at",
    "referral_code",
    "referred_by",
    "is_affiliate",
  ].join(",");
  const rows = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE - 1;
    const batch = await sb(
      `/rest/v1/profiles?select=${select}&order=created_at.asc&offset=${from}&limit=${PAGE}`,
      { prefer: `count=exact` }
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
    if (rows.length > 200000) break;
  }
  return rows;
}

async function countAuthUsers() {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });
    const total = res.headers.get("x-total-count") || res.headers.get("X-Total-Count");
    if (total != null && total !== "") return Number(total);
    const body = await res.json().catch(() => null);
    if (body && typeof body.total === "number") return body.total;
    if (Array.isArray(body?.users)) return body.users.length;
  } catch {
    /* ignore */
  }
  return null;
}

function pct(n, d) {
  if (!d) return "0%";
  return `${((100 * n) / d).toFixed(1)}%`;
}

async function main() {
  console.log("==> Auditoria migração de perfil (profiles)");
  console.log(`    Supabase: ${SUPABASE_URL}`);
  console.log(`    Public:   ${PUBLIC_ORIGIN}`);

  const [profiles, authTotal] = await Promise.all([
    fetchAllProfiles(),
    countAuthUsers(),
  ]);

  const total = profiles.length;
  const fields = [
    "full_name",
    "phone",
    "location",
    "cpf",
    "pix_key",
    "pix_priority_type",
    "pix_bank",
    "pix_account",
    "pix_account_holder",
    "avatar_url",
    "referral_code",
    "referred_by",
  ];

  const counts = Object.fromEntries(fields.map((f) => [f, 0]));
  const avatarHosts = new Map();
  let withAnyIdentity = 0;
  let withPixReady = 0;
  let emptyShell = 0;

  for (const p of profiles) {
    for (const f of fields) {
      if (filled(p[f])) counts[f] += 1;
    }
    if (filled(p.full_name) || filled(p.cpf) || filled(p.phone) || filled(p.pix_key)) {
      withAnyIdentity += 1;
    } else {
      emptyShell += 1;
    }
    if (filled(p.pix_key) || (filled(p.cpf) && filled(p.phone))) withPixReady += 1;
    if (filled(p.avatar_url)) {
      const h = hostOf(p.avatar_url);
      avatarHosts.set(h, (avatarHosts.get(h) || 0) + 1);
    }
  }

  console.log("");
  console.log("--- Totais ---");
  console.log(`profiles:     ${total}`);
  console.log(
    `auth.users:   ${authTotal == null ? "(não disponível via API)" : authTotal}`
  );
  if (authTotal != null) {
    const delta = authTotal - total;
    console.log(
      `diferença:    ${delta} ${delta === 0 ? "(ok — 1 perfil por usuário)" : "(atenção)"}`
    );
  }
  console.log(`com identidade (nome/cpf/phone/pix): ${withAnyIdentity} (${pct(withAnyIdentity, total)})`);
  console.log(`shell vazio (sem esses campos):      ${emptyShell} (${pct(emptyShell, total)})`);

  console.log("");
  console.log("--- Preenchimento (mesmo schema do site antigo) ---");
  for (const f of fields) {
    console.log(
      `${f.padEnd(22)} ${String(counts[f]).padStart(6)} / ${total}  (${pct(counts[f], total)})`
    );
  }

  console.log("");
  console.log("--- Hosts de avatar_url ---");
  if (!avatarHosts.size) {
    console.log("(nenhum avatar)");
  } else {
    for (const [h, n] of [...avatarHosts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n}\t${h}`);
    }
  }

  const needRewrite = profiles.filter((p) => rewriteAvatarUrl(p.avatar_url));
  console.log("");
  console.log(`avatars com URL Cloud/localhost: ${needRewrite.length}`);

  if (FIX_AVATAR_URLS && needRewrite.length) {
    console.log(`==> Reescrevendo ${needRewrite.length} avatar_url → ${PUBLIC_ORIGIN}`);
    let ok = 0;
    let fail = 0;
    for (const p of needRewrite) {
      const next = rewriteAvatarUrl(p.avatar_url);
      if (!next) continue;
      try {
        await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
          method: "PATCH",
          body: { avatar_url: next, updated_at: new Date().toISOString() },
        });
        ok += 1;
      } catch (err) {
        fail += 1;
        if (fail <= 5) console.error("  falha", p.id, err.message || err);
      }
    }
    console.log(`  ok=${ok} fail=${fail}`);
  } else if (needRewrite.length) {
    console.log(
      "  (rode com FIX_AVATAR_URLS=1 para apontar fotos antigas para o domínio atual)"
    );
  }

  console.log("");
  console.log("--- Conclusão ---");
  console.log(
    "O perfil novo lê a mesma tabela public.profiles do site antigo (dump Cloud→VPS)."
  );
  console.log(
    "Campos do cliente no Meu Perfil v2: nome, telefone, localização, CPF, PIX, banco, avatar, senha."
  );
  if (total === 0) {
    console.log("ALERTA: zero profiles — dump/import pode não ter rodado.");
    process.exit(2);
  }
  if (authTotal != null && authTotal - total > Math.max(5, Math.floor(authTotal * 0.05))) {
    console.log("ALERTA: muitos auth.users sem linha em profiles.");
    process.exit(3);
  }
  console.log("OK — schema e dados de perfil presentes para auditoria.");
}

main().catch((err) => {
  console.error("ERRO:", err.message || err);
  process.exit(1);
});
