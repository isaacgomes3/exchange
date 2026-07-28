#!/usr/bin/env bash
# Publica o worker que credita o Saldo Reembolso ao liquidar proteções.
#
# Após publicar, reenvie a liquidação dos jogos já finalizados pelo Admin.
# O worker reprocessa proteções terminalizadas sem lançamento no extrato.
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/corrigir-saldo-reembolso-56ab}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-${SHIM_DIR}/scripts}"

die() {
  echo "ERRO: $*" >&2
  exit 1
}

publish() {
  local rel="$1"
  local destination="$2"
  local tmp
  tmp="$(mktemp)"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "${RAW}/${rel}?t=$(date +%s)" -o "$tmp"
  [[ -s "$tmp" ]] || die "download vazio: ${rel}"
  mkdir -p "$(dirname "$destination")"
  cp -a "$destination" "${destination}.bak-reembolso-$(date +%s)" 2>/dev/null || true
  cp -f "$tmp" "$destination"
  chmod 0644 "$destination"
  rm -f "$tmp"
  echo "OK ${destination}"
}

publish "scripts/lib/protection-flow-contract.mjs" \
  "${SHIM_DIR}/lib/protection-flow-contract.mjs"
publish "scripts/arbishield-prelive-events.mjs" \
  "${SHIM_DIR}/arbishield-prelive-events.mjs"
publish "scripts/arbishield-serverfn-shim.mjs" \
  "${SHIM_DIR}/arbishield-serverfn-shim.mjs"

mkdir -p "${SCRIPTS_DIR}/lib"
cp -f "${SHIM_DIR}/lib/protection-flow-contract.mjs" \
  "${SCRIPTS_DIR}/lib/protection-flow-contract.mjs"
cp -f "${SHIM_DIR}/arbishield-prelive-events.mjs" \
  "${SCRIPTS_DIR}/arbishield-prelive-events.mjs"
cp -f "${SHIM_DIR}/arbishield-serverfn-shim.mjs" \
  "${SCRIPTS_DIR}/arbishield-serverfn-shim.mjs"

for unit in arbishield-prelive-events.service arbishield-serverfn-shim.service; do
  if systemctl cat "$unit" >/dev/null 2>&1; then
    exec_path="$(systemctl show -p ExecStart --value "$unit" 2>/dev/null | head -1 || true)"
    if [[ "$exec_path" =~ (/[^[:space:]]+arbishield-(prelive-events|serverfn-shim)\.mjs) ]]; then
      source="${SHIM_DIR}/$(basename "${BASH_REMATCH[1]}")"
      cp -f "$source" "${BASH_REMATCH[1]}"
      echo "OK ${BASH_REMATCH[1]}"
    fi
  fi
done

grep -q 'deduction_balance_cents' "${SHIM_DIR}/arbishield-prelive-events.mjs" \
  || die "worker sem crédito no Saldo Reembolso"
grep -q 'fetchProtectionsNeedingCredit' "${SHIM_DIR}/arbishield-prelive-events.mjs" \
  || die "worker sem reparo de liquidações anteriores"

systemctl restart arbishield-prelive-events.service
systemctl restart arbishield-serverfn-shim.service

echo "OK — worker publicado."
echo "Agora reenvie no Admin a liquidação ArbiShield dos jogos já encerrados."
echo "O reparo só credita linhas que ainda não possuem protection_settlement."
