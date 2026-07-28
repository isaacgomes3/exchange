#!/usr/bin/env bash
# Publica a sincronização visual do Saldo Apostador no dashboard.
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/corrigir-saldo-reembolso-56ab}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"

publish() {
  local name="$1"
  local tmp
  tmp="$(mktemp)"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "${RAW}/deploy/vps-supabase/static/v2/${name}?t=$(date +%s)" -o "$tmp"
  grep -q 'arbishield:balance-updated' "$tmp" \
    || { echo "ERRO: ${name} sem sincronização de saldo" >&2; exit 1; }
  for destination in "${WEB_ROOT}/${name}" "${WEB_ROOT}/v2/${name}"; do
    mkdir -p "$(dirname "$destination")"
    cp -f "$tmp" "$destination"
    chmod 0644 "$destination"
    echo "OK ${destination}"
  done
  rm -f "$tmp"
}

publish "app.html"
publish "v2-shell.js"
echo "OK — recarregue /app.html com Ctrl+Shift+R."
