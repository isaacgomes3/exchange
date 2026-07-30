#!/usr/bin/env node
/**
 * Auditoria pós-liquidação dos 4 eventos A LIQUIDAR (tag liquidar-eventos-a-liquidar-v10).
 *
 * Confere por bilhete:
 *   Exchange   → stake devolvido · dedução cobrada · Reembolso não creditado por este bilhete
 *   ArbiShield → stake no Saldo Reembolso · sem dedução Exchange
 *
 * Na VPS (somente leitura):
 *   node scripts/vps-audit-pos-liquidar-a-liquidar-v10.mjs
 *
 * Marker: vps-audit-pos-liquidar-a-liquidar-v10
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAG = "liquidar-eventos-a-liquidar-v10";

const EVENTS = [
  {
    key: "kauno",
    homeHint: /kauno/i,
    awayHint: /k[ií]|klaksvik|women/i,
    outcome: "exchange",
    score: "1-0",
  },
  {
    key: "lech",
    homeHint: /lech/i,
    awayHint: /aarhus/i,
    outcome: "exchange",
    score: "1-4",
  },
  {
    key: "craiova",
    homeHint: /craiova/i,
    awayHint: /levski/i,
    outcome: "arbishield",
    score: "2-2",
  },
  {
    key: "barracas",
    homeHint: /barracas/i,
    awayHint: /aldosivi/i,
    outcome: "exchange",
    score: "1-0",
  },
];

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

const contract = await import(
  pathToFileURL(path.resolve(__dirname, "lib/protection-flow-contract.mjs")).href
);
const {
  PROTECTION_FLOW_CONTRACT_VERSION,
  settlementDeductionCents,
  computeArbiShieldDeductionCents,
  isFeeUpfrontProtection,
  exchangeWalletHealNeeded,
} = contract;

function money(c) {
  return (Number(c || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : 0;
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

async function sb(p, { method = "GET", body } = {}) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body != null ? JSON.stringify(body) : undefined,
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

async function loadMatches() {
  const rows = await sb(`/rest/v1/matches?select=*&order=starts_at.desc&limit=500`);
  return Array.isArray(rows) ? rows : [];
}

function matchEvent(m, ev) {
  const home = String(m.home_team || "");
  const away = String(m.away_team || "");
  return ev.homeHint.test(home) && ev.awayHint.test(away);
}

async function loadPrior(protectionId) {
  const rows = await sb(
    `/rest/v1/wallet_transactions?ref=eq.${encodeURIComponent(
      protectionId
    )}&type=in.(protection_settlement,protection_refund,protection_fee,exchange_commission)&select=id,type,amount_cents,metadata,created_at&order=created_at.desc&limit=120`
  );
  const list = Array.isArray(rows) ? rows : [];
  let feeCharged = 0;
  let stakeReturned = 0;
  let reembolsoCredited = 0;
  let unlocked = false;
  let tagHits = 0;
  for (const t of list) {
    const m = metaOf(t);
    if (m.tag === TAG || String(m.note || "").includes(TAG)) tagHits += 1;
    const amt = n(t.amount_cents);
    if (m.clawback_reembolso_cents != null) {
      reembolsoCredited -= Math.abs(n(m.clawback_reembolso_cents) || Math.abs(amt));
      continue;
    }
    if (m.clawback_stake_cents != null) {
      stakeReturned -= Math.abs(n(m.clawback_stake_cents));
      if (m.fee_refunded_cents != null) {
        feeCharged -= Math.abs(n(m.fee_refunded_cents));
      }
      continue;
    }
    if (t.type === "protection_fee" && amt < 0) feeCharged += Math.abs(amt);
    if (t.type === "protection_settlement" && amt < 0) {
      const looksFee =
        m.outcome === "exchange" ||
        m.exchange_no_credit === true ||
        n(m.fee_charged_now_cents) > 0 ||
        /settle exchange/i.test(String(m.note || ""));
      if (looksFee) feeCharged += Math.abs(amt);
    } else if (
      t.type === "protection_settlement" &&
      m.outcome === "exchange" &&
      !(amt < 0) &&
      n(m.fee_charged_now_cents) > 0
    ) {
      feeCharged += n(m.fee_charged_now_cents);
    }
    if (t.type === "protection_refund" && amt > 0) feeCharged -= amt;
    if (
      t.type === "protection_settlement" &&
      amt > 0 &&
      (m.outcome === "arbishield" ||
        (m.bucket === "deduction_balance_cents" && m.outcome !== "exchange"))
    ) {
      reembolsoCredited += amt;
    }
    if (t.type === "protection_settlement" && m.stake_returned === true) {
      if (m.returned_stake_cents != null) {
        stakeReturned += Math.abs(n(m.returned_stake_cents));
      } else if (
        amt > 0 &&
        m.outcome !== "arbishield" &&
        m.bucket !== "deduction_balance_cents"
      ) {
        stakeReturned += amt;
      }
    }
    if (m.unlocked_locked === true) unlocked = true;
  }
  return {
    feeCharged: Math.max(0, feeCharged),
    stakeReturned: Math.max(0, stakeReturned),
    reembolsoCredited: Math.max(0, reembolsoCredited),
    unlocked,
    hasTx: list.length > 0,
    tagHits,
    txs: list.slice(0, 8),
  };
}

async function main() {
  console.log("==> Auditoria pós-liquidar A LIQUIDAR");
  console.log("    contrato:", PROTECTION_FLOW_CONTRACT_VERSION);
  console.log("    tag:", TAG);

  const matches = await loadMatches();
  let alerts = 0;
  let checked = 0;

  for (const ev of EVENTS) {
    const match = matches.find((m) => matchEvent(m, ev));
    console.log(`\n==== ${ev.key.toUpperCase()} → ${ev.outcome} placar ${ev.score} ====`);
    if (!match) {
      console.log("  XX partida não encontrada");
      alerts += 1;
      continue;
    }
    const mm = metaOf(match);
    console.log(
      `  match ${String(match.id).slice(0, 8)}  status=${match.status}  score=${
        match.final_score || "?"
      }  meta_outcome=${mm.settled_outcome || mm.outcome || "?"}`
    );
    if (String(match.status).toLowerCase() !== "settled") {
      console.log("  ALERTA: match não está settled");
      alerts += 1;
    }
    if (String(mm.settled_outcome || mm.outcome || "").toLowerCase() !== ev.outcome) {
      console.log(
        `  ALERTA: outcome do match=${mm.settled_outcome || mm.outcome} esperado=${ev.outcome}`
      );
      alerts += 1;
    }

    const [lays, backs] = await Promise.all([
      sb(
        `/rest/v1/protections?match_id=eq.${encodeURIComponent(
          match.id
        )}&select=*&limit=100`
      ),
      sb(
        `/rest/v1/back_protections?match_id=eq.${encodeURIComponent(
          match.id
        )}&select=*&limit=100`
      ).catch(() => []),
    ]);
    const all = [
      ...(Array.isArray(lays) ? lays : []),
      ...(Array.isArray(backs) ? backs : []),
    ];
    console.log(`  proteções no jogo: ${all.length}`);

    for (const row of all) {
      checked += 1;
      const amount = n(row.responsibility_cents || row.amount_cents);
      const meta = metaOf(row);
      const fee =
        computeArbiShieldDeductionCents(row) || settlementDeductionCents(row);
      const prior = await loadPrior(row.id);
      const p = (
        await sb(
          `/rest/v1/profiles?id=eq.${encodeURIComponent(
            row.user_id
          )}&select=id,full_name,balance_cents,reusable_balance_cents,locked_balance_cents,deduction_balance_cents&limit=1`
        )
      )?.[0];
      const name = p?.full_name || String(row.user_id).slice(0, 8);
      const st = String(row.status || "").toLowerCase();
      const odd = meta.market_odd || row.odd || "?";
      const billing = meta.billing_model || (isFeeUpfrontProtection(row) ? "fee_upfront_v1" : "?");

      console.log(
        `\n  • ${String(row.id).slice(0, 8)}  ${name}\n    status=${st}  stake=${money(
          amount
        )}  odd=${odd}  model=${billing}\n    fee_esperada=${money(
          fee
        )}  fee_cobrada(ledger)=${money(prior.feeCharged)}\n    stake_devolvido(ledger)=${money(
          prior.stakeReturned
        )}  reembolso(ledger)=${money(prior.reembolsoCredited)}  tag_hits=${
          prior.tagHits
        }`
      );
      if (p) {
        console.log(
          `    saldo=${money(n(p.balance_cents) + n(p.reusable_balance_cents))}  locked=${money(
            p.locked_balance_cents
          )}  reembolso_bucket=${money(p.deduction_balance_cents)}`
        );
      }

      const flags = [];
      if (ev.outcome === "exchange") {
        if (amount > 0 && prior.stakeReturned < amount) {
          flags.push(
            `stake incompleto (faltam ${money(amount - prior.stakeReturned)})`
          );
        } else if (amount > 0 && prior.stakeReturned > amount) {
          flags.push(
            `stake ledger acima do bilhete (${money(prior.stakeReturned)} > ${money(
              amount
            )}) — possível re-run duplicando metadata`
          );
        }
        if (fee > 0 && prior.feeCharged < fee) {
          flags.push(
            `dedução incompleta (faltam ${money(fee - prior.feeCharged)})`
          );
        } else if (fee > 0 && prior.feeCharged > fee + 50) {
          flags.push(
            `dedução ledger acima do esperado (${money(prior.feeCharged)} > ${money(fee)})`
          );
        }
        if (prior.reembolsoCredited > 0) {
          flags.push(
            `reembolso indevido em bilhete Exchange (${money(prior.reembolsoCredited)}) — deve reverter`
          );
        }
        if (st === "lost_exchange" || st === "won_platform") {
          flags.push(
            `status ${st} = ArbiShield, mas placar manda Exchange (won_exchange)`
          );
        } else if (
          !["won_exchange", "settled"].includes(st) &&
          st !== "cancelled" &&
          st !== "canceled"
        ) {
          flags.push(`status inesperado para Exchange: ${st}`);
        }
        if (exchangeWalletHealNeeded(row, { ...prior, hasTx: true })) {
          flags.push("exchangeWalletHealNeeded=true");
        }
      } else if (ev.outcome === "arbishield") {
        if (amount > 0 && prior.reembolsoCredited < amount) {
          flags.push(
            `reembolso incompleto (faltam ${money(amount - prior.reembolsoCredited)})`
          );
        }
        // lost_exchange é o status canônico v10 para ArbiShield (settlementStatusForOutcome)
        if (st === "won_exchange") {
          flags.push("ainda marcado won_exchange — deveria ser lost_exchange/ArbiShield");
        } else if (!["won_platform", "lost_exchange", "settled", "lost_platform"].includes(st)) {
          flags.push(`status inesperado para ArbiShield: ${st}`);
        }
      }

      if (flags.length) {
        alerts += flags.length;
        for (const f of flags) console.log(`    ALERTA: ${f}`);
      } else {
        console.log("    OK v10");
      }
    }
  }

  console.log(`\n==== RESUMO ====`);
  console.log(`  bilhetes checados: ${checked}`);
  console.log(`  alertas: ${alerts}`);
  if (alerts > 0) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
