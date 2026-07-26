#!/usr/bin/env node
/**
 * Corrige proteção liquidada errado como Exchange (Perdeu) → ArbiShield (Ganhou).
 *
 * Caso: Fratria Varna × Marek Dupnitsa · proteção 5df3ae87… · user 8b2cd8a3…
 * fee_upfront: credita stake + dedução no Saldo Reembolso e marca lost_exchange.
 *
 * Somente leitura:
 *   PROTECTION_ID=5df3ae87 MATCH="Fratria" node scripts/vps-corrigir-protecao-arbishield.mjs
 *
 * Aplicar:
 *   FIX=1 PROTECTION_ID=5df3ae87 MATCH="Fratria" node scripts/vps-corrigir-protecao-arbishield.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const PROTECTION_ID = String(process.env.PROTECTION_ID || "5df3ae87").trim();
const MATCH = String(process.env.MATCH || "Fratria").trim();
const USER_PREFIX = String(process.env.USER_PREFIX || "8b2cd8a3").trim();

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

let settlementCreditParts;
let settlementDeductionCents;
let isFeeUpfrontProtection;
try {
  const contract = await import(
    path.resolve(__dirname, "lib/protection-flow-contract.mjs")
  );
  settlementCreditParts = contract.settlementCreditParts;
  settlementDeductionCents = contract.settlementDeductionCents;
  isFeeUpfrontProtection = contract.isFeeUpfrontProtection;
} catch {
  try {
    const contract = require("./lib/protection-flow-contract.mjs");
    settlementCreditParts = contract.settlementCreditParts;
    settlementDeductionCents = contract.settlementDeductionCents;
    isFeeUpfrontProtection = contract.isFeeUpfrontProtection;
  } catch (e) {
    console.error("ERRO: não carregou protection-flow-contract.mjs", e.message || e);
    process.exit(1);
  }
}

function money(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : 0;
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
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 280)}`);
  return data;
}

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

async function findProtection() {
  const idQ = encodeURIComponent(PROTECTION_ID + "%");
  for (const table of ["protections", "back_protections"]) {
    const byId = await sb(
      `/rest/v1/${table}?select=*&id=ilike.${idQ}&order=created_at.desc&limit=5`
    ).catch(() => []);
    const list = Array.isArray(byId) ? byId : [];
    if (list.length) {
      return list.map((r) => ({
        ...r,
        _table: table,
        market_category: table === "back_protections" ? "BACK" : "LAY",
      }));
    }
  }

  const mq = encodeURIComponent("%" + MATCH + "%");
  const matches = await sb(
    `/rest/v1/matches?select=id,home_team,away_team,league,starts_at,final_score,status&or=(home_team.ilike.${mq},away_team.ilike.${mq})&order=starts_at.desc&limit=20`
  );
  const mlist = Array.isArray(matches) ? matches : [];
  const matchIds = mlist.map((m) => m.id);
  if (!matchIds.length) return [];

  const inList = matchIds.map(encodeURIComponent).join(",");
  const [lays, backs] = await Promise.all([
    sb(
      `/rest/v1/protections?select=*&match_id=in.(${inList})&order=created_at.desc&limit=100`
    ).catch(() => []),
    sb(
      `/rest/v1/back_protections?select=*&match_id=in.(${inList})&order=created_at.desc&limit=100`
    ).catch(() => []),
  ]);

  let rows = []
    .concat(
      (Array.isArray(lays) ? lays : []).map((r) => ({
        ...r,
        _table: "protections",
        market_category: "LAY",
      }))
    )
    .concat(
      (Array.isArray(backs) ? backs : []).map((r) => ({
        ...r,
        _table: "back_protections",
        market_category: "BACK",
      }))
    );

  if (USER_PREFIX) {
    const filtered = rows.filter((r) =>
      String(r.user_id || "").toLowerCase().startsWith(USER_PREFIX.toLowerCase())
    );
    if (filtered.length) rows = filtered;
  }
  return rows;
}

async function main() {
  console.log("==> Corrigir proteção Exchange → ArbiShield");
  console.log("    PROTECTION_ID~", PROTECTION_ID);
  console.log("    MATCH~", MATCH);
  console.log("    USER_PREFIX~", USER_PREFIX || "(qualquer)");
  console.log("    FIX:", FIX ? "SIM" : "não (dry-run)");

  const rows = await findProtection();
  if (!rows.length) throw new Error("proteção não encontrada");

  for (const row of rows) {
    const matchRows = row.match_id
      ? await sb(
          `/rest/v1/matches?select=id,home_team,away_team,starts_at,final_score,league&id=eq.${encodeURIComponent(row.match_id)}&limit=1`
        ).catch(() => [])
      : [];
    const m = Array.isArray(matchRows) ? matchRows[0] || {} : {};
    const amount = n(row.responsibility_cents || row.amount_cents);
    const fee = settlementDeductionCents(row);
    const feeUpfront = isFeeUpfrontProtection(row);
    const parts = settlementCreditParts(row, "arbishield");
    const credit = parts.total;
    const st = String(row.status || "").toLowerCase();
    const outcome = String(row.settled_outcome || row.result || "").toLowerCase();

    console.log("\n— proteção", row.id);
    console.log(
      `  jogo: ${(m.home_team || "?") + " × " + (m.away_team || "?")}  placar=${m.final_score || "—"}  ${m.starts_at || ""}`
    );
    console.log(
      `  user=${row.user_id}  tabela=${row._table}  side=${row.market_category}`
    );
    console.log(
      `  status=${st}  settled_outcome=${outcome || "—"}  odd=${row.odd}`
    );
    console.log(
      `  stake=${money(amount)}  fee=${money(fee)}  fee_upfront=${feeUpfront}`
    );
    console.log(
      `  crédito ArbiShield esperado=${money(credit)} (stake ${money(parts.stake)} + fee ${money(parts.fee)})`
    );

    const txs = await sb(
      `/rest/v1/wallet_transactions?select=id,type,amount_cents,created_at,metadata,ref&user_id=eq.${encodeURIComponent(row.user_id)}&order=created_at.desc&limit=400`
    ).catch(() => []);
    const tlist = (Array.isArray(txs) ? txs : []).filter(
      (t) =>
        String(t.ref || "") === String(row.id) ||
        (t.metadata && String(t.metadata.protection_id || "") === String(row.id))
    );
    console.log("  wallet_tx:");
    if (!tlist.length) console.log("    (nenhuma)");
    for (const t of tlist) {
      console.log(
        `    ${t.created_at}  ${t.type}  ${money(t.amount_cents)}`
      );
    }

    const positiveCredit = tlist
      .filter((t) =>
        ["protection_settlement", "protection_release", "protection_refund"].includes(
          String(t.type || "")
        )
      )
      .reduce((a, t) => a + Math.max(0, n(t.amount_cents)), 0);

    const alreadyArbi =
      st === "lost_exchange" ||
      st === "won_platform" ||
      outcome === "arbishield";

    if (alreadyArbi && positiveCredit >= credit) {
      console.log("  → já está como ArbiShield com crédito suficiente — nada a fazer");
      continue;
    }

    const wrongExchange =
      st === "won_exchange" ||
      outcome === "exchange" ||
      outcome === "won_exchange";

    if (!wrongExchange && !alreadyArbi) {
      console.log("  → status inesperado — revise manualmente antes de FIX=1");
      continue;
    }

    const needCredit = Math.max(0, credit - positiveCredit);
    console.log(
      `  positivo já creditado=${money(positiveCredit)}  falta creditar=${money(needCredit)}`
    );

    if (!FIX) {
      console.log(
        "  Dry-run OK. Para aplicar:\n    FIX=1 PROTECTION_ID=" +
          PROTECTION_ID +
          ' MATCH="' +
          MATCH +
          '" node scripts/vps-corrigir-protecao-arbishield.mjs'
      );
      continue;
    }

    const now = new Date().toISOString();
    const meta = {
      ...metaOf(row),
      settlement_correction: {
        at: now,
        from_status: st,
        from_outcome: outcome || null,
        to_outcome: "arbishield",
        to_status: "lost_exchange",
        credit_cents: needCredit,
        reason: "marcado_errado_exchange_era_arbishield",
        fix: "vps-corrigir-protecao-arbishield-v1",
        match: `${m.home_team || "?"} × ${m.away_team || "?"}`,
        final_score: m.final_score || null,
      },
    };

    if (needCredit > 0) {
      const prof = await sb(
        `/rest/v1/profiles?select=balance_cents,reusable_balance_cents,locked_balance_cents,demo_balance_cents,investor_balance_cents,deduction_balance_cents&id=eq.${encodeURIComponent(row.user_id)}&limit=1`
      );
      const p = Array.isArray(prof) ? prof[0] : null;
      if (!p) throw new Error("perfil não encontrado: " + row.user_id);

      const attempts = [
        {
          deduction_balance_cents: n(p.deduction_balance_cents) + needCredit,
          updated_at: now,
        },
        {
          deduction_balance_cents: n(p.deduction_balance_cents) + needCredit,
        },
        {
          balance_cents: n(p.balance_cents) + needCredit,
          updated_at: now,
        },
        {
          balance_cents: n(p.balance_cents) + needCredit,
        },
      ];
      let credited = false;
      let lastErr = null;
      for (const body of attempts) {
        try {
          await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
            method: "PATCH",
            body,
          });
          credited = true;
          console.log(
            "  OK saldo +",
            money(needCredit),
            body.deduction_balance_cents != null
              ? "(Saldo Reembolso)"
              : "(balance_cents)"
          );
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!credited) throw lastErr || new Error("falha ao creditar perfil");

      await sb("/rest/v1/wallet_transactions", {
        method: "POST",
        body: {
          user_id: row.user_id,
          type: "protection_settlement",
          amount_cents: needCredit,
          ref: row.id,
          metadata: {
            protection_id: row.id,
            match_id: row.match_id || null,
            outcome: "arbishield",
            stake_cents: amount,
            fee_cents: fee,
            billing_model: feeUpfront ? "fee_upfront_v1" : "legacy",
            note: "correção: era exchange, bateu ArbiShield",
            fix: "vps-corrigir-protecao-arbishield-v1",
            previous_zero_settlement: positiveCredit === 0,
          },
        },
      });
      console.log("  OK wallet_transactions protection_settlement", money(needCredit));
    } else {
      console.log("  (sem crédito extra — só normaliza status)");
    }

    const statusAttempts = [
      {
        status: "lost_exchange",
        settled_outcome: "arbishield",
        result: "lost_exchange",
        settled_at: row.settled_at || now,
        metadata: meta,
      },
      {
        status: "lost_exchange",
        settled_outcome: "arbishield",
        settled_at: row.settled_at || now,
        metadata: meta,
      },
      {
        status: "won_platform",
        settled_outcome: "arbishield",
        settled_at: row.settled_at || now,
      },
      {
        status: "lost_exchange",
        settled_outcome: "arbishield",
        settled_at: row.settled_at || now,
      },
    ];
    let statusOk = false;
    let lastStatusErr = null;
    for (const body of statusAttempts) {
      try {
        await sb(`/rest/v1/${row._table}?id=eq.${encodeURIComponent(row.id)}`, {
          method: "PATCH",
          body,
        });
        statusOk = true;
        console.log("  OK status →", body.status, "outcome=arbishield");
        break;
      } catch (e) {
        lastStatusErr = e;
      }
    }
    if (!statusOk) {
      console.warn("  AVISO status:", lastStatusErr && lastStatusErr.message);
    }

    console.log("  CONCLUÍDO — cliente deve ver Resultado=Ganhou e reembolso", money(credit));
  }
}

main().catch((e) => {
  console.error("FALHA:", e.message || e);
  process.exit(1);
});
