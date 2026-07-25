#!/usr/bin/env bash
# Lança 1 evento teste (LAY-ou-BACK @ 1.10). Script Node embutido (sem 2º download).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-fee-upfront-3cf9/scripts/vps-lancar-evento-teste-agora.sh?$(date +%s)")
#
# Forçar novo:
#   FORCE_NEW=1 bash <(curl -fsSL "...")
set -euo pipefail

echo "==> vps-lancar-evento-teste-agora.sh ($(date -Is))"

DST_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$DST_DIR" /opt/arbishield-teste/scripts 2>/dev/null || true
DST="$DST_DIR/vps-sandbox-lancar-evento-teste.mjs"

# --- Node embutido (evita cache do raw.githubusercontent no .mjs) ---
cat > "$DST" <<'NODEEOF'
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

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
  "/opt/arbishield-teste/.env",
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

const ODD = Number(process.env.TEST_ODD || 1.1);
const LIQ_BRL = Number(process.env.TEST_LIQ_BRL || 5000);
const MINUTES = Number(process.env.TEST_MINUTES_AHEAD || 45);
const HOME = process.env.TEST_HOME || "ArbiShield Teste A";
const AWAY = process.env.TEST_AWAY || "ArbiShield Teste B";
const FORCE_NEW =
  process.env.FORCE_NEW === "1" || process.env.FORCE_NEW === "true";
const LIVE_WINDOW_MS = 9000 * 1000;

if (!SERVICE_KEY) {
  console.error("ERRO: SERVICE_ROLE_KEY ausente (.env em /opt/arbishield)");
  process.exit(1);
}

function money(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

async function sb(p, { method = "GET", body } = {}) {
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
    throw new Error(`${res.status} ${method} ${p}: ${String(text).slice(0, 400)}`);
  }
  return data;
}

function buildMarkets(liqCents) {
  const side = String(process.env.TEST_SIDE || "LAY").trim().toUpperCase() === "BACK" ? "BACK" : "LAY";
  return [
    {
      id: randomUUID(),
      name: side === "BACK" ? "Back · Sandbox Teste" : "Lay · Sandbox Teste",
      odd: ODD,
      liquidity: liqCents,
      display_liquidity: null,
      used_liquidity: 0,
      market_type: side,
      external_id: null,
    },
  ];
}

function isSandboxRow(m) {
  const meta = m.metadata && typeof m.metadata === "object" ? m.metadata : {};
  if (meta.sandbox_test === true) return true;
  if (/SANDBOX/i.test(String(m.league || ""))) return true;
  if (/ArbiShield Teste/i.test(String(m.home_team || ""))) return true;
  if (/ArbiShield Teste/i.test(String(m.away_team || ""))) return true;
  return false;
}

async function findLatestSandbox() {
  const queries = [
    `/rest/v1/matches?select=id,home_team,away_team,league,starts_at,status,status_v2,is_published,deleted_at,metadata,markets,max_protection_cents,used_protection_cents&home_team=ilike.*ArbiShield%20Teste*&order=starts_at.desc&limit=30`,
    `/rest/v1/matches?select=id,home_team,away_team,league,starts_at,status,status_v2,is_published,deleted_at,metadata,markets,max_protection_cents,used_protection_cents&order=starts_at.desc&limit=80`,
  ];
  for (const q of queries) {
    try {
      const rows = await sb(q);
      const list = (Array.isArray(rows) ? rows : []).filter(isSandboxRow);
      if (list.length) return list[0];
    } catch (e) {
      console.warn("  aviso find:", e.message || e);
    }
  }
  return null;
}

function coreBody(liqCents, startsIso, prevMeta) {
  return {
    home_team: HOME,
    away_team: AWAY,
    league: "SANDBOX · Evento teste fee_upfront",
    starts_at: startsIso,
    status: "open",
    status_v2: "open",
    is_published: true,
    sport_type: "futebol",
    max_protection_cents: liqCents,
    used_protection_cents: 0,
    protection_odds: { home: ODD, away: ODD },
    markets: buildMarkets(liqCents),
    metadata: {
      ...(prevMeta && typeof prevMeta === "object" ? prevMeta : {}),
      source: "admin_manual",
      sandbox_test: true,
      billing_model_hint: "fee_upfront_v1",
      release_minutes_before: 0,
      revived_at: new Date().toISOString(),
      note: "Evento de teste LAY-ou-BACK odd 1.10",
    },
  };
}

