#!/usr/bin/env node
/**
 * Inicia o painel local (Windows/Mac/Linux)
 * Uso: npm run start:local
 */

import { spawn } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
}

console.log("\n  Exchange Live — Ambiente Local");
console.log("  ==============================\n");

if (!existsSync(join(root, "node_modules"))) {
  console.log("  Instalando dependências...\n");
  await run("npm", ["install"]);
}

if (!existsSync(join(root, ".env.local"))) {
  copyFileSync(join(root, ".env.example"), join(root, ".env.local"));
  console.log("  ✓ .env.local criado\n");
}

console.log("  Painel: http://localhost:3000");
console.log("  Debug:  http://localhost:3000/api/exchange/debug");
console.log("  Ctrl+C para parar\n");

await run("npm", ["run", "dev"]);
