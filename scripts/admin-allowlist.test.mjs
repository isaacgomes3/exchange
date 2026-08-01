/**
 * Allowlist de e-mail de admin (admin-email-allowlist-v1).
 *
 * Controle de segurança criado depois de conta que virou super admin e apagou
 * desafios em massa: ter role no banco não basta, o e-mail do JWT precisa estar
 * na lista. Já foi perdido uma vez ao publicar shim de outra linhagem — daí este
 * teste travar não só a existência, mas a **ordem**: a checagem vem antes de
 * qualquer consulta ao banco.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");

const SHIM = read("scripts/arbishield-serverfn-shim.mjs");
const V2 = read("deploy/vps-supabase/static/v2/v2.js");

const EMAILS = [
  "isaacgomes3@gmail.com",
  "financeiro@arbishield.com",
  "carlos@arbishield.com",
  "icaro@arbishield.com",
];

/** Corpo de uma função async do shim, para checar ordem interna. */
function fnBody(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start > 0, `função ${name} não encontrada`);
  const end = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, end > 0 ? end : start + 4000);
}

describe("shim: allowlist de admin", () => {
  it("a lista existe com os quatro e-mails", () => {
    assert.match(SHIM, /const ALLOWED_ADMIN_EMAILS = new Set\(\[/);
    for (const email of EMAILS) {
      assert.ok(SHIM.includes(`"${email}"`), `${email} fora da allowlist`);
    }
  });

  for (const name of ["currentUserIsAdmin", "currentUserIsSuperAdmin"]) {
    it(`${name} recusa e-mail fora da lista`, () => {
      const body = fnBody(SHIM, name);
      assert.match(body, /ALLOWED_ADMIN_EMAILS\.has\(/);
      assert.match(body, /return false/);
    });

    it(`${name} checa a allowlist ANTES de consultar o banco`, () => {
      const body = fnBody(SHIM, name);
      const check = body.indexOf("ALLOWED_ADMIN_EMAILS.has(");
      const query = body.indexOf("await sb(");
      assert.ok(check > 0, "sem checagem de allowlist");
      assert.ok(query > 0, "sem consulta ao banco");
      assert.ok(check < query, "consulta ao banco antes da allowlist");
    });
  }

  it("o e-mail sai do JWT, não do corpo da requisição", () => {
    assert.match(SHIM, /function adminEmailFromJwt\(payload\)/);
    const helper = SHIM.slice(
      SHIM.indexOf("function adminEmailFromJwt(payload)"),
      SHIM.indexOf("async function currentUserIsSuperAdmin(")
    );
    assert.match(helper, /payload\?\.email/);
    assert.match(helper, /toLowerCase\(\)/);
  });

  it("marker presente nas duas checagens", () => {
    assert.equal((SHIM.match(/admin-email-allowlist-v1/g) || []).length >= 3, true);
  });
});

describe("frontend: a mesma lista", () => {
  it("v2.js também restringe por e-mail", () => {
    for (const email of EMAILS) {
      assert.ok(V2.includes(email), `${email} fora da allowlist do v2.js`);
    }
  });
});

describe("financeiro: Ajuste de saldo (Carlos liberado)", () => {
  const FINANCE = [
    "isaacgomes3@gmail.com",
    "financeiro@arbishield.com",
    "carlos@arbishield.com",
  ];
  const FIN = read("deploy/vps-supabase/static/finance-admins.js");

  it("shim, v2.js e finance-admins.js incluem Carlos", () => {
    const block = SHIM.slice(
      SHIM.indexOf("const FINANCE_ADMIN_EMAILS = new Set(["),
      SHIM.indexOf("function tokenEmail(token)")
    );
    for (const email of FINANCE) {
      assert.ok(block.includes(`"${email}"`), `shim sem ${email}`);
      assert.ok(V2.includes(`"${email}": 1`), `v2.js sem ${email}`);
      assert.ok(FIN.includes(`"${email}": 1`), `finance-admins.js sem ${email}`);
    }
  });

  it("adjustAdminBalance exige finance admin", () => {
    const start = SHIM.indexOf("async function adjustAdminBalance(");
    assert.ok(start > 0);
    const body = SHIM.slice(start, start + 400);
    assert.match(body, /await requireFinanceAdmin\(token\)/);
  });
});
