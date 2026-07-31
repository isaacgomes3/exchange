#!/usr/bin/env node
/**
 * 1) Remove de novo os desafios de ONTEM (#50–#53) que voltaram por engano
 * 2) Mantém/reativa só os de HOJE (#54–#59)
 * 3) Refaz entradas canceladas nesses de hoje (result → pending + debita Desafio)
 *
 * Simulação:
 *   node scripts/vps-restaurar-desafios-hoje-e-entradas.mjs
 * Aplicar:
 *   FIX=1 node scripts/vps-restaurar-desafios-hoje-e-entradas.mjs
 *
 * Opcional:
 *   SHIFT_MINUTES=90 FORCE_DEBIT=1 FIX=1 node ...
 *   (FORCE_DEBIT=1 zera saldo se insuficiente; padrão = pula entrada sem saldo)
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const FORCE_DEBIT =
  process.env.FORCE_DEBIT === "1" || process.env.FORCE_DEBIT === "true";
const SHIFT_MINUTES = Math.max(15, Number(process.env.SHIFT_MINUTES || 90) || 90);

/** Ontem — devem sair (soft-delete) */
const IDS_ONTEM = [
  "8beb938c-fa29-4bb6-9d97-fd1650bba3c4", // #50 Augsburg
  "9dd0901f-a449-47c1-8443-c1b0c66303c4", // #51 Noah
  "e502804b-05ca-4c0d-8f69-a3a45d9d18ee", // #52 Inter Turku
  "b598561a-abe0-41c3-aeaa-5f1bd7c90d52", // #53 Hradec
];

