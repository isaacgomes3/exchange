#!/usr/bin/env node
/**
 * Quem cancelou/excluiu desafios HOJE (BRT) — admin + IP.
 *
 * Fontes:
 *  1) desafios.metadata (cancelled_ip / deleted_ip / cancelled_by_email …)
 *  2) admin_audit_logs
 *  3) /var/log/arbishield/desafio-admin-actions.log
 *  4) nginx access log (desafio-cancel / desafio-delete)
 *
 *   DATE=2026-07-31 node scripts/vps-auditoria-cancel-adm-hoje.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const DATE = String(process.env.DATE || "").trim(); // YYYY-MM-DD BRT

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

function todayBrYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function brDayBounds(ymd) {
  const fromIso = new Date(`${ymd}T00:00:00-03:00`).toISOString();
  const [y, m, d] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const toYmd = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  const toIso = new Date(`${toYmd}T00:00:00-03:00`).toISOString();
  return { fromIso, toIso, ymd };
}

function fmtBr(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch {
    return String(iso);
  }
}

async function sb(p, { okNull = false } = {}) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    if (okNull) return null;
    throw new Error(`${res.status} ${p}: ${String(text).slice(0, 280)}`);
  }
  return data;
}

async function resolveEmail(userId) {
  if (!userId) return null;
  try {
    const u = await sb(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      okNull: true,
    });
    return u?.email || u?.user?.email || null;
  } catch {
    return null;
  }
}

async function main() {
  const ymd = DATE || todayBrYmd();
  const { fromIso, toIso } = brDayBounds(ymd);

  console.log("═".repeat(72));
  console.log("AUDITORIA · cancel/excluir desafio — admin + IP");
  console.log(`Dia BRT: ${ymd}`);
  console.log(`UTC: ${fromIso} → ${toIso}`);
  console.log("═".repeat(72));

  // ── 1) metadata nos desafios ──
  console.log("\n══ 1) desafios.metadata (cancelled_*/deleted_*) ══");
  let desafios = [];
  try {
    desafios = await sb(
      `/rest/v1/desafios?or=(status.eq.cancelled,status.eq.deleted,deleted_at.not.is.null)&updated_at=gte.${encodeURIComponent(fromIso)}&updated_at=lt.${encodeURIComponent(toIso)}&select=id,number,title,status,is_active,deleted_at,updated_at,metadata&order=updated_at.desc&limit=200`
    );
  } catch (e) {
    console.log("  falha query:", e.message);
    desafios = [];
  }
  if (!Array.isArray(desafios) || !desafios.length) {
    // fallback: todos atualizados hoje
    desafios = await sb(
      `/rest/v1/desafios?updated_at=gte.${encodeURIComponent(fromIso)}&updated_at=lt.${encodeURIComponent(toIso)}&select=id,number,title,status,is_active,deleted_at,updated_at,metadata&order=updated_at.desc&limit=200`
    ).catch(() => []);
  }
  const list = Array.isArray(desafios) ? desafios : [];
  let metaHits = 0;
  for (const d of list) {
    const m = d.metadata && typeof d.metadata === "object" ? d.metadata : {};
    const hasCancel =
      m.cancelled_ip ||
      m.cancelled_by_email ||
      m.cancelled_by ||
      m.cancelled_admin_id ||
      m.cancelled_via ||
      m.deleted_ip ||
      m.deleted_by_email ||
      m.deleted_by ||
      m.deleted_admin_id ||
      m.deleted_via ||
      m.removed_again_at;
    if (!hasCancel && d.status !== "cancelled" && !d.deleted_at) continue;
    metaHits += 1;
    console.log(
      `\n  #${d.number ?? "?"} ${d.title || "—"}  status=${d.status} deleted=${!!d.deleted_at}`
    );
    console.log(`  id: ${d.id}`);
    console.log(`  updated_at: ${fmtBr(d.updated_at)}`);
    const fields = [
      ["cancelled_by_email", m.cancelled_by_email],
      ["cancelled_by_name", m.cancelled_by_name || m.cancelled_admin_name],
      ["cancelled_by / admin_id", m.cancelled_by || m.cancelled_admin_id],
      ["cancelled_ip", m.cancelled_ip],
      ["cancelled_user_agent", m.cancelled_user_agent],
      ["cancelled_at / from", m.cancelled_at || m.cancelled_from],
      ["cancelled_via", m.cancelled_via],
      ["deleted_by_email", m.deleted_by_email],
      ["deleted_by_name", m.deleted_by_name || m.deleted_admin_name],
      ["deleted_by / admin_id", m.deleted_by || m.deleted_admin_id],
      ["deleted_ip", m.deleted_ip],
      ["deleted_user_agent", m.deleted_user_agent],
      ["deleted_at meta", m.deleted_from || m.deleted_at],
      ["deleted_via", m.deleted_via],
      ["removed_again_at", m.removed_again_at],
      ["removed_reason", m.removed_reason],
      ["restored_via", m.restored_via],
    ];
    for (const [k, v] of fields) {
      if (v != null && v !== "") console.log(`    ${k}: ${v}`);
    }
    // resolve email se só tem admin id
    const aid = m.cancelled_admin_id || m.cancelled_by || m.deleted_admin_id || m.deleted_by;
    if (aid && !m.cancelled_by_email && !m.deleted_by_email) {
      const em = await resolveEmail(String(aid));
      if (em) console.log(`    admin_email (resolvido): ${em}`);
    }
  }
  if (!metaHits) {
    console.log("  (nenhum metadata de cancel/delete com IP/admin neste dia)");
    console.log(`  desafios tocados hoje (qualquer status): ${list.length}`);
  }

  // ── 2) admin_audit_logs ──
  console.log("\n══ 2) admin_audit_logs ══");
  let audits = null;
  for (const q of [
    `/rest/v1/admin_audit_logs?created_at=gte.${encodeURIComponent(fromIso)}&created_at=lt.${encodeURIComponent(toIso)}&or=(action.ilike.*CANCEL*,action.ilike.*DELETE*,action.ilike.*DESAFIO*,entity_type.eq.desafio)&select=*&order=created_at.desc&limit=200`,
    `/rest/v1/admin_audit_logs?created_at=gte.${encodeURIComponent(fromIso)}&created_at=lt.${encodeURIComponent(toIso)}&select=*&order=created_at.desc&limit=200`,
  ]) {
    audits = await sb(q, { okNull: true });
    if (Array.isArray(audits)) break;
  }
  if (!Array.isArray(audits)) {
    console.log("  tabela admin_audit_logs indisponível ou vazia");
  } else {
    const relevant = audits.filter((a) => {
      const act = String(a.action || "").toUpperCase();
      const et = String(a.entity_type || "").toLowerCase();
      const det = JSON.stringify(a.details || a.payload || {}).toLowerCase();
      return (
        et === "desafio" ||
        act.includes("CANCEL") ||
        act.includes("DELETE") ||
        act.includes("DESAFIO") ||
        det.includes("desafio") ||
        det.includes("cancel")
      );
    });
    console.log(`  registros relevantes: ${relevant.length} / ${audits.length} no dia`);
    for (const a of relevant) {
      const det = a.details || a.payload || {};
      console.log(`\n  ${fmtBr(a.created_at)}  action=${a.action}`);
      console.log(`    entity: ${a.entity_type || "—"} ${a.entity_id || ""}`);
      console.log(`    admin_id: ${a.admin_id || "—"}`);
      if (det.admin_email) console.log(`    admin_email: ${det.admin_email}`);
      if (det.admin_name) console.log(`    admin_name: ${det.admin_name}`);
      if (det.ip) console.log(`    ip: ${det.ip}`);
      if (det.user_agent) console.log(`    ua: ${String(det.user_agent).slice(0, 120)}`);
      if (!det.admin_email && a.admin_id) {
        const em = await resolveEmail(a.admin_id);
        if (em) console.log(`    admin_email (resolvido): ${em}`);
      }
    }
    if (!relevant.length) console.log("  (nenhum audit de cancel/delete desafio hoje)");
  }

  // ── 3) arquivo local de audit ──
  console.log("\n══ 3) /var/log/arbishield/desafio-admin-actions.log ══");
  const logFile =
    process.env.DESAFIO_ADMIN_AUDIT_LOG ||
    "/var/log/arbishield/desafio-admin-actions.log";
  if (fs.existsSync(logFile)) {
    const lines = fs.readFileSync(logFile, "utf8").split("\n");
    const dayHits = lines.filter((l) => l.includes(ymd) || l.includes(fromIso.slice(0, 10)));
    console.log(`  linhas no arquivo: ${lines.length} · do dia≈ ${dayHits.length}`);
    for (const l of dayHits.slice(-80)) {
      if (/CANCEL|DELETE|DESAFIO/i.test(l)) console.log("  " + l);
    }
  } else {
    console.log(`  arquivo ausente: ${logFile}`);
    console.log("  (shim de audit e-mail/IP pode não estar deployado nesta VPS)");
  }

  // ── 4) nginx access log ──
  console.log("\n══ 4) nginx · desafio-cancel / desafio-delete ══");
  const nginxCandidates = [
    "/var/log/nginx/access.log",
    "/var/log/nginx/arbishield.app.access.log",
    "/var/log/nginx/arbishield.access.log",
    "/var/log/nginx/access.log.1",
  ];
  let nginxHit = false;
  for (const f of nginxCandidates) {
    if (!fs.existsSync(f)) continue;
    try {
      const out = execSync(
        `grep -E 'desafio-cancel|desafio-delete' ${JSON.stringify(f)} | tail -n 80 || true`,
        { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }
      );
      if (out.trim()) {
        nginxHit = true;
        console.log(`  arquivo: ${f}`);
        for (const line of out.trim().split("\n")) {
          // típico: IP - - [date] "POST /api/... HTTP/1.1" status
          console.log("  " + line.slice(0, 280));
        }
      }
    } catch {
      /* */
    }
  }
  if (!nginxHit) {
    // try journal / find
    try {
      const found = execSync(
        `ls /var/log/nginx/*access* 2>/dev/null | head -20 || true`,
        { encoding: "utf8" }
      );
      console.log("  logs nginx encontrados:");
      console.log(found || "  (nenhum)");
      if (found.trim()) {
        const first = found.trim().split("\n")[0];
        const out = execSync(
          `grep -E 'desafio-cancel|desafio-delete' ${JSON.stringify(first)} | tail -n 40 || true`,
          { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 }
        );
        if (out.trim()) {
          nginxHit = true;
          console.log(out);
        }
      }
    } catch {
      /* */
    }
  }
  if (!nginxHit) console.log("  (sem hits desafio-cancel/delete nos access logs)");

  // ── 5) journalctl shim ──
  console.log("\n══ 5) journalctl arbishield-serverfn-shim (desafio-admin-audit) ══");
  try {
    const j = execSync(
      `journalctl -u arbishield-serverfn-shim.service --since "${ymd} 00:00:00" --until "${ymd} 23:59:59" --no-pager 2>/dev/null | grep -E 'desafio-admin-audit|desafio-cancel|CANCEL|DELETE' | tail -n 60 || true`,
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }
    );
    if (j.trim()) console.log(j);
    else console.log("  (sem linhas de audit no journal hoje)");
  } catch {
    console.log("  (journalctl indisponível)");
  }

  console.log("\n" + "═".repeat(72));
  console.log("OK — se metadata/audit estiverem vazios, a VPS pode estar sem o shim");
  console.log("com desafio-admin-audit-email-v1; use o trecho nginx (IP da request).");
}

main().catch((e) => {
  console.error("ERRO:", e instanceof Error ? e.message : e);
  process.exit(1);
});