async function patchMatch(id, body) {
  const attempts = [
    { ...body, deleted_at: null, updated_at: new Date().toISOString() },
    { ...body, deleted_at: null },
    { ...body },
  ];
  let lastErr;
  for (const b of attempts) {
    try {
      const patched = await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: b,
      });
      return Array.isArray(patched) ? patched[0] : patched;
    } catch (e) {
      lastErr = e;
      console.warn("  aviso PATCH retry:", String(e.message || e).slice(0, 160));
    }
  }
  throw lastErr;
}

async function createMatch(body) {
  const attempts = [
    {
      ...body,
      external_id: `sandbox-test-${Date.now()}`,
      score_sync_enabled: false,
      has_live_stream: false,
    },
    { ...body, external_id: `sandbox-test-${Date.now()}-b` },
    { ...body },
  ];
  let lastErr;
  for (const b of attempts) {
    try {
      const created = await sb("/rest/v1/matches", { method: "POST", body: b });
      const match = Array.isArray(created) ? created[0] : created;
      if (!match?.id) throw new Error("POST ok mas sem id");
      return match;
    } catch (e) {
      lastErr = e;
      console.warn("  aviso POST retry:", String(e.message || e).slice(0, 200));
    }
  }
  throw lastErr;
}

function visibilityWhy(m, now = Date.now()) {
  const reasons = [];
  if (m.is_published !== true) reasons.push("is_published≠true");
  if (m.deleted_at) reasons.push("deleted_at preenchido");
  const start = new Date(m.starts_at).getTime();
  if (!Number.isFinite(start)) reasons.push("starts_at inválido");
  else if (start + LIVE_WINDOW_MS <= now) reasons.push("fora da janela");
  const status = m.status_v2 || m.status || "open";
  if (
    ["finished", "closed", "cancelled", "settled", "finalizado", "void"].includes(
      String(status).toLowerCase()
    ) ||
    status === "FINISHED"
  ) {
    reasons.push(`status=${status}`);
  }
  const max = Number(m.max_protection_cents || 0);
  const used = Number(m.used_protection_cents || 0);
  if (!(max > 0 && used < max)) reasons.push(`sem liquidez max=${max} used=${used}`);
  const mks = Array.isArray(m.markets) ? m.markets : [];
  const sides = [
    ...new Set(mks.map((mk) => String(mk.market_type || "LAY").toUpperCase())),
  ];
  if (!mks.length) reasons.push("markets vazio");
  return { ok: reasons.length === 0, reasons, sides, max, used, startsAt: m.starts_at };
}