/** Hoje — manter ativos + refazer entradas canceladas */
const IDS_HOJE = [
  "d13d4386-ec7f-4c9c-ace7-5cf3d59388bd", // #54 Argeș
  "4952ce60-2cc1-4b5c-8901-a5d7355285f6", // #55 Wisla
  "04f1bf4d-fd27-475f-89ad-16b707f91ce4", // #56 Oddevold
  "31e1144b-ca41-481c-93eb-4a49ea088cf8", // #57 LASK
  "2b6e8331-2040-47ba-9162-be2ca47dccf3", // #58 CSKA 1948
  "8d66c73f-5c6e-4e52-8b37-6f2e16b4b472", // #59 Briton Ferry
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
  "/opt/arbishield/scripts/.env",
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

function money(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
function n(v) {
  return Number(v || 0);
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
    if (okNull) return null;
    throw new Error(`${res.status} ${p}: ${String(text).slice(0, 320)}`);
  }
  return data;
}

async function getDesafio(id) {
  const rows = await sb(
    `/rest/v1/desafios?select=id,number,title,status,is_active,deleted_at,metadata&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function getProfileName(userId) {
  const rows = await sb(
    `/rest/v1/profiles?select=id,full_name,desafio_balance_cents&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { okNull: true }
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function softDeleteOntem(nowIso) {
  console.log("\n══ 1) Remover desafios de ONTEM (#50–#53) ══");
  const out = [];
  for (const id of IDS_ONTEM) {
    const d = await getDesafio(id);
    if (!d) {
      console.log(`  skip ${id} (não encontrado)`);
      continue;
    }
    console.log(
      `  #${d.number} ${d.title || "—"}  status=${d.status} active=${d.is_active} deleted=${!!d.deleted_at}`
    );

    // Se houver entradas pendentes (alguém entrou após restore), estorna
    const pending = await sb(
      `/rest/v1/desafio_participations?desafio_id=eq.${encodeURIComponent(id)}&or=(result.eq.pending,result.is.null)&select=id,user_id,amount_cents,step_id,result&limit=500`
    ).catch(() => []);
    const pendList = Array.isArray(pending) ? pending : [];
    for (const p of pendList) {
      const amount = Math.max(0, n(p.amount_cents));
      const uid = String(p.user_id || "");
      console.log(
        `    · entrada pendente ${p.id.slice(0, 8)}… ${money(amount)} → estornar`
      );
      if (FIX && uid && amount > 0) {
        const prof = await getProfileName(uid);
        const bal = n(prof?.desafio_balance_cents);
        await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}`, {
          method: "PATCH",
          body: {
            desafio_balance_cents: bal + amount,
            updated_at: nowIso,
          },
        });
        await sb(`/rest/v1/desafio_participations?id=eq.${encodeURIComponent(p.id)}`, {
          method: "PATCH",
          body: {
            result: "cancelled",
            profit_cents: 0,
            updated_at: nowIso,
          },
        });
        await sb("/rest/v1/wallet_transactions", {
          method: "POST",
          body: {
            user_id: uid,
            type: "desafio_cancel_refund",
            amount_cents: amount,
            metadata: {
              desafio_id: id,
              participation_id: p.id,
              reason: "remover_desafio_ontem_restaurado_por_engano",
              source: "vps-restaurar-desafios-hoje-e-entradas",
            },
          },
        }).catch(() => null);
      }
    }

    if (FIX) {
      const meta = d.metadata && typeof d.metadata === "object" ? d.metadata : {};
      await sb(`/rest/v1/desafios?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: {
          deleted_at: nowIso,
          is_active: false,
          status: "deleted",
          updated_at: nowIso,
          metadata: {
            ...meta,
            removed_again_at: nowIso,
            removed_reason: "ontem_nao_deve_voltar_so_hoje",
            protect_from_casual_delete: false,
          },
        },
      });
      const steps = await sb(
        `/rest/v1/desafio_steps?desafio_id=eq.${encodeURIComponent(id)}&select=id,status`
      ).catch(() => []);
      for (const s of Array.isArray(steps) ? steps : []) {
        await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(s.id)}`, {
          method: "PATCH",
          body: {
            status: "cancelled",
            result: "cancelled",
            updated_at: nowIso,
          },
        }).catch(() => null);
      }
      console.log("    → soft-delete OK");
    } else {
      console.log("    → (simulação) soft-delete");
    }
    out.push({ id, number: d.number, title: d.title, pending_refunded: pendList.length });
  }
  return out;
}

async function reativarHoje(nowIso, newStarts) {
  console.log("\n══ 2) Reativar só HOJE (#54–#59) ══");
  const out = [];
  for (const id of IDS_HOJE) {
    const d = await getDesafio(id);
    if (!d) {
      console.log(`  skip ${id}`);
      continue;
    }
    console.log(`  #${d.number} ${d.title || "—"}`);
    if (FIX) {
      const meta = d.metadata && typeof d.metadata === "object" ? d.metadata : {};
      await sb(`/rest/v1/desafios?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: {
          deleted_at: null,
          status: "active",
          is_active: true,
          published_at: nowIso,
          updated_at: nowIso,
          metadata: {
            ...meta,
            restored_at: nowIso,
            restored_via: "vps-restaurar-desafios-hoje-e-entradas",
            protect_from_casual_delete: true,
          },
        },
      });
      const steps = await sb(
        `/rest/v1/desafio_steps?desafio_id=eq.${encodeURIComponent(id)}&select=id,match_label,used_liquidity_cents,status,starts_at`
      );
      for (const s of Array.isArray(steps) ? steps : []) {
        await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(s.id)}`, {
          method: "PATCH",
          body: {
            deleted_at: null,
            settled_at: null,
            result: null,
            status: "pending",
            starts_at: newStarts,
            updated_at: nowIso,
          },
        });
        console.log(`    step ${s.match_label || s.id} → ${newStarts}`);
      }
      console.log("    → ativo/protegido OK");
    } else {
      console.log("    → (simulação) reativar + starts_at futuro");
    }
    out.push({ id, number: d.number, title: d.title });
  }
  return out;
}

async function refazerEntradasCanceladas(nowIso) {
  console.log("\n══ 3) Refazer entradas canceladas (só #54–#59) ══");
  const ids = IDS_HOJE.join(",");
  const parts = await sb(
    `/rest/v1/desafio_participations?desafio_id=in.(${ids})&result=eq.cancelled&select=id,user_id,desafio_id,step_id,amount_cents,side,result,created_at,updated_at&order=created_at.asc&limit=5000`
  );
  const list = Array.isArray(parts) ? parts : [];
  console.log(`  encontradas ${list.length} entrada(s) cancelada(s)`);

  // nomes desafios
  const dzMap = new Map();
  for (const id of IDS_HOJE) {
    const d = await getDesafio(id);
    if (d) dzMap.set(id, d);
  }

  const results = [];
  let ok = 0;
  let skipped = 0;
  let totalDebit = 0;

  for (const p of list) {
    const amount = Math.max(0, n(p.amount_cents));
    const uid = String(p.user_id || "");
    const did = String(p.desafio_id || "");
    const dz = dzMap.get(did);
    const prof = uid ? await getProfileName(uid) : null;
    const bal = n(prof?.desafio_balance_cents);
    const name = prof?.full_name || uid.slice(0, 8) || "?";
    const label = dz
      ? `#${dz.number} ${dz.title || ""}`
      : did.slice(0, 8);

    if (!(amount > 0) || !uid) {
      console.log(`  skip ${p.id} valor/usuário inválido`);
      skipped += 1;
      continue;
    }

    let take = amount;
    if (bal < amount) {
      if (!FORCE_DEBIT) {
        console.log(
          `  ⚠ ${name} em ${label}: precisa ${money(amount)} mas Desafio=${money(bal)} → PULA (FORCE_DEBIT=1 para forçar)`
        );
        results.push({
          participation_id: p.id,
          name,
          desafio: label,
          amount_cents: amount,
          status: "skipped_insufficient",
          before: bal,
          after: bal,
        });
        skipped += 1;
        continue;
      }
      take = bal; // zera
      console.log(
        `  ⚠ ${name}: saldo insuficiente — FORCE debita ${money(take)} de ${money(amount)}`
      );
    }

    const after = bal - take;
    console.log(
      `  ▶ ${name} · ${label} · ${money(amount)} · Desafio ${money(bal)} → ${money(after)}`
    );

    if (FIX) {
      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}`, {
        method: "PATCH",
        body: {
          desafio_balance_cents: after,
          updated_at: nowIso,
        },
      });
      await sb(`/rest/v1/desafio_participations?id=eq.${encodeURIComponent(p.id)}`, {
        method: "PATCH",
        body: {
          result: "pending",
          profit_cents: 0,
          updated_at: nowIso,
        },
      });
      if (p.step_id && take > 0) {
        const stepRows = await sb(
          `/rest/v1/desafio_steps?select=id,used_liquidity_cents&id=eq.${encodeURIComponent(p.step_id)}&limit=1`,
          { okNull: true }
        );
        const step = Array.isArray(stepRows) ? stepRows[0] : null;
        if (step) {
          await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(step.id)}`, {
            method: "PATCH",
            body: {
              used_liquidity_cents: n(step.used_liquidity_cents) + take,
              updated_at: nowIso,
            },
          }).catch(() => null);
        }
      }
      await sb("/rest/v1/wallet_transactions", {
        method: "POST",
        body: {
          user_id: uid,
          type: "desafio_reregister",
          amount_cents: -take,
          metadata: {
            desafio_id: did,
            participation_id: p.id,
            step_id: p.step_id || null,
            requested_cents: amount,
            applied_cents: take,
            reason: "refazer_entrada_cancelada_desafios_hoje",
            source: "vps-restaurar-desafios-hoje-e-entradas",
            desafio_before_cents: bal,
            desafio_after_cents: after,
          },
        },
      }).catch(() => null);
    }

    results.push({
      participation_id: p.id,
      name,
      email_hint: null,
      desafio: label,
      amount_cents: amount,
      applied_cents: take,
      status: FIX ? "restored" : "would_restore",
      before: bal,
      after,
    });
    ok += 1;
    totalDebit += take;
  }

  console.log("\n── Resumo entradas ──");
  for (const r of results) {
    console.log(
      `  ${String(r.status).padEnd(22)} ${String(r.name).padEnd(28).slice(0, 28)} ${String(r.desafio).padEnd(28).slice(0, 28)} ${money(r.amount_cents)}`
    );
  }
  console.log(
    `\n  OK/planejadas: ${ok} · puladas: ${skipped} · total debitado: ${money(totalDebit)}`
  );
  return { results, ok, skipped, totalDebit };
}

