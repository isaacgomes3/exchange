/**
 * Anti-regressão: só FLUXO_PROTECAO_V1 pode existir nos artefatos vivos.
 * Proíbe fee_upfront / lock_fee_after / settle paralelo / hotfixes com corpo antigo.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = join(ROOT, "scripts");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

const FORBIDDEN_IN_RUNTIME = [
  "fee_upfront",
  "lock_fee_after",
  "settle-arbishield-saldo-real-v1",
  "Liquidação em reconstrução",
  "protection-flow-contract",
];

const RUNTIME_FILES = [
  "scripts/arbishield-prelive-events.mjs",
  "scripts/arbishield-serverfn-shim.mjs",
  "scripts/lib/protection-flow-scaffold.mjs",
  "src/lib/arbishield/create-protection.ts",
  "deploy/vps-supabase/static/v2/admin-jogos.html",
  "deploy/vps-supabase/static/v2/app-proteger.html",
];

const OBSOLETE_HOTFIXES = [
  "vps-hotfix-settle-credito-carteira.sh",
  "vps-hotfix-settle-arbishield-saldo-real.sh",
  "vps-hotfix-consolidado-proteger-settle.sh",
  "vps-hotfix-encerrar-protecoes-primeiro.sh",
  "vps-hotfix-encerrar-odd-invalida.sh",
  "vps-hotfix-jogos-liquidar.sh",
  "vps-hotfix-salvar-protecao.sh",
  "vps-hotfix-proteger-sem-liquidez.sh",
  "vps-hotfix-ver-jogos-sem-saldo.sh",
  "vps-hotfix-fix-partidas-sumiram.sh",
  "vps-hotfix-saldo-protecao-refresh.sh",
  "vps-hotfix-proteger-so-com-liquidez.sh",
  "vps-hotfix-tirar-jogo-fila.sh",
  "vps-hotfix-sem-saldo-reutilizavel.sh",
  "vps-hotfix-saldo-f5-overcredit.sh",
  "vps-hotfix-saldo-seguro-global.sh",
  "vps-deploy-protections.sh",
];

test("runtime só FLUXO_PROTECAO_V1", () => {
  for (const rel of RUNTIME_FILES) {
    const text = read(rel);
    if (
      rel.includes("prelive") ||
      rel.includes("shim") ||
      rel.includes("scaffold") ||
      rel.includes("create-protection")
    ) {
      assert.match(
        text,
        /FLUXO_PROTECAO_V1|fluxo-protecao-v1/,
        `${rel} sem marker V1`
      );
    }
    for (const bad of FORBIDDEN_IN_RUNTIME) {
      // comentários anti-regressão no hotfix principal podem citar nomes
      if (rel.includes("vps-hotfix-protecao-do-zero")) continue;
      assert.equal(
        text.includes(bad),
        false,
        `${rel} contém modelo/proibido: ${bad}`
      );
    }
  }
});

test("scaffold: Reembolso = 100% e Exchange = stake−taxa", async () => {
  const mod = await import("./lib/protection-flow-scaffold.mjs");
  const row = { amount_cents: 100_000, platform_deduction_cents: 9_111 };
  assert.equal(mod.settlementCreditCents(row, "arbishield"), 100_000);
  assert.equal(mod.settlementCreditCents(row, "exchange"), 90_889);
  assert.equal(mod.settlementStatusForOutcome("arbishield"), "lost_exchange");
  assert.equal(mod.settlementStatusForOutcome("exchange"), "won_exchange");
  assert.equal(mod.PROTECTION_FLOW_VERSION, "fluxo-protecao-v1");
});

test("admin: REEMBOLSO / VENCEU EXCHANGE sem BATEU / Fila", () => {
  const html = read("deploy/vps-supabase/static/v2/admin-jogos.html");
  assert.match(html, /REEMBOLSO/);
  assert.match(html, /VENCEU EXCHANGE/i);
  assert.match(html, /data-outcome="arbishield"/);
  assert.match(html, /data-outcome="exchange"/);
  assert.equal(/BATEU ARBISHIELD/i.test(html), false);
  assert.equal(/Tirar da fila/i.test(html), false);
  assert.equal(/Fila \(atuais\)/i.test(html), false);
});

test("proteger: window.ArbiV2Shell (não Node global)", () => {
  const html = read("deploy/vps-supabase/static/v2/app-proteger.html");
  assert.equal(/\bglobal\.ArbiV2Shell/.test(html), false);
  assert.match(html, /window\.ArbiV2Shell|balances-changed/);
});

test("hotfixes paralelos são abort-only (sem curl de modelo antigo)", () => {
  for (const name of OBSOLETE_HOTFIXES) {
    const path = join(SCRIPTS, name);
    assert.equal(existsSync(path), true, `faltando ${name}`);
    const text = readFileSync(path, "utf8");
    assert.match(text, /exit 1/, `${name} deve abortar`);
    assert.match(text, /FLUXO_PROTECAO_V1|protecao-do-zero/, `${name} deve apontar V1`);
    assert.equal(
      /curl\s+-fsSL/.test(text),
      false,
      `${name} ainda baixa artefato (curl) — corpo antigo`
    );
    assert.ok(text.split("\n").length <= 20, `${name} ainda tem corpo longo`);
  }
});

test("contrato antigo não existe no repo", () => {
  assert.equal(
    existsSync(join(SCRIPTS, "lib/protection-flow-contract.mjs")),
    false
  );
});

test("diagnóstico é V1-only (falha em modelo paralelo)", () => {
  const diag = read("scripts/vps-diagnostico-logica-protecao.sh");
  assert.match(diag, /FLUXO_PROTECAO_V1/);
  assert.match(diag, /fee_upfront|lock_fee_after/);
  assert.match(diag, /FAIL/);
  assert.equal(/MODELO 2 — fee_upfront/.test(diag), false);
  assert.equal(/MODELO 3 — lock_fee_after/.test(diag), false);
});
