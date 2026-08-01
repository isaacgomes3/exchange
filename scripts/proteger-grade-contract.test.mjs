/**
 * Grade Proteger — publicados do dia (proteger-grade-dia-visivel-v1).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  PROTEGER_GRADE_CONTRACT_VERSION,
  PROTEGER_GRADE_LOCK,
  PROTEGER_GRADE_UI_BUILD,
  LIQUIDITY_FINISHED_LABEL,
  startOfDaySaoPaulo,
  endOfCalendarDaySaoPaulo,
  isStartsAtOnSaoPauloDay,
  isVisibleOnClientDayGrade,
  matchHasClientLiquidity,
  matchLiquidityLeftCents,
  shouldUnpublishExpiredMatch,
  PROTEGER_GRADE_SPEC,
} from "./lib/proteger-grade-contract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");

describe("proteger-grade-contract — versão e lock", () => {
  it("versão/lock/spec", () => {
    assert.equal(PROTEGER_GRADE_CONTRACT_VERSION, "proteger-grade-dia-visivel-v1");
    assert.equal(
      PROTEGER_GRADE_LOCK,
      "DO_NOT_HIDE_PUBLISHED_DAY_MATCHES_WITHOUT_EXPLICIT_REQUEST"
    );
    assert.equal(PROTEGER_GRADE_UI_BUILD, "proteger-grade-dia-visivel-v1");
    assert.equal(LIQUIDITY_FINISHED_LABEL, "Liquidez finalizada");
    assert.equal(PROTEGER_GRADE_SPEC.version, PROTEGER_GRADE_CONTRACT_VERSION);
    assert.ok(PROTEGER_GRADE_SPEC.rules.length >= 4);
  });
});

describe("proteger-grade-contract — janela do dia SP", () => {
  it("start/end cobrem o dia civil", () => {
    const now = Date.parse("2026-08-01T15:00:00.000-03:00");
    const start = startOfDaySaoPaulo(now);
    const end = endOfCalendarDaySaoPaulo(now);
    assert.equal(start, Date.parse("2026-08-01T00:00:00.000-03:00"));
    assert.equal(end, Date.parse("2026-08-01T23:59:59.999-03:00"));
    assert.ok(isStartsAtOnSaoPauloDay("2026-08-01T10:00:00.000-03:00", now));
    assert.equal(isStartsAtOnSaoPauloDay("2026-07-31T23:00:00.000-03:00", now), false);
  });
});

describe("proteger-grade-contract — visibilidade", () => {
  const now = Date.parse("2026-08-01T18:00:00.000-03:00");

  function base(over = {}) {
    return {
      id: "m1",
      is_published: true,
      deleted_at: null,
      starts_at: "2026-08-01T12:00:00.000-03:00",
      max_protection_cents: 10000,
      used_protection_cents: 0,
      status: "open",
      metadata: {},
      ...over,
    };
  }

  it("mostra publicado do dia mesmo sem liquidez", () => {
    const m = base({ used_protection_cents: 10000 });
    assert.equal(matchHasClientLiquidity(m), false);
    assert.equal(matchLiquidityLeftCents(m), 0);
    assert.equal(isVisibleOnClientDayGrade(m, now), true);
  });

  it("mostra após kickoff e finalizado do dia", () => {
    assert.equal(
      isVisibleOnClientDayGrade(
        base({ starts_at: "2026-08-01T10:00:00.000-03:00", status: "settled" }),
        now
      ),
      true
    );
    assert.equal(
      isVisibleOnClientDayGrade(
        base({ status_v2: "finished", settled_at: "2026-08-01T16:00:00.000Z" }),
        now
      ),
      true
    );
  });

  it("esconde rascunho, outro dia e hide_from_site", () => {
    assert.equal(isVisibleOnClientDayGrade(base({ is_published: false }), now), false);
    assert.equal(
      isVisibleOnClientDayGrade(
        base({ starts_at: "2026-07-31T20:00:00.000-03:00" }),
        now
      ),
      false
    );
    assert.equal(
      isVisibleOnClientDayGrade(
        base({ metadata: { hide_from_site: true } }),
        now
      ),
      false
    );
  });

  it("unpublish só dias anteriores", () => {
    assert.equal(
      shouldUnpublishExpiredMatch(
        base({ starts_at: "2026-08-01T09:00:00.000-03:00", status: "settled" }),
        now
      ),
      false
    );
    assert.equal(
      shouldUnpublishExpiredMatch(
        base({ starts_at: "2026-07-31T22:00:00.000-03:00" }),
        now
      ),
      true
    );
  });
});

describe("proteger-grade — UI + prelive + docs", () => {
  it("UI carrega marker e label Liquidez finalizada", () => {
    const ui = read("deploy/vps-supabase/static/v2/app-proteger.html");
    assert.match(ui, /proteger-grade-dia-visivel-v1/);
    assert.match(ui, /Liquidez finalizada/);
    assert.match(ui, /isStartsAtTodaySp|brDayKey/);
    assert.match(ui, /Publicados hoje/);
    assert.doesNotMatch(ui, /Só aparecem jogos com liquidez disponível/);
  });

  it("prelive lista janela do dia e não unpublish settled do dia", () => {
    const prelive = read("scripts/arbishield-prelive-events.mjs");
    assert.match(prelive, /proteger-grade-dia-visivel-v1/);
    assert.match(prelive, /startOfDaySaoPaulo/);
    assert.match(prelive, /endOfCalendarDaySaoPaulo/);
    assert.match(prelive, /isVisibleOnClientDayGrade/);
    assert.match(prelive, /previous-days-only/);
    assert.match(prelive, /LIQUIDITY_FINISHED_LABEL/);
    // settle não força is_published false
    assert.doesNotMatch(
      prelive,
      /Finalizado NUNCA fica publicado/
    );
  });

  it("shim settle não tira publicação do dia", () => {
    const shim = read("scripts/arbishield-serverfn-shim.mjs");
    assert.match(shim, /proteger-grade-dia-visivel-v1/);
    assert.doesNotMatch(
      shim,
      /Finalizado NUNCA fica publicado — some da grade/
    );
  });

  it("AGENTS e SYSTEM_NON_REGRESSION documentam a regra", () => {
    const agents = read("AGENTS.md");
    const doc = read("docs/SYSTEM_NON_REGRESSION.md");
    assert.match(agents, /proteger-grade-dia-visivel-v1/);
    assert.match(agents, /Liquidez finalizada/);
    assert.match(doc, /proteger-grade-dia-visivel-v1/);
    assert.match(doc, /Liquidez finalizada/);
  });
});
