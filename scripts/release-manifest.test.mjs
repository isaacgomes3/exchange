/**
 * Contrato da release versionada (release-artifact-v1).
 *
 * O teste que importa é o da guarda: publicar commit anterior ao que está no ar
 * tem que ser recusado — era exatamente assim que o sistema voltava atrás.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { existsSync } from "node:fs";
import {
  GENERATED_FILES,
  MANIFEST_FILE,
  RELEASE_CONTRACT_VERSION,
  RELEASE_EXTRA_FILES,
  RELEASE_OPTIONAL_REFS,
  RELEASE_SOURCE_DIR,
  VERSION_FILE,
  applyCacheBust,
  buildManifest,
  buildVersionInfo,
  collectLocalRefs,
  decidePublish,
  listReleaseFiles,
  missingRefs,
  sha256,
  verifyManifest,
} from "./lib/release-manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "release-test-"));
  scratch.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe("guarda de regressão", () => {
  const current = "1111111111111111111111111111111111111111";
  const target = "2222222222222222222222222222222222222222";

  it("descendente publica", () => {
    const v = decidePublish({ current, target, compareStatus: "ahead" });
    assert.equal(v.allow, true);
  });

  it("commit anterior é BLOQUEADO", () => {
    const v = decidePublish({ current, target, compareStatus: "behind" });
    assert.equal(v.allow, false);
    assert.match(v.reason, /ANTERIOR/);
  });

  it("histórias divergentes são BLOQUEADAS", () => {
    const v = decidePublish({ current, target, compareStatus: "diverged" });
    assert.equal(v.allow, false);
  });

  it("sem conseguir comparar, não publica", () => {
    assert.equal(decidePublish({ current, target, compareStatus: null }).allow, false);
    assert.equal(
      decidePublish({ current, target, compareStatus: "desconhecido" }).allow,
      false
    );
  });

  it("primeira publicação e republicação passam", () => {
    assert.equal(decidePublish({ current: null, target }).allow, true);
    assert.equal(decidePublish({ current: target, target }).allow, true);
  });

  it("force libera, mas fica marcado", () => {
    const v = decidePublish({ current, target, compareStatus: "behind", force: true });
    assert.equal(v.allow, true);
    assert.equal(v.forced, true);
  });

  it("sem alvo não publica", () => {
    assert.equal(decidePublish({ current, target: null }).allow, false);
    assert.equal(decidePublish({}).allow, false);
  });
});

describe("cache-bust vem do build", () => {
  it("reescreve ?v= antigo e marca referência sem query", () => {
    const html =
      '<script src="/v2.js?v=admin-mfa-1785449058"></script>' +
      '<link rel="stylesheet" href="/v2.css" />' +
      '<script src="/v2-shell.js?v=velho" defer></script>';
    const out = applyCacheBust(html, "abc123def456");
    assert.match(out, /\/v2\.js\?v=abc123def456/);
    assert.match(out, /\/v2\.css\?v=abc123def456/);
    assert.match(out, /\/v2-shell\.js\?v=abc123def456/);
    assert.doesNotMatch(out, /admin-mfa/);
  });

  it("não mexe em imagem, âncora nem link externo", () => {
    const html =
      '<img src="/brand/logo.png" />' +
      '<a href="/app.html">app</a>' +
      '<link href="https://fonts.googleapis.com/css2?family=X" rel="stylesheet" />';
    assert.equal(applyCacheBust(html, "abc123"), html);
  });

  it("token vazio não altera nada", () => {
    const html = '<script src="/v2.js?v=x"></script>';
    assert.equal(applyCacheBust(html, ""), html);
  });
});

describe("manifesto", () => {
  function fixture() {
    const dir = tempDir();
    mkdirSync(join(dir, "brand"), { recursive: true });
    writeFileSync(join(dir, "app.html"), "<html>oi</html>");
    writeFileSync(join(dir, "brand", "logo.svg"), "<svg/>");
    return dir;
  }

  it("lista arquivos em posix, ordenados, sem os gerados", () => {
    const dir = fixture();
    writeFileSync(join(dir, MANIFEST_FILE), "{}");
    writeFileSync(join(dir, VERSION_FILE), "{}");
    assert.deepEqual(listReleaseFiles(dir), ["app.html", "brand/logo.svg"]);
    for (const generated of GENERATED_FILES) {
      assert.ok(!listReleaseFiles(dir).includes(generated));
    }
  });

  it("verify aprova o que está íntegro", () => {
    const dir = fixture();
    const files = {};
    for (const rel of listReleaseFiles(dir)) {
      files[rel] = sha256(Buffer.from(rel === "app.html" ? "<html>oi</html>" : "<svg/>"));
    }
    const manifest = buildManifest({ commit: "a".repeat(40), files });
    assert.equal(manifest.contract, RELEASE_CONTRACT_VERSION);
    assert.equal(manifest.cacheBust, "a".repeat(12));
    assert.equal(verifyManifest(dir, manifest).ok, true);
  });

  it("verify acusa arquivo alterado, faltando e sobrando", () => {
    const dir = fixture();
    const manifest = buildManifest({
      commit: "b".repeat(40),
      files: {
        "app.html": sha256(Buffer.from("outro conteudo")),
        "sumiu.html": sha256(Buffer.from("x")),
      },
    });
    const check = verifyManifest(dir, manifest);
    assert.equal(check.ok, false);
    assert.deepEqual(check.missing, ["sumiu.html"]);
    assert.deepEqual(check.changed, ["app.html"]);
    assert.deepEqual(check.extra, ["brand/logo.svg"]);
  });

  it("manifesto exige commit", () => {
    assert.throws(() => buildManifest({ files: {} }), /commit/);
  });

  it("__version.json carrega commit e hash do manifesto", () => {
    const manifest = buildManifest({ commit: "c".repeat(40), files: { "a.html": "x" } });
    const info = buildVersionInfo(manifest);
    assert.equal(info.commit, "c".repeat(40));
    assert.equal(info.fileCount, 1);
    assert.match(info.manifestSha256, /^[0-9a-f]{64}$/);
  });
});

describe("referências: publicar não pode virar 404", () => {
  function pageDir(html) {
    const dir = tempDir();
    writeFileSync(join(dir, "admin.html"), html);
    return dir;
  }

  it("acusa arquivo citado que a release não carrega", () => {
    const broken = missingRefs(pageDir('<script src="/finance-admins.js?v=1"></script>'));
    assert.equal(broken.length, 1);
    assert.equal(broken[0].ref, "/finance-admins.js");
    assert.deepEqual(broken[0].pages, ["admin.html"]);
  });

  it("aprova quando o arquivo está na release", () => {
    const dir = pageDir('<script src="/finance-admins.js"></script>');
    writeFileSync(join(dir, "finance-admins.js"), "//");
    assert.deepEqual(missingRefs(dir), []);
  });

  it("respeita a lista de faltas intencionais", () => {
    const dir = pageDir(
      '<script src="/assets/market-catalog.js"></script><a href="/termos.html">t</a>'
    );
    assert.deepEqual(missingRefs(dir), []);
  });

  it("coleta a referência com a página que a cita e ignora externo", () => {
    const refs = collectLocalRefs(
      pageDir('<link href="https://fonts.googleapis.com/x" /><script src="/v2.js?v=1"></script>')
    );
    assert.deepEqual([...refs.keys()], ["/v2.js"]);
    assert.deepEqual([...refs.get("/v2.js")], ["admin.html"]);
  });
});

describe("origem da release existe no repo", () => {
  it("RELEASE_SOURCE_DIR aponta para a UI publicada", () => {
    assert.equal(RELEASE_SOURCE_DIR, "deploy/vps-supabase/static/v2");
    assert.ok(listReleaseFiles(resolve(root, RELEASE_SOURCE_DIR)).length > 20);
  });

  it("os assets da raiz existem — sem eles a release serve 404", () => {
    assert.ok(Object.keys(RELEASE_EXTRA_FILES).length >= 2);
    for (const from of Object.keys(RELEASE_EXTRA_FILES)) {
      assert.ok(existsSync(resolve(root, from)), `${from} não existe`);
    }
  });

  it("market-catalog.js está na UI (some da linhagem com facilidade)", () => {
    assert.ok(
      existsSync(resolve(root, RELEASE_SOURCE_DIR, "market-catalog.js")),
      "market-catalog.js fora da release quebra o catálogo em admin-jogos"
    );
  });

  it("cada falta tolerada tem motivo registrado", () => {
    assert.ok(RELEASE_OPTIONAL_REFS.length >= 1);
    for (const ref of RELEASE_OPTIONAL_REFS) assert.match(ref, /^\//);
  });
});
