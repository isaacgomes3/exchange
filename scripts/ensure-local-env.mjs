#!/usr/bin/env node
/**
 * Garante .env.local para desenvolvimento local sem apagar keys existentes.
 * - Copia defaults de .env.example
 * - Ativa proxy BetBra local (IP da máquina)
 * - Preserva SUPABASE_* já configuradas
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.local");
const examplePath = join(root, ".env.example");

const LOCAL_PROXY_DEFAULTS = {
  MEXCHANGE_USE_LOCAL_PROXY: "1",
  MEXCHANGE_LOCAL_PROXY_URL: "http://127.0.0.1:8787",
  BETBRA_PROXY_PORT: "8787",
};

function parseEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

function serializeEnv(vars, headerLines) {
  const lines = [...headerLines];
  for (const [key, value] of Object.entries(vars)) {
    lines.push(`${key}=${value}`);
  }
  return `${lines.join("\n")}\n`;
}

if (!existsSync(examplePath)) {
  console.error("✗ .env.example não encontrado");
  process.exit(1);
}

if (!existsSync(envPath)) {
  copyFileSync(examplePath, envPath);
  console.log("✓ .env.local criado a partir de .env.example");
}

const example = parseEnv(readFileSync(examplePath, "utf8"));
const current = parseEnv(readFileSync(envPath, "utf8"));
const merged = { ...example, ...current, ...LOCAL_PROXY_DEFAULTS };

// Não sobrescrever secrets já presentes
for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]) {
  if (current[key]) merged[key] = current[key];
}

const header = [
  "# Gerado/atualizado por scripts/ensure-local-env.mjs",
  "# Ambiente local — proxy BetBra + Supabase",
  "",
];

writeFileSync(envPath, serializeEnv(merged, header));
console.log("✓ .env.local pronto (proxy local ativo em 127.0.0.1:8787)");

if (
  !merged.NEXT_PUBLIC_SUPABASE_URL ||
  !merged.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  merged.NEXT_PUBLIC_SUPABASE_ANON_KEY.includes("xxx")
) {
  console.log(
    "⚠ Configure NEXT_PUBLIC_SUPABASE_ANON_KEY no .env.local para persistência"
  );
}
