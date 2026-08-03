/**
 * Superfície pública auditável: o que está no ar × o que está no git.
 *
 * Cada entrada liga uma URL servida em produção ao arquivo do repositório que
 * deveria tê-la gerado. É a lista que o auditor de desvio percorre.
 */
export const PROD_SURFACE_VERSION = "prod-surface-v1";

export const PROD_ORIGIN = "https://arbishield.app";

const V2 = "deploy/vps-supabase/static/v2";

/** urlPath → arquivo no repo. Ordem = ordem do relatório. */
export const PROD_SURFACE = [
  ["/app-desafio.html", `${V2}/app-desafio.html`],
  ["/app-proteger.html", `${V2}/app-proteger.html`],
  ["/app-protecoes.html", `${V2}/app-protecoes.html`],
  ["/app-carteira.html", `${V2}/app-carteira.html`],
  ["/app.html", `${V2}/app.html`],
  ["/admin.html", `${V2}/admin.html`],
  ["/admin-jogos.html", `${V2}/admin-jogos.html`],
  ["/admin-desafios.html", `${V2}/admin-desafios.html`],
  ["/admin-monitoring-desafios.html", `${V2}/admin-monitoring-desafios.html`],
  ["/admin-users.html", `${V2}/admin-users.html`],
  ["/admin-manual-deposits.html", `${V2}/admin-manual-deposits.html`],
  ["/admin-balanco-desafio.html", `${V2}/admin-balanco-desafio.html`],
  ["/admin-balanco-protecao.html", `${V2}/admin-balanco-protecao.html`],
  ["/v2.js", `${V2}/v2.js`],
  ["/v2-shell.js", `${V2}/v2-shell.js`],
  ["/v2-financeiro.js", `${V2}/v2-financeiro.js`],
  ["/v2.css", `${V2}/v2.css`],
];

/**
 * Some o ruído que os hotfixes gravam no servidor e que nunca volta ao git:
 * cache-bust `?v=...` reescrito por sed em produção. Sem isso, todo arquivo
 * aparece como divergente e o desvio de verdade fica invisível.
 */
export function normalizeDeployedAsset(text) {
  return String(text)
    .replace(/(\.(?:js|css|mjs))\?v=[^"'\s>]*/g, "$1")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n+$/, "\n");
}

export function isTextContentType(contentType) {
  return /(?:html|javascript|json|css|text)/i.test(String(contentType || ""));
}

/**
 * Quantas linhas não batem entre dois conteúdos (diferença simétrica de
 * multiconjunto). Não é um diff exato — é uma medida rápida do tamanho do
 * desvio, para dizer "difere em 2 linhas" em vez de só "não existe no git".
 */
export function lineDelta(a, b) {
  const count = (text) => {
    const map = new Map();
    for (const line of normalizeDeployedAsset(text).split("\n")) {
      const key = line.trim();
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  };
  const left = count(a);
  const right = count(b);
  let delta = 0;
  for (const [line, n] of left) delta += Math.max(0, n - (right.get(line) || 0));
  for (const [line, n] of right) delta += Math.max(0, n - (left.get(line) || 0));
  return delta;
}
