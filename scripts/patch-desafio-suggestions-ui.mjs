#!/usr/bin/env node
/**
 * Aplica o botão "Sugestão de Desafio" no bundle admin.desafios-*.js
 * Uso: node scripts/patch-desafio-suggestions-ui.mjs [caminho-do-bundle]
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function findBundle(explicit) {
  if (explicit) return resolve(explicit);
  const dirs = [
    resolve(root, "arbishield-local/assets"),
    "/var/www/arbishield/assets",
    "/opt/arbishield/arbishield-local/assets",
  ];
  for (const dir of dirs) {
    try {
      const hit = readdirSync(dir).find((f) =>
        /^admin\.desafios-.*\.js$/.test(f)
      );
      if (hit) return resolve(dir, hit);
    } catch {
      /* skip */
    }
  }
  throw new Error("Bundle admin.desafios-*.js não encontrado");
}

const path = findBundle(process.argv[2]);
let s = readFileSync(path, "utf8");

if (s.includes("Sugestão de Desafio")) {
  console.log("Já patchado:", path);
  process.exit(0);
}

const old =
  'e.jsxs(S,{onClick:()=>l(ua()),className:"rounded-xl bg-[#C9F223] text-black font-black uppercase tracking-widest text-[10px] hover:bg-[#C9F223]/90 shadow-[0_0_20px_rgba(201,242,35,0.2)]",children:[e.jsx(Ke,{className:"mr-2 h-4 w-4"})," Lançar Desafio"]})';
if (!s.includes(old)) {
  console.error("Snippet do botão Lançar Desafio não encontrado em", path);
  process.exit(1);
}

const wrapped =
  'e.jsxs("div",{className:"flex flex-wrap gap-2 justify-end",children:[' +
  'e.jsx("a",{href:"/desafio-sugestoes.html",className:"inline-flex items-center rounded-xl border border-[#C9F223]/40 text-[#C9F223] font-black uppercase tracking-widest text-[10px] px-4 py-2 hover:bg-[#C9F223]/10",children:"Sugestão de Desafio"}),' +
  'e.jsxs(S,{onClick:()=>l((window.__arbishieldApplySuggestion&&window.__arbishieldApplySuggestion())||ua()),className:"rounded-xl bg-[#C9F223] text-black font-black uppercase tracking-widest text-[10px] hover:bg-[#C9F223]/90 shadow-[0_0_20px_rgba(201,242,35,0.2)]",children:[e.jsx(Ke,{className:"mr-2 h-4 w-4"})," Lançar Desafio"]})' +
  "]})";

s = s.replace(old, wrapped);

const marker =
  'ua=()=>({number:1,title:"DESAFIO #001",subtitle:"Complete os desafios seguidos e fature todo o saldo final com lucro!",total_steps:1,initial_balance_cents:"10000",is_active:!1,steps:[Ce(1)]});';
if (!s.includes(marker)) {
  console.error("Marker ua() não encontrado");
  process.exit(1);
}

const bootstrap =
  marker +
  'try{const __qs=new URLSearchParams(location.search);' +
  'const __raw=localStorage.getItem("arbishield_desafio_suggestion");' +
  'if(__qs.get("sugestao")==="1"&&__raw){' +
  "const __d=JSON.parse(__raw);" +
  "const __st=(__d.steps&&__d.steps[0])||{};" +
  "window.__arbishieldApplySuggestion=()=>({" +
  "number:__d.number||1," +
  'title:__d.title||"DESAFIO #001",' +
  'subtitle:__d.subtitle||"",' +
  "total_steps:1," +
  'initial_balance_cents:String(__d.initial_balance_cents??"10000"),' +
  "is_active:!1," +
  "target_profit_pct:__d.target_profit_pct," +
  "steps:[{...Ce(1)," +
  'match_label:__st.match_label||"",' +
  'home_team:__st.home_team||"",' +
  'away_team:__st.away_team||"",' +
  'market_name:__st.market_name||"",' +
  'market_name_casa:__st.market_name_casa||"",' +
  'market_name_arbishield:__st.market_name_arbishield||"",' +
  'casa_odd:String(__st.casa_odd??""),' +
  'arbi_odd:String(__st.arbi_odd??""),' +
  'casa_stake_cents:String(__st.casa_stake_cents??""),' +
  'liquidity_cents:String(__st.liquidity_cents??""),' +
  'display_liquidity_cents:String(__st.display_liquidity_cents??__st.liquidity_cents??""),' +
  'external_bet_link:__st.external_bet_link||"",' +
  'starts_at:__st.starts_at||"",' +
  "release_minutes_before:__st.release_minutes_before??30," +
  'casa_commission_pct:String(__st.casa_commission_pct??"4.5")' +
  "}]});" +
  'localStorage.removeItem("arbishield_desafio_suggestion");' +
  "}}catch{}";

s = s.replace(marker, bootstrap);
writeFileSync(path, s);
console.log("Patch aplicado:", path);
