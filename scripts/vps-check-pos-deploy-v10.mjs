#!/usr/bin/env node
/**
 * Check pós-deploy v10 / stake_lock_v1 (anti-regressão).
 *
 * 1) GET /health :3098 e :3101 → exige protection-runtime-stake-lock-v10
 *    + createProtectionModel=stake_lock_v1 + contract v10
 *    → FALHA se health citar fee_upfront / protection-fee-upfront
 * 2) (opcional) proteções criadas desde SINCE: nenhuma nova fee_upfront_v1
 *
 * Na VPS:
 *   node scripts/vps-check-pos-deploy-v10.mjs
 *   SINCE=2026-07-30T12:00:00.000Z SKIP_DB=1 node ...
 *
 * Marker: vps-check-pos-deploy-v10
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SINCE = String(
  process.env.SINCE || new Date(Date.now() - 6 * 3600_000).toISOString()
).trim();
const SKIP_DB = ["1", "true", "yes"].includes(
  String(process.env.SKIP_DB || "").toLowerCase()
);
const HEALTH_3098 =
  process.env.HEALTH_3098 || "http://127.0.0.1:3098/health";
const HEALTH_3101 =
  process.env.HEALTH_3101 || "http://127.0.0.1:3101/health";

let PROTECTION_RUNTIME_HEALTH_MARKER = "protection-runtime-stake-lock-v10";
let PROTECTION_BILLING_MODEL_CANONICAL = "stake_lock_v1";
let PROTECTION_FLOW_CONTRACT_VERSION = "protection-flow-contract-v10";
let CREATE_PROTECTION_FIX_MARKER = "create-protection-stake-lock-v6";
let isProtectionRuntimeHealthy = (h) => {
  const model = String(h?.createProtectionModel || "").trim();
  const runtime = String(h?.protectionRuntime || h?.fix || "").trim();
  const blob = JSON.stringify(h || {});
  if (/protection-fee-upfront-v\d+/i.test(blob)) return false;
  if (/fee_upfront/i.test(model)) return false;
  return (
    model === "stake_lock_v1" &&
    (runtime.includes("stake-lock") || runtime.includes("stake_lock"))
  );
};

try {
  const mod = await import(
    pathToFileURL(
      path.resolve(__dirname, "lib/protection-flow-contract.mjs")
    ).href
  );
  PROTECTION_RUNTIME_HEALTH_MARKER = mod.PROTECTION_RUNTIME_HEALTH_MARKER;
  PROTECTION_BILLING_MODEL_CANONICAL = mod.PROTECTION_BILLING_MODEL_CANONICAL;
  PROTECTION_FLOW_CONTRACT_VERSION = mod.PROTECTION_FLOW_CONTRACT_VERSION;
  CREATE_PROTECTION_FIX_MARKER = mod.CREATE_PROTECTION_FIX_MARKER;
  isProtectionRuntimeHealthy = mod.isProtectionRuntimeHealthy;
} catch (e) {
  console.warn("AVISO: contrato local não carregou, usando fallbacks:", e.message);
}

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

function metaOf(row) {
  const m = row && row.metadata;
  if (!m) return {};
  if (typeof m === "string") {
    try {
      return JSON.parse(m) || {};
    } catch {
      return {};
    }
  }
  return typeof m === "object" && m ? m : {};
}

function billingOf(row) {
  const m = metaOf(row);
  if (m.billing_model) return String(m.billing_model);
  if (m.fee_upfront === true || m.fee_upfront === "true") return "fee_upfront_v1";
  if (m.stake_lock === true || m.stake_lock === "true") return "stake_lock_v1";
  return "(sem marker)";
}

async function fetchHealth(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, text };
}

function assertHealth(label, { status, data, text }) {
  const errs = [];
  if (status !== 200) errs.push(`${label} HTTP ${status} (esperado 200)`);
  if (!isProtectionRuntimeHealthy(data)) {
    errs.push(`${label} isProtectionRuntimeHealthy=false`);
  }
  if (!String(text).includes(PROTECTION_RUNTIME_HEALTH_MARKER)) {
    errs.push(`${label} sem ${PROTECTION_RUNTIME_HEALTH_MARKER}`);
  }
  if (data.createProtectionModel !== PROTECTION_BILLING_MODEL_CANONICAL) {
    errs.push(
      `${label} createProtectionModel=${data.createProtectionModel} (esperado ${PROTECTION_BILLING_MODEL_CANONICAL})`
    );
  }
  if (
    data.protectionFlowContract &&
    data.protectionFlowContract !== PROTECTION_FLOW_CONTRACT_VERSION
  ) {
    errs.push(
      `${label} protectionFlowContract=${data.protectionFlowContract}`
    );
  }
  if (/protection-fee-upfront-v\d+/i.test(text) || /fee_upfront_v1/i.test(String(data.createProtectionModel || ""))) {
    errs.push(`${label} REGRESSÃO fee_upfront detectada`);
  }
  if (
    data.fix &&
    !String(data.fix).includes("stake-lock") &&
    !String(data.fix).includes(CREATE_PROTECTION_FIX_MARKER)
  ) {
    errs.push(`${label} fix inesperado: ${data.fix}`);
  }
  return errs;
}

async function sb(p) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "count=exact",
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${p}\n${String(text).slice(0, 600)}`);
  return data;
}

console.log("==> vps-check-pos-deploy-v10");
console.log(`  markers: ${PROTECTION_RUNTIME_HEALTH_MARKER} · ${PROTECTION_BILLING_MODEL_CANONICAL} · ${PROTECTION_FLOW_CONTRACT_VERSION}`);

const errors = [];

for (const [label, url] of [
  [":3098", HEALTH_3098],
  [":3101", HEALTH_3101],
]) {
  try {
    const h = await fetchHealth(url);
    console.log(`  health ${label} HTTP ${h.status} →`, JSON.stringify(h.data).slice(0, 280));
    errors.push(...assertHealth(label, h));
  } catch (e) {
    errors.push(`${label} unreachable: ${e.message}`);
  }
}

if (!SKIP_DB) {
  if (!SERVICE_KEY) {
    console.warn("AVISO: SERVICE_ROLE_KEY ausente — pulando check billing_model (use SKIP_DB=1 para silenciar)");
  } else {
    console.log(`  DB proteções desde ${SINCE}`);
    let list;
    try {
      const rows = await sb(
        `/rest/v1/protections?select=id,created_at,status,metadata,amount_cents,odd&created_at=gte.${encodeURIComponent(SINCE)}&order=created_at.desc&limit=200`
      );
      list = Array.isArray(rows) ? rows : [];
    } catch (e) {
      const msg = String(e.message || e);
      if (/42703|does not exist/i.test(msg)) {
        console.warn("  AVISO: select com colunas extras falhou, retry mínimo");
        const rows = await sb(
          `/rest/v1/protections?select=id,created_at,status,metadata&created_at=gte.${encodeURIComponent(SINCE)}&order=created_at.desc&limit=200`
        );
        list = Array.isArray(rows) ? rows : [];
      } else {
        throw e;
      }
    }
    const byBilling = {};
    for (const r of list) {
      const b = billingOf(r);
      byBilling[b] = (byBilling[b] || 0) + 1;
    }
    console.log(`  total=${list.length}`, byBilling);
    const feeNew = list.filter((r) => billingOf(r) === "fee_upfront_v1");
    if (feeNew.length > 0) {
      errors.push(
        `REGRESSÃO: ${feeNew.length} proteção(ões) fee_upfront_v1 desde ${SINCE} (ids: ${feeNew
          .slice(0, 5)
          .map((r) => r.id)
          .join(", ")})`
      );
    }
    const stake = list.filter((r) => billingOf(r) === "stake_lock_v1");
    if (list.length > 0 && stake.length === 0) {
      errors.push(
        `nenhuma proteção stake_lock_v1 desde ${SINCE} (há ${list.length} linhas)`
      );
    }
  }
} else {
  console.log("  SKIP_DB=1 — sem check billing_model");
}

// Layout no disco (VPS): metas críticas se os HTML existirem
const SKIP_UI = ["1", "true", "yes"].includes(
  String(process.env.SKIP_UI || "").toLowerCase()
);
if (!SKIP_UI) {
  const webRoots = [
    process.env.ARBISHIELD_WEB,
    "/var/www/arbishield/v2",
    "/var/www/arbishield",
  ].filter(Boolean);
  const pages = [
    ["app-proteger.html", ["proteger-stake-lock-v6", "proteger-sem-stake-equiv"]],
    ["app-carteira.html", ["Saldo Reembolso"]],
    ["admin-jogos.html", ["football-teams", "searchFootballTeams", "Lançar evento", "Publicar na fila"]],
    ["admin-manual-deposits.html", ["Confirmar e Creditar", "Já creditado", "admin-deposits-creditar-v1"]],
    [
      "admin-monitoring-desafios.html",
      [
        "desafio-monitor-card-layout-v1",
        "mdz-card-game",
        "mdz-card-foot",
        "Bateu Arbi",
        "Empate Anula",
      ],
    ],
  ];
  const assets = [
    [
      "v2-shell.js",
      [
        "bindAdminNavAccordion",
        "v2-nav-accordion-btn",
        'accordion: shell === "admin"',
        "Modo usuário",
        "Modo ADM",
        "v2ModeSwitch",
        "getEffectiveUserId",
        "Sair do espelho",
        "v2ImpersonateBanner",
      ],
    ],
    ["v2.css", ["v2-nav-accordion-btn", "sec-chevron", ".v2-mode-switch"]],
    [
      "v2.js",
      [
        "impersonated_user_id",
        "getEffectiveUserId",
        "setImpersonation",
        "clearImpersonation",
      ],
    ],
    [
      "admin-users.html",
      ["startMirror", "Espelho", "Acessar Conta (Espelho)", "setImpersonation"],
    ],
  ];
  let checked = 0;
  for (const root of webRoots) {
    for (const [name, needles] of pages) {
      const p = path.join(root, name);
      if (!fs.existsSync(p)) continue;
      const html = fs.readFileSync(p, "utf8");
      checked += 1;
      for (const n of needles) {
        if (!html.includes(n)) {
          errors.push(`UI ${p} sem "${n}"`);
        }
      }
      if (name === "app-carteira.html" && html.includes("Saldo Dedução")) {
        errors.push(`UI ${p} ainda tem "Saldo Dedução"`);
      }
      if (
        name === "admin-monitoring-desafios.html" &&
        html.includes('<table class="mdz">')
      ) {
        errors.push(`UI ${p} reverteu para tabela .mdz (esperado cards)`);
      }
    }
    for (const [name, needles] of assets) {
      const p = path.join(root, name);
      if (!fs.existsSync(p)) continue;
      const text = fs.readFileSync(p, "utf8");
      checked += 1;
      for (const n of needles) {
        if (!text.includes(n)) {
          errors.push(`UI ${p} sem "${n}"`);
        }
      }
    }
    if (checked > 0) break;
  }
  console.log(`  UI disco pages_checked=${checked}`);
} else {
  console.log("  SKIP_UI=1 — sem check layout");
}

if (errors.length) {
  console.error("\nFALHOU pós-deploy v10:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}

console.log("\nOK — runtime v10/stake_lock saudável (health + billing + UI).");
process.exit(0);
