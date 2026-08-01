/**
 * Editar desafio já lançado sem retirá-lo da grade.
 * Marker: admin-desafios-edit-preserva-publicacao-v1
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");

const MARKER = "admin-desafios-edit-preserva-publicacao-v1";
const UI = "deploy/vps-supabase/static/v2/admin-desafios.html";
const SHIM = "scripts/arbishield-serverfn-shim.mjs";
const PRELIVE = "scripts/arbishield-prelive-events.mjs";

describe("UI: Editar desafio lançado", () => {
  const ui = read(UI);

  it("expõe o marker de build/features", () => {
    assert.match(ui, new RegExp(`arbishield-build" content="${MARKER}"`));
    assert.match(ui, new RegExp(`arbishield-features" content="${MARKER}"`));
  });

  it("tem botão Editar no card (data-edit)", () => {
    assert.match(ui, /data-edit=/);
    assert.match(ui, />Editar</);
  });

  it("abre drawer de edição com ids e edit_only", () => {
    assert.match(ui, /function rowToEditDraft\(/);
    assert.match(ui, /payload\.edit_only\s*=\s*true/);
    assert.match(ui, /Editar <span>Desafio<\/span>/);
    assert.match(ui, /Salvar alterações/);
  });

  it("não despublica na edição (toggle travado + copy)", () => {
    assert.match(ui, /Edição não retira o desafio da grade/);
    assert.match(ui, /fActive\.disabled = true/);
  });
});

describe("API: upsert preserva publicação", () => {
  const shim = read(SHIM);
  const prelive = read(PRELIVE);

  it("shim carrega o marker e guarda edit_only", () => {
    assert.match(shim, new RegExp(MARKER));
    assert.match(shim, /async function upsertDesafio\(/);
    assert.ok(
      (shim.match(/delete desafioRow\.published_at/g) || []).length >= 1,
      "deve omitir published_at no edit"
    );
    assert.match(shim, /delete desafioRow\.is_active/);
    assert.match(shim, /delete desafioRow\.status/);
  });

  it("POST /api/arbishield/desafios com id+steps chama upsert", () => {
    const start = shim.indexOf('url.pathname === "/api/arbishield/desafios"');
    assert.ok(start > 0);
    const chunk = shim.slice(start, start + 1800);
    assert.match(chunk, /upsertDesafio/);
    assert.match(chunk, /edit_only:\s*true/);
  });

  it("rejeita liquidez abaixo do utilizado", () => {
    assert.match(
      shim,
      /Liquidez da etapa não pode ser menor que o já utilizado/
    );
  });

  it("prelive espelha upsert com preservação", () => {
    assert.match(prelive, new RegExp(MARKER));
    assert.match(prelive, /async function upsertDesafio\(/);
    assert.match(prelive, /delete desafioRow\.published_at/);
  });
});
