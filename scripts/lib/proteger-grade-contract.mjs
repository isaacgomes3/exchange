/**
 * Contrato — Grade Proteger Aposta (publicados do dia).
 *
 * Pedido explícito do dono: a grade do cliente mostra TODOS os jogos
 * publicados no dia (America/Sao_Paulo), mesmo sem liquidez e mesmo após
 * kickoff/finalização. Liquidez zerada destaca "Liquidez finalizada".
 * Ativação pós-kickoff continua bloqueada (stake_lock_v1 / contrato v10).
 *
 * Marker: proteger-grade-dia-visivel-v1
 */

export const PROTEGER_GRADE_CONTRACT_VERSION = "proteger-grade-dia-visivel-v1";
export const PROTEGER_GRADE_LOCK =
  "DO_NOT_HIDE_PUBLISHED_DAY_MATCHES_WITHOUT_EXPLICIT_REQUEST";

/** Meta arbishield-build da página do cliente. */
export const PROTEGER_GRADE_UI_BUILD = "proteger-grade-dia-visivel-v1";

/** Label obrigatório na UI quando liquidez esgotou. */
export const LIQUIDITY_FINISHED_LABEL = "Liquidez finalizada";

function brDayString(from = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(from));
}

/** Início do dia civil em America/Sao_Paulo (UTC ms). */
export function startOfDaySaoPaulo(from = Date.now()) {
  return Date.parse(`${brDayString(from)}T00:00:00.000-03:00`);
}

/** Fim do dia civil em America/Sao_Paulo (UTC ms). */
export function endOfCalendarDaySaoPaulo(from = Date.now()) {
  return Date.parse(`${brDayString(from)}T23:59:59.999-03:00`);
}

/** starts_at cai no dia civil SP de `from`. */
export function isStartsAtOnSaoPauloDay(startsAt, from = Date.now()) {
  const t = new Date(startsAt).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= startOfDaySaoPaulo(from) && t <= endOfCalendarDaySaoPaulo(from);
}

/** Liquidez restante agregada (mercados ou partida). */
export function matchLiquidityLeftCents(m) {
  const markets = Array.isArray(m?.markets) ? m.markets : [];
  if (markets.length) {
    return markets.reduce((acc, mk) => {
      if (!mk) return acc;
      const max = Number(
        mk.liquidity ?? mk.max_cents ?? mk.max_protection_cents ?? 0
      );
      const used = Number(
        mk.used_liquidity ?? mk.used_cents ?? mk.used_protection_cents ?? 0
      );
      return acc + Math.max(0, max - used);
    }, 0);
  }
  const max = Number(m?.max_protection_cents || 0);
  const used = Number(m?.used_protection_cents || 0);
  return Math.max(0, max - used);
}

export function matchHasClientLiquidity(m) {
  return matchLiquidityLeftCents(m) > 0;
}

/**
 * Visível na grade do cliente: publicado + kickoff no dia SP.
 * NÃO exige liquidez; NÃO esconde pós-kickoff nem finalizado.
 */
export function isVisibleOnClientDayGrade(m, now = Date.now()) {
  if (!m || m.deleted_at || m.is_published !== true) return false;
  if (!isStartsAtOnSaoPauloDay(m.starts_at, now)) return false;
  const meta = m.metadata && typeof m.metadata === "object" ? m.metadata : {};
  if (meta.hide_from_site || meta.hidden) return false;
  return true;
}

/**
 * Unpublish só limpa dias ANTERIORES — jogos do dia (mesmo finalizados
 * ou após kickoff) permanecem publicados para a grade do cliente.
 */
export function shouldUnpublishExpiredMatch(m, now = Date.now()) {
  if (!m || m.is_published !== true) return false;
  const t = new Date(m.starts_at).getTime();
  if (!Number.isFinite(t)) return false;
  return t < startOfDaySaoPaulo(now);
}

export const PROTEGER_GRADE_SPEC = Object.freeze({
  version: PROTEGER_GRADE_CONTRACT_VERSION,
  lock: PROTEGER_GRADE_LOCK,
  uiBuild: PROTEGER_GRADE_UI_BUILD,
  liquidityFinishedLabel: LIQUIDITY_FINISHED_LABEL,
  rules: Object.freeze([
    "grade lista todos is_published do dia America/Sao_Paulo",
    "sem liquidez continua visível com label Liquidez finalizada",
    "pós-kickoff e finalizados do dia permanecem na grade",
    "unpublish automático só para starts_at de dias anteriores",
    "settle NÃO tira is_published no mesmo dia",
    "ativação pós-kickoff continua bloqueada (stake_lock_v1)",
  ]),
});
