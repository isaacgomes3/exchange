/**
 * Reentrada na mesma etapa após cancelar a própria entrada.
 * Marker: desafio-reentrada-apos-cancelar-v1
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  DESAFIO_REENTRY_CONTRACT_VERSION,
  DESAFIO_REENTRY_LOCK,
  isCancelledDesafioParticipationResult,
  hasBlockingDesafioParticipationOnStep,
  countDesafioEntriesPlayed,
  isDesafioStepOpenForEntry,
  isDesafioOpenForClientEntry,
  DESAFIO_REENTRY_SPEC,
} from "./lib/desafio-reentry-contract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");

describe("desafio-reentry-contract", () => {
  it("versão e lock", () => {
    assert.equal(
      DESAFIO_REENTRY_CONTRACT_VERSION,
      "desafio-reentrada-apos-cancelar-v1"
    );
    assert.equal(
      DESAFIO_REENTRY_LOCK,
      "DO_NOT_BLOCK_SAME_STEP_AFTER_CLIENT_CANCEL_WITHOUT_EXPLICIT_REQUEST"
    );
    assert.equal(DESAFIO_REENTRY_SPEC.version, DESAFIO_REENTRY_CONTRACT_VERSION);
  });

  it("cancelada não bloqueia; pending/won bloqueiam", () => {
    assert.equal(isCancelledDesafioParticipationResult("cancelled"), true);
    assert.equal(isCancelledDesafioParticipationResult("canceled"), true);
    assert.equal(isCancelledDesafioParticipationResult("pending"), false);
    assert.equal(
      hasBlockingDesafioParticipationOnStep([{ result: "cancelled" }]),
      false
    );
    assert.equal(
      hasBlockingDesafioParticipationOnStep([
        { result: "cancelled" },
        { result: "pending" },
      ]),
      true
    );
    assert.equal(
      countDesafioEntriesPlayed([
        { result: "cancelled" },
        { result: "won" },
        { result: "canceled" },
      ]),
      1
    );
  });

  it("etapa aberta só antes do kickoff e sem settle", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    assert.equal(
      isDesafioStepOpenForEntry({ status: "pending", starts_at: future }),
      true
    );
    assert.equal(
      isDesafioStepOpenForEntry({ status: "live", starts_at: past }),
      false
    );
    assert.equal(
      isDesafioStepOpenForEntry({ status: "pending", starts_at: past }),
      false
    );
    assert.equal(
      isDesafioStepOpenForEntry({
        status: "done",
        starts_at: future,
        result: "zebra_protected",
      }),
      false
    );
  });

  it("desafio só se ativo e não finalizado", () => {
    assert.equal(
      isDesafioOpenForClientEntry({ is_active: true, status: "active" }),
      true
    );
    assert.equal(
      isDesafioOpenForClientEntry({ is_active: false, status: "draft" }),
      false
    );
    assert.equal(
      isDesafioOpenForClientEntry({ is_active: true, status: "completed" }),
      false
    );
  });

  it("shim aplica o contrato no register/circuit", () => {
    const shim = read("scripts/arbishield-serverfn-shim.mjs");
    assert.match(shim, /desafio-reentrada-apos-cancelar-v1/);
    assert.match(shim, /hasBlockingDesafioParticipationOnStep/);
    assert.match(shim, /isDesafioStepOpenForEntry/);
    assert.match(shim, /isDesafioOpenForClientEntry/);
    assert.match(shim, /countDesafioEntriesPlayed/);
    // query antiga que bloqueava cancelada sem olhar result
    assert.doesNotMatch(
      shim,
      /desafio_participations\?select=id&user_id=eq\.\$\{userId\}&step_id=eq/
    );
  });

  it("AGENTS documenta a regra", () => {
    const agents = read("AGENTS.md");
    assert.match(agents, /desafio-reentrada-apos-cancelar-v1/);
  });
});
