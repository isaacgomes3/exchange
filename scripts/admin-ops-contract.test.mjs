/**
 * Anti-regressão Admin — lançar saldo (depósitos) + lançar jogos.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ADMIN_OPS_CONTRACT_VERSION,
  ADMIN_OPS_LOCK,
  ADMIN_LANCAR_SALDO,
  ADMIN_LANCAR_JOGOS,
  ADMIN_OPS_SPEC,
} from "./lib/admin-ops-contract.mjs";
import { parseHtmlMeta } from "./lib/ui-markers-contract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function assertIncludes(text, needles, label) {
  for (const n of needles) {
    assert.ok(
      text.includes(n),
      `${label} sem "${n.slice(0, 80)}"`
    );
  }
}

describe("admin ops — lançar saldo + lançar jogos", () => {
  it("versão e lock", () => {
    assert.equal(ADMIN_OPS_CONTRACT_VERSION, "admin-ops-contract-v1");
    assert.equal(
      ADMIN_OPS_LOCK,
      "DO_NOT_CHANGE_ADMIN_OPS_WITHOUT_EXPLICIT_REQUEST"
    );
    assert.equal(ADMIN_OPS_SPEC.version, ADMIN_OPS_CONTRACT_VERSION);
  });

  it("AGENTS.md e SYSTEM_NON_REGRESSION citam admin ops", () => {
    const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8");
    const doc = readFileSync(
      resolve(root, "docs/SYSTEM_NON_REGRESSION.md"),
      "utf8"
    );
    assert.match(agents, /admin-ops-contract-v1|Lançar saldo|Depósitos manuais/);
    assert.match(agents, /Lançar jogos|admin-jogos/);
    assert.match(doc, /admin-ops-contract-v1|Lançar saldo/);
    assert.match(doc, /Lançar jogos|admin-jogos/);
    assert.match(agents, /DO_NOT_CHANGE_ADMIN_OPS_WITHOUT_EXPLICIT_REQUEST/);
  });

  it("UI + shim: creditar saldo (depósitos manuais)", () => {
    const html = readFileSync(resolve(root, ADMIN_LANCAR_SALDO.page), "utf8");
    const shim = readFileSync(
      resolve(root, "scripts/arbishield-serverfn-shim.mjs"),
      "utf8"
    );
    const shell = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/v2-shell.js"),
      "utf8"
    );
    assert.equal(
      parseHtmlMeta(html, "arbishield-build"),
      ADMIN_LANCAR_SALDO.build
    );
    assertIncludes(html, ADMIN_LANCAR_SALDO.uiMustInclude, "admin-manual-deposits");
    assertIncludes(shim, ADMIN_LANCAR_SALDO.shimMustInclude, "shim depósitos");
    assert.match(
      shell,
      new RegExp(
        `${ADMIN_LANCAR_SALDO.navId}.*${ADMIN_LANCAR_SALDO.navLabel}|${ADMIN_LANCAR_SALDO.navLabel}.*admin-manual-deposits`
      )
    );
    // Já creditado NÃO pode ser o mesmo fluxo que altera saldo
    assert.match(shim, /Já creditado \(sem alterar saldo\)/);
    assert.match(shim, /desafio_balance_cents/);
    assert.match(shim, /investor_balance_cents/);
  });

  it("UI + prelive: lançar jogos (BetBra + manual + publicar)", () => {
    const html = readFileSync(resolve(root, ADMIN_LANCAR_JOGOS.page), "utf8");
    const prelive = readFileSync(
      resolve(root, "scripts/arbishield-prelive-events.mjs"),
      "utf8"
    );
    const shell = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/v2-shell.js"),
      "utf8"
    );
    assert.equal(
      parseHtmlMeta(html, "arbishield-build"),
      ADMIN_LANCAR_JOGOS.build
    );
    assertIncludes(html, ADMIN_LANCAR_JOGOS.uiMustInclude, "admin-jogos");
    assertIncludes(prelive, ADMIN_LANCAR_JOGOS.preliveMustInclude, "prelive jogos");
    assert.match(shell, /admin-jogos\.html/);
    assert.match(shell, /"Jogos"/);
    // publicação imediata por defeito + agendar
    assert.match(html, /Publicar agora/);
    assert.match(html, /Agendar publicação/);
    assert.match(html, /admin-jogos-publish-imediato-agendar-v1/);
    assert.match(prelive, /publishDueScheduledMatches/);
    assert.match(prelive, /resolveMatchPublishState/);
  });
});
