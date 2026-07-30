/**
 * Contrato de markers de layout (UI) — anti-regressão.
 * Páginas críticas devem manter meta arbishield-build / arbishield-features.
 * Alterar só com pedido explícito do dono (+ bump SYSTEM_NON_REGRESSION_VERSION).
 */
export const SYSTEM_NON_REGRESSION_VERSION = "system-non-regression-v1";
export const SYSTEM_NON_REGRESSION_LOCK =
  "DO_NOT_CHANGE_SYSTEM_SURFACE_WITHOUT_EXPLICIT_REQUEST";

/** Páginas críticas → metas esperadas (build exato; features contém). */
export const UI_CRITICAL_MARKERS = Object.freeze({
  "deploy/vps-supabase/static/v2/app-proteger.html": Object.freeze({
    build: "proteger-sem-stake-equiv-v1",
    featuresMustInclude: Object.freeze([
      "proteger-stake-lock-v6",
      "proteger-sem-stake-equiv-v1",
    ]),
    bodyMustInclude: Object.freeze([
      "currentEventMaxCents",
      "data.lockedCents",
      "Máx. efetivo neste evento",
      "1 proteção por evento",
    ]),
  }),
  "deploy/vps-supabase/static/v2/app-protecoes.html": Object.freeze({
    build: "proteger-comissao-lucro-bruto-v1",
    featuresMustInclude: Object.freeze([]),
    bodyMustInclude: Object.freeze(["Cancelar", "Saldo Reembolso"]),
  }),
  "deploy/vps-supabase/static/v2/app-carteira.html": Object.freeze({
    build: "extrato-fee-upfront-perdeu-v1",
    featuresMustInclude: Object.freeze([]),
    bodyMustInclude: Object.freeze(["Saldo Reembolso"]),
    bodyMustNotInclude: Object.freeze(["Saldo Dedução"]),
  }),
  "deploy/vps-supabase/static/v2/admin-jogos.html": Object.freeze({
    build: "admin-jogos-unpublish-finalizados-v8",
    featuresMustInclude: Object.freeze([]),
    bodyMustInclude: Object.freeze([
      "searchFootballTeams",
      "football-teams",
      "Saldo Reembolso",
    ]),
  }),
});

export function parseHtmlMeta(html, name) {
  const re = new RegExp(
    `<meta\\s+name=["']${name}["']\\s+content=["']([^"']*)["']`,
    "i"
  );
  const m = String(html || "").match(re);
  return m ? m[1] : "";
}

export function assertUiPageMarkers(relPath, html) {
  const spec = UI_CRITICAL_MARKERS[relPath];
  if (!spec) return { ok: true, errors: [] };
  const errors = [];
  const build = parseHtmlMeta(html, "arbishield-build");
  const features = parseHtmlMeta(html, "arbishield-features");
  if (spec.build && build !== spec.build) {
    errors.push(`${relPath}: build="${build}" esperado "${spec.build}"`);
  }
  for (const f of spec.featuresMustInclude || []) {
    if (!features.includes(f)) {
      errors.push(`${relPath}: features sem "${f}" (tem: ${features})`);
    }
  }
  for (const s of spec.bodyMustInclude || []) {
    if (!String(html).includes(s)) {
      errors.push(`${relPath}: body sem "${s}"`);
    }
  }
  for (const s of spec.bodyMustNotInclude || []) {
    if (String(html).includes(s)) {
      errors.push(`${relPath}: body NÃO pode ter "${s}"`);
    }
  }
  return { ok: errors.length === 0, errors, build, features };
}
