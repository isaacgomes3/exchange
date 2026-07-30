/**
 * Anti-regressão — Modo usuário / Modo ADM + espelho de conta.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ADMIN_SESSION_MODE_CONTRACT_VERSION,
  ADMIN_SESSION_MODE_LOCK,
  ADMIN_MODE_SWITCH,
  ADMIN_ACCOUNT_MIRROR,
  ADMIN_SESSION_MODE_SPEC,
} from "./lib/admin-session-mode-contract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function assertIncludes(text, needles, label) {
  for (const n of needles) {
    assert.ok(text.includes(n), `${label} sem "${n.slice(0, 100)}"`);
  }
}

describe("admin session — modo usuário/ADM + espelho", () => {
  it("versão e lock", () => {
    assert.equal(
      ADMIN_SESSION_MODE_CONTRACT_VERSION,
      "admin-session-mode-contract-v1"
    );
    assert.equal(
      ADMIN_SESSION_MODE_LOCK,
      "DO_NOT_CHANGE_ADMIN_SESSION_MODE_WITHOUT_EXPLICIT_REQUEST"
    );
    assert.equal(
      ADMIN_SESSION_MODE_SPEC.version,
      ADMIN_SESSION_MODE_CONTRACT_VERSION
    );
  });

  it("AGENTS.md e SYSTEM_NON_REGRESSION citam modo + espelho", () => {
    const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8");
    const doc = readFileSync(
      resolve(root, "docs/SYSTEM_NON_REGRESSION.md"),
      "utf8"
    );
    assert.match(agents, /admin-session-mode-contract-v1|Modo usuário|Modo ADM/);
    assert.match(agents, /espelho|impersonat|DO_NOT_CHANGE_ADMIN_SESSION_MODE/);
    assert.match(doc, /admin-session-mode-contract-v1|Modo usuário|Espelho/);
  });

  it("shell + CSS: Modo usuário e Modo ADM", () => {
    const shell = readFileSync(resolve(root, ADMIN_MODE_SWITCH.shell), "utf8");
    const css = readFileSync(resolve(root, ADMIN_MODE_SWITCH.css), "utf8");
    assertIncludes(shell, ADMIN_MODE_SWITCH.mustIncludeShell, "shell mode switch");
    assertIncludes(css, ADMIN_MODE_SWITCH.mustIncludeCss, "css mode switch");
    // Admin: Modo usuário → app; App: Modo ADM hidden até requireAdmin
    assert.match(
      shell,
      /shell === "admin"[\s\S]*Modo usuário[\s\S]*href="\/app\.html"|Modo usuário[\s\S]*\/app\.html/
    );
    assert.match(shell, /Modo ADM[\s\S]*hidden|hidden[\s\S]*Modo ADM/);
    assert.match(shell, /requireAdmin[\s\S]*modeBtn\.hidden\s*=\s*false/);
  });

  it("v2.js + shell + users + proteger: espelho de conta", () => {
    const v2 = readFileSync(resolve(root, ADMIN_ACCOUNT_MIRROR.v2), "utf8");
    const shell = readFileSync(resolve(root, ADMIN_ACCOUNT_MIRROR.shell), "utf8");
    const users = readFileSync(
      resolve(root, ADMIN_ACCOUNT_MIRROR.usersPage),
      "utf8"
    );
    const proteger = readFileSync(
      resolve(root, ADMIN_ACCOUNT_MIRROR.protegerPage),
      "utf8"
    );
    assertIncludes(v2, ADMIN_ACCOUNT_MIRROR.mustIncludeV2, "v2.js espelho");
    assertIncludes(shell, ADMIN_ACCOUNT_MIRROR.mustIncludeShell, "shell espelho");
    assertIncludes(users, ADMIN_ACCOUNT_MIRROR.mustIncludeUsers, "admin-users espelho");
    assertIncludes(
      proteger,
      ADMIN_ACCOUNT_MIRROR.mustIncludeProteger,
      "proteger espelho readonly"
    );
    for (const k of ADMIN_ACCOUNT_MIRROR.storageKeys) {
      assert.ok(v2.includes(k), `v2.js sem storage key ${k}`);
    }
    // logout limpa espelho
    assert.match(shell, /clearImpersonation\(\)/);
    assert.match(shell, /doLogout|v2AdminLogout|v2LogoutLink/);
  });
});
