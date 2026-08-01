/**
 * Pedido explícito: etapas liquidadas permanecem na grade do Desafio.
 * Marker: desafio-etapas-liquidadas-visiveis-v1
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(
  resolve(root, "deploy/vps-supabase/static/v2/app-desafio.html"),
  "utf8"
);

const MARKER = "desafio-etapas-liquidadas-visiveis-v1";

describe("Desafio — etapas liquidadas visíveis", () => {
  it("declara o marker na meta build/features", () => {
    assert.match(html, new RegExp(`arbishield-build" content="${MARKER}"`));
    assert.match(html, new RegExp(MARKER));
  });

  it("lista steps sem filtrar stepIsFinished", () => {
    assert.match(html, /function isDesafioListedForClient/);
    assert.match(html, /function listClientSteps/);
    assert.match(html, /listClientSteps\(d\)\.forEach/);
    // o filtro antigo que escondia liquidados não pode restar no load
    assert.doesNotMatch(
      html,
      /!s\.deleted_at && !stepIsFinished\(s\)/
    );
  });

  it("card marca liquidado com outcome", () => {
    assert.match(html, /function stepOutcomeLabel/);
    assert.match(html, /Bateu Arbi/);
    assert.match(html, /Bateu Casa/);
    assert.match(html, /Empate Anula/);
    assert.match(html, /is-settled/);
    assert.match(html, /Etapa .* · Liquidada|Liquidada/);
    assert.match(html, /data-finished=/);
  });

  it("AGENTS documenta a regra", () => {
    const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8");
    assert.match(agents, /desafio-etapas-liquidadas-visiveis-v1/);
  });
});
