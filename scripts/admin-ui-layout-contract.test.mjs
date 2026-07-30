/**
 * Anti-reversão — accordion do menu admin + cards do Monitor de Desafios.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ADMIN_UI_LAYOUT_CONTRACT_VERSION,
  ADMIN_UI_LAYOUT_LOCK,
  ADMIN_NAV_ACCORDION,
  ADMIN_MONITOR_DESAFIOS_CARDS,
  ADMIN_UI_LAYOUT_SPEC,
} from "./lib/admin-ui-layout-contract.mjs";
import { parseHtmlMeta } from "./lib/ui-markers-contract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function assertIncludes(text, needles, label) {
  for (const n of needles) {
    assert.ok(text.includes(n), `${label} sem "${n.slice(0, 90)}"`);
  }
}

function assertExcludes(text, needles, label) {
  for (const n of needles) {
    assert.ok(!text.includes(n), `${label} NÃO pode ter "${n}"`);
  }
}

describe("admin UI layout — accordion + monitor desafios cards", () => {
  it("versão e lock", () => {
    assert.equal(ADMIN_UI_LAYOUT_CONTRACT_VERSION, "admin-ui-layout-contract-v1");
    assert.equal(
      ADMIN_UI_LAYOUT_LOCK,
      "DO_NOT_CHANGE_ADMIN_UI_LAYOUT_WITHOUT_EXPLICIT_REQUEST"
    );
    assert.equal(ADMIN_UI_LAYOUT_SPEC.version, ADMIN_UI_LAYOUT_CONTRACT_VERSION);
  });

  it("AGENTS.md e SYSTEM_NON_REGRESSION citam layout admin", () => {
    const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8");
    const doc = readFileSync(
      resolve(root, "docs/SYSTEM_NON_REGRESSION.md"),
      "utf8"
    );
    assert.match(agents, /admin-ui-layout-contract-v1|accordion|Monitor de Desafios/);
    assert.match(agents, /DO_NOT_CHANGE_ADMIN_UI_LAYOUT_WITHOUT_EXPLICIT_REQUEST/);
    assert.match(doc, /admin-ui-layout-contract-v1|accordion|desafio-monitor-card-layout-v1/);
  });

  it("shell + CSS: menu admin accordion", () => {
    const shell = readFileSync(resolve(root, ADMIN_NAV_ACCORDION.shell), "utf8");
    const css = readFileSync(resolve(root, ADMIN_NAV_ACCORDION.css), "utf8");
    assertIncludes(shell, ADMIN_NAV_ACCORDION.mustIncludeShell, "v2-shell accordion");
    assertIncludes(css, ADMIN_NAV_ACCORDION.mustIncludeCss, "v2.css accordion");
    assert.ok(
      existsSync(resolve(root, ADMIN_NAV_ACCORDION.hotfix)),
      "hotfix accordion ausente"
    );
    // accordion só no shell admin — não no app
    assert.match(shell, /accordion:\s*shell\s*===\s*["']admin["']/);
    assert.match(shell, /bindAdminNavAccordion\(sidebar\)/);
  });

  it("Monitor de Desafios: cards 3 zonas + settle", () => {
    const html = readFileSync(
      resolve(root, ADMIN_MONITOR_DESAFIOS_CARDS.page),
      "utf8"
    );
    assert.equal(
      parseHtmlMeta(html, "arbishield-build"),
      ADMIN_MONITOR_DESAFIOS_CARDS.build
    );
    assertIncludes(html, ADMIN_MONITOR_DESAFIOS_CARDS.mustInclude, "monitor desafios");
    assertExcludes(
      html,
      ADMIN_MONITOR_DESAFIOS_CARDS.mustNotInclude,
      "monitor desafios"
    );
    assert.ok(
      existsSync(resolve(root, ADMIN_MONITOR_DESAFIOS_CARDS.hotfix)),
      "hotfix monitor desafios ausente"
    );
  });
});
