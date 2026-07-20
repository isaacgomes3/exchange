#!/usr/bin/env node
/**
 * Garante script de injeção da UI de sugestões no index.html do frontend estático.
 * NÃO altera o bundle React (evita "Falha no Terminal").
 *
 * Uso:
 *   node scripts/patch-desafio-suggestions-ui.mjs [/var/www/arbishield]
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const www = resolve(process.argv[2] || "/var/www/arbishield");
const srcInject = resolve(
  root,
  "deploy/vps-supabase/static/desafio-sugestoes-inject.js"
);
const srcHtml = resolve(
  root,
  "deploy/vps-supabase/static/desafio-sugestoes.html"
);

if (!existsSync(www)) {
  console.error("Frontend path não encontrado:", www);
  process.exit(1);
}

mkdirSync(resolve(www, "assets"), { recursive: true });
copyFileSync(srcInject, resolve(www, "assets/desafio-sugestoes-inject.js"));
copyFileSync(srcHtml, resolve(www, "desafio-sugestoes.html"));

const version = Date.now().toString(36);
const indexPath = resolve(www, "index.html");
let html = readFileSync(indexPath, "utf8");
const tag = `<script src="/assets/desafio-sugestoes-inject.js?v=${version}" defer></script>`;

if (/desafio-sugestoes-inject\.js/.test(html)) {
  // Atualiza query de cache-bust se o script já existir
  html = html.replace(
    /<script[^>]*desafio-sugestoes-inject\.js[^>]*><\/script>/,
    tag
  );
  writeFileSync(indexPath, html);
  console.log("Script atualizado (cache-bust) em", indexPath);
} else {
  if (!html.includes("</body>")) {
    console.error("index.html sem </body>");
    process.exit(1);
  }
  html = html.replace("</body>", `${tag}\n</body>`);
  writeFileSync(indexPath, html);
  console.log("Script injetado em", indexPath);
}
console.log("OK:", www, "v=" + version);
