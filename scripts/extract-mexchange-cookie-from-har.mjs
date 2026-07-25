#!/usr/bin/env node
/**
 * Extrai o header Cookie de pedidos mexchange-api a partir de um HAR do Chrome.
 *
 * Uso:
 *   node scripts/extract-mexchange-cookie-from-har.mjs ./betbra.har
 *   node scripts/extract-mexchange-cookie-from-har.mjs ./betbra.har --copy
 *
 * Como gerar o HAR:
 *   Chrome (logado na exchange) → F12 → Network → filtro mexchange-api →
 *   recarregue a página → botão direito na lista → "Save all as HAR with content"
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const harPath = args[0];

if (!harPath) {
  console.error(
    "Uso: node scripts/extract-mexchange-cookie-from-har.mjs <arquivo.har>"
  );
  process.exit(1);
}

function headerValue(headers, name) {
  const want = String(name).toLowerCase();
  for (const h of headers || []) {
    if (String(h.name || "").toLowerCase() === want) {
      return String(h.value || "").trim();
    }
  }
  return "";
}

function extractFromHar(har) {
  const entries = har?.log?.entries || [];
  const hits = [];
  for (const entry of entries) {
    const url = String(entry?.request?.url || "");
    if (!/mexchange-api\.betbra\.bet\.br/i.test(url)) continue;
    const cookie = headerValue(entry.request?.headers, "Cookie");
    if (!cookie) continue;
    hits.push({
      url,
      cookie,
      started: entry.startedDateTime || null,
      hasSession: /(?:^|;\s*)SESSION=/i.test(cookie),
    });
  }
  return hits;
}

const abs = resolve(harPath);
const har = JSON.parse(readFileSync(abs, "utf8"));
const hits = extractFromHar(har);

if (!hits.length) {
  console.error(
    "Nenhum Cookie de mexchange-api encontrado no HAR.\n" +
      "Gere o HAR com a exchange aberta e logada (filtro mexchange-api)."
  );
  process.exit(2);
}

// Prefere o que tem SESSION; senão o mais recente
hits.sort((a, b) => {
  if (a.hasSession !== b.hasSession) return a.hasSession ? -1 : 1;
  return String(b.started || "").localeCompare(String(a.started || ""));
});

const best = hits[0];
console.log("==> Cookie capturado");
console.log("    url:", best.url);
console.log("    SESSION:", best.hasSession ? "sim" : "não");
console.log("    total hits:", hits.length);
console.log("");
console.log(best.cookie);
console.log("");
console.log(
  "Cole em: https://botshield.arbishield.app/conta-betbra.html → Sessão do navegador"
);

const out = resolve("mexchange-cookie.txt");
writeFileSync(out, best.cookie + "\n", "utf8");
console.log("Também salvo em:", out);

if (flags.has("--copy")) {
  try {
    const { spawnSync } = await import("node:child_process");
    const clip =
      process.platform === "darwin"
        ? "pbcopy"
        : process.platform === "win32"
          ? "clip"
          : "xclip";
    if (clip === "xclip") {
      spawnSync("xclip", ["-selection", "clipboard"], {
        input: best.cookie,
        encoding: "utf8",
      });
    } else {
      spawnSync(clip, [], { input: best.cookie, encoding: "utf8" });
    }
    console.log("Copiado para a área de transferência.");
  } catch {
    console.log("(não foi possível copiar automaticamente)");
  }
}
