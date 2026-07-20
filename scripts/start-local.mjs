#!/usr/bin/env node
/**
 * Ambiente local completo: proxy BetBra (IP da máquina) + Next.js.
 * Uso: npm run start:local
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];

function runNode(script, args = [], opts = {}) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: root,
    stdio: opts.stdio ?? "inherit",
    env: { ...process.env, ...opts.env },
    shell: false,
  });
  children.push(child);
  return child;
}

function runNpm(args) {
  const child = spawn(isWin ? "npm.cmd" : "npm", args, {
    cwd: root,
    stdio: "inherit",
    shell: isWin,
  });
  children.push(child);
  return child;
}

function cleanup() {
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

console.log("\n  Exchange Live — Conexão Local");
console.log("  ==============================\n");

await new Promise((resolve, reject) => {
  const ensure = runNode(join(root, "scripts/ensure-local-env.mjs"));
  ensure.on("close", (code) =>
    code === 0 ? resolve() : reject(new Error(`ensure-local-env exit ${code}`))
  );
});

if (!existsSync(join(root, "node_modules"))) {
  console.log("  Instalando dependências...\n");
  await new Promise((resolve, reject) => {
    const install = runNpm(["install"]);
    install.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`npm install exit ${code}`))
    );
  });
}

console.log("  1) Proxy BetBra → http://127.0.0.1:8787");
console.log("  2) Painel       → http://localhost:3000");
console.log("  3) Supabase     → /api/supabase/health");
console.log("  Ctrl+C para parar\n");

runNode(join(root, "scripts/betbra-local-proxy.mjs"));

await new Promise((r) => setTimeout(r, 800));

const next = runNpm(["run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]);
next.on("close", (code) => {
  cleanup();
  process.exit(code ?? 0);
});
