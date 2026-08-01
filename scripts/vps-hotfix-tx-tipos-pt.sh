#!/usr/bin/env bash
# Hotfix VPS: tipos de transação em português (Dashboard + Gestão de Transações).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-hotfix-tx-tipos-pt.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
TS="$(date +%s)"

echo "==> vps-hotfix-tx-tipos-pt.sh ($(date -Is)) REF=$REF"
[[ "$(id -u)" -eq 0 ]] || { echo "ERRO: rode como root" >&2; exit 1; }

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

fetch() {
  local remote="$1" out="$tmpdir/$1"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "$RAW/deploy/vps-supabase/static/v2/${remote}?t=${TS}" -o "$out"
  echo "  baixado $remote"
}

publish_name() {
  local src="$1" name="$2" n=0
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-tx-pt-${TS}" 2>/dev/null || true
    cp -f "$src" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
    n=$((n + 1))
  done < <(find /var/www /opt -type f -name "$name" -print0 2>/dev/null)
  echo "  => $n × $name"
}

fetch admin.html
fetch admin-transactions.html
fetch v2-pages.js

grep -q 'txTypeLabel' "$tmpdir/admin.html" || { echo "ERRO: admin.html sem txTypeLabel"; exit 1; }
grep -q 'Reembolso de proteção' "$tmpdir/v2-pages.js" || { echo "ERRO: v2-pages.js sem labels PT"; exit 1; }

publish_name "$tmpdir/admin.html" "admin.html"
publish_name "$tmpdir/admin-transactions.html" "admin-transactions.html"
publish_name "$tmpdir/v2-pages.js" "v2-pages.js"

command -v nginx >/dev/null 2>&1 && nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true

echo "Pronto. Ctrl+Shift+R no Dashboard e em Gestão de Transações."
echo "  protection_fee → Taxa de proteção"
echo "  protection_settlement → Liquidação de proteção"
echo "  admin_adjustment → Ajuste administrativo"
echo "  internal_transfer → Transferência interna"
echo "  protection_refund → Reembolso de proteção"
