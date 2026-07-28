#!/usr/bin/env bash
# Publica o Centro Financeiro com o render do Saldo Reembolso.
#
# Na VPS:
#   ARBISHIELD_REF=cursor/corrigir-saldo-reembolso-56ab \
#     bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/corrigir-saldo-reembolso-56ab/scripts/vps-hotfix-saldo-reembolso-render.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/corrigir-saldo-reembolso-56ab}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="${WEB_ROOT}/v2"

die() {
  echo "ERRO: $*" >&2
  exit 1
}

publish() {
  local name="$1"
  local tmp
  tmp="$(mktemp)"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "${RAW}/deploy/vps-supabase/static/v2/${name}?t=$(date +%s)" -o "$tmp"
  [[ -s "$tmp" ]] || die "download vazio: ${name}"

  for destination in "${WEB_ROOT}/${name}" "${WEB}/${name}"; do
    mkdir -p "$(dirname "$destination")"
    cp -a "$destination" "${destination}.bak-saldo-reembolso-$(date +%s)" \
      2>/dev/null || true
    cp -f "$tmp" "$destination"
    chmod 0644 "$destination"
    echo "OK ${destination}"
  done
  rm -f "$tmp"
}

publish "app-carteira.html"
publish "v2-financeiro.js"

grep -q 'finBalDeduction' "${WEB}/v2-financeiro.js" \
  || die "v2-financeiro.js sem render do Saldo Reembolso"
grep -q 'saldo-reembolso-render-2' "${WEB}/app-carteira.html" \
  || die "app-carteira.html sem versão de cache atualizada"

echo "OK — Saldo Reembolso publicado. Reabra /app-carteira.html."
