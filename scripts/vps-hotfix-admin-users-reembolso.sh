#!/usr/bin/env bash
# Admin Usuários: exibir Saldo Reembolso (deduction_balance_cents).
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT"

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

log "1/1 admin-users.html"
tmp_html="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/admin-users.html" "$tmp_html"
grep -q 'admin-users-reembolso-v1' "$tmp_html" || die "sem marker admin-users-reembolso-v1"
grep -q 'deduction_balance_cents' "$tmp_html" || die "sem deduction_balance_cents"
grep -q 'Saldo Reembolso' "$tmp_html" || die "sem label Saldo Reembolso"
grep -q 'l: "Reembolso"' "$tmp_html" || die "sem linha Reembolso na lista"

while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-reembolso-$(date +%s)" 2>/dev/null || true
  cp -f "$tmp_html" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
done < <(find /var/www -type f -name 'admin-users.html' -print0 2>/dev/null || true)
for f in "$WEB/admin-users.html" "$WEB_ROOT/admin-users.html"; do
  mkdir -p "$(dirname "$f")" 2>/dev/null || true
  [[ -d "$(dirname "$f")" ]] || continue
  cp -f "$tmp_html" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
done
rm -f "$tmp_html"

log "OK — Ctrl+Shift+R em /admin-users.html"
echo "  Lista e drawer passam a mostrar Reembolso (deduction_balance_cents)."