async function main() {
  const now = new Date();
  const nowIso = now.toISOString();
  const newStarts = new Date(now.getTime() + SHIFT_MINUTES * 60 * 1000).toISOString();

  console.log("═".repeat(72));
  console.log("RESTAURAR só HOJE + refazer entradas canceladas");
  console.log("FIX:", FIX ? "SIM" : "não (simulação)");
  console.log("FORCE_DEBIT:", FORCE_DEBIT ? "SIM" : "não");
  console.log("SHIFT_MINUTES:", SHIFT_MINUTES, "→ starts_at", newStarts);
  console.log("═".repeat(72));

  await softDeleteOntem(nowIso);
  await reativarHoje(nowIso, newStarts);
  await refazerEntradasCanceladas(nowIso);

  console.log("\n═".repeat(1) + "═".repeat(71));
  if (!FIX) {
    console.log("Simulação OK. Para aplicar:");
    console.log(
      "  FIX=1 node /opt/arbishield/scripts/vps-restaurar-desafios-hoje-e-entradas.mjs"
    );
  } else {
    console.log("OK aplicado.");
    console.log("Hard refresh: /admin-desafios.html e /app-desafio.html");
  }
}

main().catch((e) => {
  console.error("ERRO:", e instanceof Error ? e.message : e);
  process.exit(1);
});