async function main() {
  const liqCents = Math.round(LIQ_BRL * 100);
  const mins = Math.max(10, Number.isFinite(MINUTES) ? MINUTES : 45);
  const startsIso = new Date(Date.now() + mins * 60_000).toISOString();

  console.log("==> Ping Supabase", SUPABASE_URL);
  try {
    await sb("/rest/v1/matches?select=id&limit=1");
    console.log("  OK conexão REST");
  } catch (e) {
    console.error("ERRO conexão Supabase:", e.message || e);
    process.exit(1);
  }

  console.log("==> Lançar 1 evento teste LAY-ou-BACK @", ODD);
  console.log("    kickoff +", mins, "min · liq", money(liqCents));

  let match = null;
  const existing = FORCE_NEW ? null : await findLatestSandbox();

  if (existing?.id) {
    console.log("==> Reviver", existing.id, existing.home_team, "×", existing.away_team);
    try {
      match = await patchMatch(existing.id, coreBody(liqCents, startsIso, existing.metadata));
      if (!match?.id) match = { id: existing.id };
      console.log("  OK revive", match.id || existing.id);
    } catch (e) {
      console.warn("  revive falhou, criando novo:", e.message || e);
      match = await createMatch(coreBody(liqCents, startsIso, null));
      console.log("  OK create", match.id);
    }
  } else {
    console.log("==> Criar evento novo");
    match = await createMatch(coreBody(liqCents, startsIso, null));
    console.log("  OK create", match.id);
  }

  const fresh = await sb(
    `/rest/v1/matches?select=id,home_team,away_team,league,starts_at,status,status_v2,is_published,deleted_at,metadata,markets,max_protection_cents,used_protection_cents&id=eq.${encodeURIComponent(match.id)}&limit=1`
  );
  const row = Array.isArray(fresh) ? fresh[0] : null;
  if (!row) {
    console.error("ERRO: match não lido após write:", match.id);
    process.exit(1);
  }

  const v = visibilityWhy(row);
  console.log("\n==> Diagnóstico");
  console.log(v.ok ? "  ✓ VISÍVEL na grade" : "  ✗ OCULTO", row.id);
  console.log("   ", row.home_team, "×", row.away_team);
  console.log(
    "    lados:",
    v.sides.join("+") || "(nenhum)",
    "| liq",
    money(Math.max(0, v.max - v.used)),
    "|",
    new Date(v.startsAt).toLocaleString("pt-BR")
  );
  if (!v.ok) console.log("    motivos:", v.reasons.join("; "));

  const stake = 100_000;
  const profit = Math.max(0, Math.round(stake * (ODD - 1)));
  const userKeep = Math.round(stake * 0.015);
  const fee = Math.max(0, profit - userKeep);
  console.log("\n  Ex. R$ 1.000 @", ODD, "BACK → dedução", money(fee));
  console.log("\nAbrir (anônima · Todos · buscar ArbiShield Teste):");
  console.log("  https://arbishield.app/sandbox/app-proteger.html");
  console.log("  https://arbishield.app/app-proteger.html");

  if (!v.ok) process.exit(2);
  console.log("\nOK — lançou");
}

main().catch((e) => {
  console.error("ERRO FATAL:", e.message || e);
  process.exit(1);
});
NODEEOF

chmod 0755 "$DST"
cp -f "$DST" /opt/arbishield-teste/scripts/vps-sandbox-lancar-evento-teste.mjs 2>/dev/null || true

# Remove filtro antigo sandbox_test na UI (se ainda existir)
python3 - <<'PY' || true
from pathlib import Path
import re
patched = 0
for p in Path("/var/www").rglob("app-proteger.html"):
    t = p.read_text(encoding="utf-8", errors="replace")
    if "isSandboxMatch" not in t and "sandbox_test === true" not in t and "sandbox_test == true" not in t:
        continue
    n = re.sub(
        r"state\.matches = \(matchesRes\.data \|\| \[\]\)\.filter\(function \(m\) \{[\s\S]*?return isOnAvailableGrid\(m\);\s*\}\);",
        "state.matches = (matchesRes.data || []).filter(function (m) {\n"
        "            return isOnAvailableGrid(m);\n"
        "          });",
        t,
        count=1,
    )
    if n != t:
        p.write_text(n, encoding="utf-8")
        print("  UI: removeu filtro sandbox_test em", p)
        patched += 1
print("  UI: ok" if not patched else f"  UI: {patched} arquivo(s) patch")
PY

if ! command -v node >/dev/null 2>&1; then
  echo "ERRO: node não encontrado no PATH"
  exit 1
fi

echo "==> Node $(node -v) · arquivo $DST"
export FORCE_NEW="${FORCE_NEW:-1}"
export TEST_MINUTES_AHEAD="${TEST_MINUTES_AHEAD:-45}"
export TEST_ODD="${TEST_ODD:-1.1}"
export TEST_LIQ_BRL="${TEST_LIQ_BRL:-5000}"

# Default FORCE_NEW=1: cria evento fresco (evita revive quebrado)
set +e
node "$DST"
code=$?
set -e

if [[ "$code" -ne 0 ]]; then
  echo ""
  echo "FALHOU (exit $code). Cole a saída acima."
  exit "$code"
fi

echo ""
echo "Pronto. Se não aparecer: Ctrl+Shift+R · filtro Todos · buscar ArbiShield Teste"
