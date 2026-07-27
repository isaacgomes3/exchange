/**
 * Anti-regressão: ninguém pode SELECT/filtrar profiles.email.
 * A VPS quebra com: column profiles.email does not exist
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  PROFILES_HAS_EMAIL_COLUMN,
  PROFILES_NO_EMAIL_RULE,
  profilesSafeSelect,
  stripProfilesEmailFromPath,
} from "./lib/profiles-schema.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function walkJsFiles(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === "node_modules" || name.name === ".git" || name.name === "backup") {
      continue;
    }
    const p = join(dir, name.name);
    if (name.isDirectory()) walkJsFiles(p, out);
    else if (/\.(mjs|js|ts|html|sh)$/.test(name.name)) out.push(p);
  }
  return out;
}

describe("profiles schema — sem coluna email", () => {
  it("helpers e marker", () => {
    assert.equal(PROFILES_HAS_EMAIL_COLUMN, false);
    assert.equal(PROFILES_NO_EMAIL_RULE, "profiles-sem-coluna-email-v1");
    assert.equal(profilesSafeSelect(["email", "balance_cents"]), "id,full_name,balance_cents");
    assert.equal(
      stripProfilesEmailFromPath(
        "/rest/v1/profiles?select=id,full_name,email&email=eq.a@b.com&limit=1"
      ),
      "/rest/v1/profiles?select=id,full_name&limit=1"
    );
  });

  it("scripts/deploy não consultam profiles.email", () => {
    const files = [
      ...walkJsFiles(resolve(root, "scripts")),
      ...walkJsFiles(resolve(root, "deploy/vps-supabase/static/v2")),
    ];
    const offenders = [];
    for (const file of files) {
      // o próprio helper/teste/doc podem citar a string
      if (file.endsWith("profiles-schema.mjs")) continue;
      if (file.endsWith("profiles-schema.test.mjs")) continue;
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        const l = line.trim();
        if (!l || l.startsWith("//") || l.startsWith("*") || l.startsWith("#")) return;
        // paths PostgREST perigosos
        if (/\/rest\/v1\/profiles\?[^\n]*\bemail=eq\./i.test(l)) {
          offenders.push(`${file}:${i + 1}: ${l.slice(0, 120)}`);
          return;
        }
        if (/\/rest\/v1\/profiles\?[^\n]*select=[^\n]*\bemail\b/i.test(l)) {
          offenders.push(`${file}:${i + 1}: ${l.slice(0, 120)}`);
          return;
        }
        // supabase-js select string
        if (
          /\.from\(\s*["']profiles["']\s*\)[\s\S]{0,80}\.select\(\s*["'][^"']*\bemail\b/i.test(
            l
          )
        ) {
          offenders.push(`${file}:${i + 1}: ${l.slice(0, 120)}`);
        }
        // admin-jogos style
        if (/profiles\?select=[^"'\n]*\bemail\b/i.test(l)) {
          offenders.push(`${file}:${i + 1}: ${l.slice(0, 120)}`);
          return;
        }
        // embed PostgREST: profiles(full_name,email)
        if (/profiles\([^)]*\bemail\b[^)]*\)/i.test(l)) {
          offenders.push(`${file}:${i + 1}: ${l.slice(0, 120)}`);
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      "Remova profiles.email destes arquivos:\n" + offenders.join("\n")
    );
  });

  it("prelive/shim importam ou respeitam profiles-sem-coluna-email-v1", () => {
    const prelive = readFileSync(
      resolve(root, "scripts/arbishield-prelive-events.mjs"),
      "utf8"
    );
    const shim = readFileSync(
      resolve(root, "scripts/arbishield-serverfn-shim.mjs"),
      "utf8"
    );
    assert.match(prelive, /profiles-sem-coluna-email-v1|profilesSafeSelect|full_name(?!,email)/);
    assert.doesNotMatch(prelive, /\/rest\/v1\/profiles\?select=[^\n]*\bemail\b/);
    assert.doesNotMatch(shim, /\/rest\/v1\/profiles\?select=[^\n]*\bemail\b/);
  });
});
