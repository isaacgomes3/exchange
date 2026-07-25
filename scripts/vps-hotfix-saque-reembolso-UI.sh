#!/usr/bin/env bash
# Atualiza SÓ o JS da carteira para sacar Saldo Reembolso via RPC Postgres.
# Não mexe no shim / nginx. A RPC já precisa existir no banco.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-saque-reembolso-UI.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

echo "==> UI-only saque Saldo Reembolso ($(date -Is))"

tmp="$(mktemp)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/v2-financeiro.js" -o "$tmp"
grep -q 'request_saldo_reembolso_withdrawal' "$tmp" \
  || die "JS baixado sem RPC request_saldo_reembolso_withdrawal"

n=0
while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-reembolso-ui-$(date +%s)" 2>/dev/null || true
  cp -f "$tmp" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
  n=$((n + 1))
done < <(find /var/www -type f -name 'v2-financeiro.js' -print0 2>/dev/null)

mkdir -p "$WEB_ROOT/v2" "$WEB_ROOT"
cp -f "$tmp" "$WEB_ROOT/v2/v2-financeiro.js" 2>/dev/null || true
cp -f "$tmp" "$WEB_ROOT/v2-financeiro.js" 2>/dev/null || true
# raiz comum do site
[[ -d /var/www/arbishield ]] && cp -f "$tmp" /var/www/arbishield/v2-financeiro.js || true
[[ -d /var/www/html ]] && cp -f "$tmp" /var/www/html/v2-financeiro.js 2>/dev/null || true

rm -f "$tmp"

# smoke: produção deve servir o marker
if curl -fsS -m 8 "https://arbishield.app/v2-financeiro.js" 2>/dev/null \
  | grep -q 'request_saldo_reembolso_withdrawal'; then
  echo "  smoke https://arbishield.app/v2-financeiro.js → OK (RPC no JS)"
else
  echo "  AVISO: https://arbishield.app/v2-financeiro.js ainda sem marker (cache/path?)"
  echo "  Arquivos locais atualizados: $n"
fi

echo
echo "OK UI — Ctrl+Shift+R em https://arbishield.app/app-carteira.html e saque de novo"
