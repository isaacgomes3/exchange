#!/usr/bin/env bash
# Dashboard: receita do dia = deducao cobrada no ato da protecao (fee_upfront).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-dashboard-receita-deducao.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
MARKER="dashboard-kpis-v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SHIM_DIR"

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

log "1/2 shim ($MARKER)"
tmp="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp"
cp -f "$tmp" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
# espelho comum
cp -f "$tmp" /opt/arbishield/scripts/arbishield-serverfn-shim.mjs 2>/dev/null || true
rm -f "$tmp"

grep -q "$MARKER" "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem $MARKER"
grep -q 'fee_upfront_on_charge_v2' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem fee_upfront_on_charge_v2"
grep -q 'todayProtectionCharged' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem todayProtectionCharged"

systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim-teste.service 2>/dev/null || true
log "restart shim"

log "2/2 UI admin.html"
tmp="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/admin.html" "$tmp"
cp -f "$tmp" "$WEB/admin.html"
cp -f "$tmp" "$WEB_ROOT/admin.html" 2>/dev/null || true
chmod 0644 "$WEB/admin.html"
rm -f "$tmp"
grep -q "$MARKER\|dashboard-kpis-v2" "$WEB/admin.html" || die "admin.html sem marker v2"
grep -q 'todayProtectionCharged\|deducoes cobradas\|deduções cobradas' "$WEB/admin.html" \
  || die "admin.html sem copy deducoes"

sleep 1
H="$(curl -fsS -m 8 http://127.0.0.1:3101/health 2>/dev/null || true)"
if echo "$H" | grep -qi shim; then
  log "health shim OK"
else
  log "aviso: health :3101 nao confirmou (ok se path diferente)"
fi

log "OK - Ctrl+Shift+R em /v2/admin.html"
log "Receita do dia passa a somar deducao cobrada no ato da protecao"
