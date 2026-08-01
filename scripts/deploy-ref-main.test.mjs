/**
 * Deploy sai de `main` — e de mais nada.
 *
 * A causa das regressões era esta: cada script de deploy baixava de uma branch
 * fixa (45 apontavam para uma de 27/07, 38 para uma de 25/07), então rodar um
 * script antigo trazia arquivos antigos de volta. Com `main` como fonte única,
 * o deploy só anda para frente.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = resolve(root, "scripts");

function shellScripts(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) shellScripts(p, out);
    else if (entry.name.endsWith(".sh")) out.push(p);
  }
  return out;
}

const files = shellScripts(scriptsDir).map((path) => ({
  path,
  rel: path.slice(root.length + 1),
  text: readFileSync(path, "utf8"),
}));

describe("nenhum deploy aponta para branch fixa", () => {
  it("há scripts de deploy para checar", () => {
    assert.ok(files.length > 50, `só ${files.length} scripts encontrados`);
  });

  it("ARBISHIELD_REF nunca tem branch cursor/ como default", () => {
    const bad = files
      .filter((f) => /ARBISHIELD_REF:-cursor\//.test(f.text))
      .map((f) => f.rel);
    assert.deepEqual(bad, [], `default de branch em: ${bad.join(", ")}`);
  });

  it("ARBISHIELD_REF nunca tem sha fixo como default", () => {
    const bad = files
      .filter((f) => /ARBISHIELD_REF:-[0-9a-f]{40}/.test(f.text))
      .map((f) => f.rel);
    assert.deepEqual(bad, [], `sha fixo em: ${bad.join(", ")}`);
  });

  it("os exemplos de uso baixam de main", () => {
    const bad = files
      .filter((f) => /\?ref=cursor\//.test(f.text))
      .map((f) => f.rel);
    assert.deepEqual(bad, [], `?ref=cursor/ em: ${bad.join(", ")}`);
  });
});

describe("os dois publicadores saem de main", () => {
  for (const rel of [
    "scripts/vps-publish-release.sh",
    "scripts/vps-publish-shim.sh",
  ]) {
    it(rel, () => {
      const text = readFileSync(resolve(root, rel), "utf8");
      assert.match(text, /^REF="main"$/m);
      assert.match(text, /\?ref=main/);
    });
  }
});
