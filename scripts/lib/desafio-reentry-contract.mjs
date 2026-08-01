/**
 * Contrato — reentrada no Desafio após cancelar a própria entrada.
 *
 * Pedido explícito: após cancelar, o cliente pode entrar de novo na mesma
 * etapa, desde que a etapa ainda siga as regras iniciais de entrada
 * (saldo, ciclo, etapa aberta) e a etapa/desafio não esteja em andamento
 * (ao vivo / pós-kickoff) nem finalizado.
 *
 * Marker: desafio-reentrada-apos-cancelar-v1
 */

export const DESAFIO_REENTRY_CONTRACT_VERSION =
  "desafio-reentrada-apos-cancelar-v1";

export const DESAFIO_REENTRY_LOCK =
  "DO_NOT_BLOCK_SAME_STEP_AFTER_CLIENT_CANCEL_WITHOUT_EXPLICIT_REQUEST";

/** Participação cancelada não bloqueia nova entrada na mesma etapa. */
export function isCancelledDesafioParticipationResult(result) {
  const r = String(result || "")
    .toLowerCase()
    .trim();
  return (
    r === "cancelled" ||
    r === "canceled" ||
    r === "refunded" ||
    r === "void_cancel"
  );
}

/**
 * Bloqueia reentrada só se já houver participação efetiva
 * (pending / won / lost / void liquidado). Canceladas NÃO bloqueiam.
 */
export function hasBlockingDesafioParticipationOnStep(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return list.some((row) => {
    if (!row) return false;
    return !isCancelledDesafioParticipationResult(row.result);
  });
}

/** Conta só entradas que consomem o ciclo (ignora canceladas). */
export function countDesafioEntriesPlayed(participations = []) {
  const list = Array.isArray(participations) ? participations : [];
  return list.filter(
    (p) => !isCancelledDesafioParticipationResult(p?.result)
  ).length;
}

/**
 * Etapa aberta para entrada/reentrada: não liquidada, não ao vivo,
 * kickoff ainda no futuro.
 */
export function isDesafioStepOpenForEntry(step, nowMs = Date.now()) {
  if (!step) return false;
  const st = String(step.status || "").toLowerCase();
  if (
    st === "done" ||
    st === "settled" ||
    st === "closed" ||
    st === "cancelled" ||
    st === "canceled"
  ) {
    return false;
  }
  if (step.settled_at) return false;
  const res = String(step.result || "").toLowerCase();
  if (
    res === "win" ||
    res === "zebra_protected" ||
    res === "lost" ||
    res === "void" ||
    res === "empate_anula"
  ) {
    return false;
  }
  if (st === "live" || st === "in_play" || st === "inplay" || st === "ao_vivo") {
    return false;
  }
  const startsMs = step.starts_at ? new Date(step.starts_at).getTime() : NaN;
  if (Number.isFinite(startsMs) && nowMs >= startsMs) return false;
  return true;
}

/**
 * Desafio ainda disponível para o cliente entrar (publicado/ativo,
 * não completed/cancelled).
 */
export function isDesafioOpenForClientEntry(desafio) {
  if (!desafio) return false;
  if (desafio.deleted_at) return false;
  if (desafio.is_active !== true) return false;
  const st = String(desafio.status || "").toLowerCase();
  if (
    st === "completed" ||
    st === "cancelled" ||
    st === "canceled" ||
    st === "done" ||
    st === "finished" ||
    st === "deleted"
  ) {
    return false;
  }
  return true;
}

export const DESAFIO_REENTRY_SPEC = Object.freeze({
  version: DESAFIO_REENTRY_CONTRACT_VERSION,
  lock: DESAFIO_REENTRY_LOCK,
  rules: Object.freeze([
    "cancelar própria entrada devolve saldo Desafio",
    "participação cancelled não bloqueia mesma etapa",
    "reentrada exige etapa aberta (não live / não finalizada / antes do kickoff)",
    "reentrada exige desafio ativo (não completed/cancelled)",
    "demais regras do ciclo (saldo, pending, máx. entradas) permanecem",
  ]),
});
