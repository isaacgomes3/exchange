#!/usr/bin/env node
/**
 * Diagnóstico: por que partidas não aparecem em Proteger Aposta.
 * Repara as recentes para ficarem VISÍVEIS (pub + release 0 + liq).
 */
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
    let val = line.slice(i + 1).trim().replace(/\r$/, "");
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
  "/opt/arbishield/deploy/vps-supabase/.env",
  "/opt/arbishield/.env",
  path.resolve("deploy/vps-supabase/.env"),
].filter(Boolean)) {
  loadEnvFile(f);
}

const KEY =
  process.env.ARBISHIELD_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const URL = (
  process.env.ARBISHIELD_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.API_EXTERNAL_URL ||
  "http://127.0.0.1:8000"
).replace(/\/$/, "");
const ANON =
  process.env.ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.ARBISHIELD_ANON_KEY ||
  "";

if (!KEY) {
  console.error("ERRO: SERVICE_ROLE_KEY ausente");
  process.exit(1);
}

const LIVE_MS = 9000 * 1000;

async function sb(p, { method = "GET", body, key = KEY } = {}) {
  const res = await fetch(`${URL}${p}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
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
  if (!res.ok) throw new Error(`${res.status} ${method} ${p}: ${String(text).slice(0, 350)}`);
  return data;
}

function reasonsOf(m, now = Date.now()) {
  const reasons = [];
  if (m.is_published !== true) reasons.push("NÃO PUBLICADO (is_published≠true)");
  if (m.deleted_at) reasons.push("deleted_at preenchido");
  const meta = m.metadata && typeof m.metadata === "object" ? m.metadata : {};
  const rel = Number(meta.release_minutes_before ?? 0) || 0;
  const start = new Date(m.starts_at).getTime();
  if (!Number.isFinite(start)) reasons.push("starts_at inválido");
  else {
    if (rel > 0 && now < start - rel * 60000) {
      reasons.push(`trava ${rel} min — libera só em ${new Date(start - rel * 60000).toLocaleString("pt-BR")}`);
    }
    if (start + LIVE_MS <= now) reasons.push("fora da janela (+2h30 pós-kickoff)");
  }
  const st = String(m.status_v2 || m.status || "open").toLowerCase();
  if (["finished", "closed", "cancelled", "settled", "finalizado", "void"].includes(st)) {
    reasons.push(`status=${st}`);
  }
  const max = Number(m.max_protection_cents || 0);
  const used = Number(m.used_protection_cents || 0);
  if (!(max > 0 && used < max)) reasons.push(`sem liquidez max=${max} used=${used}`);
  const mks = Array.isArray(m.markets) ? m.markets : [];
  if (!mks.length) reasons.push("markets vazio");
  return { ok: reasons.length === 0, reasons, rel, max, used, meta };
}

async function main() {
  console.log("==> Supabase", URL);
  let rows;
  try {
    rows = await sb(
      "/rest/v1/matches?select=id,home_team,away_team,league,starts_at,status,status_v2,is_published,deleted_at,markets,max_protection_cents,used_protection_cents,metadata&order=starts_at.desc&limit=40"
    );
  } catch (e) {
    console.warn("aviso query:", e.message || e);
    rows = await sb(
      "/rest/v1/matches?select=id,home_team,away_team,league,starts_at,status,status_v2,is_published,deleted_at,markets,max_protection_cents,used_protection_cents,metadata&limit=40"
    );
  }
  const list = Array.isArray(rows) ? rows : [];
  console.log("==> Últimas", list.length, "partidas (service_role)\n");

  let anyVisible = false;
  for (const m of list) {
    const v = reasonsOf(m);
    anyVisible = anyVisible || v.ok;
    console.log(
      (v.ok ? "✓ VISÍVEL " : "✗ OCULTA  ") +
        (m.home_team || "?") +
        " × " +
        (m.away_team || "?")
    );
    console.log("  id:", m.id);
    console.log(
      "  pub:",
      m.is_published,
      "| rel:",
      v.rel,
      "| liq:",
      v.max - v.used,
      "| starts:",
      m.starts_at
    );
    console.log(
      "  source:",
      v.meta.source || "(sem)",
      "| league:",
      m.league || "—"
    );
    if (!v.ok) console.log("  motivos:", v.reasons.join(" · "));
    console.log("");
  }

  if (ANON) {
    console.log("==> O que o CLIENTE (anon) consegue ler de publicados:");
    try {
      const pub = await sb(
        "/rest/v1/matches?select=id,home_team,away_team,is_published,starts_at,max_protection_cents&is_published=eq.true&deleted_at=is.null&order=starts_at.asc&limit=20",
        { key: ANON }
      );
      const pubs = Array.isArray(pub) ? pub : [];
      console.log("  anon viu", pubs.length, "publicados (ASC limit 20 — legado perigoso)");
      for (const m of pubs.slice(0, 8)) {
        console.log("   -", m.home_team, "×", m.away_team, m.id);
      }
      if (!pubs.length) {
        console.log(
          "  ⚠ anon não lê matches — RLS pode estar bloqueando a grade do Proteger"
        );
      }
      const windowStart = new Date(Date.now() - LIVE_MS).toISOString();
      const win = await sb(
        `/rest/v1/matches?select=id,home_team,away_team,is_published,starts_at,max_protection_cents,used_protection_cents&is_published=eq.true&deleted_at=is.null&starts_at=gte.${encodeURIComponent(windowStart)}&order=starts_at.asc&limit=50`,
        { key: ANON }
      );
      const wins = Array.isArray(win) ? win : [];
      console.log(
        "  anon na JANELA (+2h30):",
        wins.length,
        "publicados com starts_at >=",
        windowStart
      );
      for (const m of wins.slice(0, 10)) {
        const v = reasonsOf(m);
        console.log(
          (v.ok ? "   ✓ " : "   ✗ ") +
            (m.home_team || "?") +
            " × " +
            (m.away_team || "?") +
            (v.ok ? "" : " · " + v.reasons.join(" · "))
        );
      }
      const pubCount = await sb(
        "/rest/v1/matches?select=id&is_published=eq.true&deleted_at=is.null",
        { key: KEY }
      );
      const nPub = Array.isArray(pubCount) ? pubCount.length : 0;
      if (nPub > 150) {
        console.log(
          `  ⚠ ${nPub} publicados no total — bug antigo ASC+limit(150) omitia jogos atuais`
        );
      }
    } catch (e) {
      console.log("  ⚠ leitura anon falhou:", e.message || e);
    }
  } else {
    console.log("==> ANON_KEY ausente — pulando teste RLS cliente");
  }

  console.log("\n==> Reparar últimas 10 para VISÍVEL agora");
  let fixed = 0;
  for (const m of list.slice(0, 10)) {
    const v = reasonsOf(m);
    const meta = {
      ...(v.meta || {}),
      source: v.meta.source || "admin_manual",
      release_minutes_before: 0,
      force_visible_at: new Date().toISOString(),
    };
    let markets = Array.isArray(m.markets) ? m.markets : [];
    let max = Number(m.max_protection_cents || 0);
    if (max <= 0 && markets.length) {
      max = markets.reduce((s, x) => s + Number(x.liquidity || 0), 0);
    }
    if (max <= 0) {
      max = 500_000;
      markets = [
        {
          id: randomUUID(),
          name: "Back · Liberado",
          odd: 1.1,
          liquidity: max,
          used_liquidity: 0,
          market_type: "BACK",
        },
        {
          id: randomUUID(),
          name: "Lay · Liberado",
          odd: 1.1,
          liquidity: max,
          used_liquidity: 0,
          market_type: "LAY",
        },
      ];
    }
    const body = {
      is_published: true,
      status: "open",
      status_v2: "open",
      max_protection_cents: max,
      used_protection_cents: 0,
      markets,
      metadata: meta,
      starts_at:
        // se já passou da janela, empurra kickoff +90min
        (() => {
          const start = new Date(m.starts_at).getTime();
          if (!Number.isFinite(start) || start + LIVE_MS <= Date.now()) {
            return new Date(Date.now() + 90 * 60_000).toISOString();
          }
          return m.starts_at;
        })(),
    };
    try {
      await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(m.id)}`, {
        method: "PATCH",
        body: { ...body, deleted_at: null },
      });
    } catch {
      await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(m.id)}`, {
        method: "PATCH",
        body,
      });
    }
    fixed += 1;
    console.log("  OK", m.id, m.home_team, "×", m.away_team);
  }

  console.log("\nReparadas:", fixed);
  console.log("Abrir PRODUÇÃO: https://arbishield.app/app-proteger.html");
  console.log("Ctrl+Shift+R · filtro Todos · se MODO ADM estiver on, pode desligar e testar");
  if (!anyVisible) {
    console.log(
      "Antes do reparo NENHUMA estava visível — por isso a grade estava zerada."
    );
  }
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
