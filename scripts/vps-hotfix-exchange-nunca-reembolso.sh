#!/usr/bin/env bash
# Exchange / PERDEU nunca credita Saldo Reembolso (fee_upfront + legado).
#
# Contrato v3 + guarda no settle (prelive/shim) + UI Minhas Proteções.
#
# Na VPS:
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-exchange-nunca-reembolso.sh?ref=cursor/fix-reembolso-lucas-perdeu-723d&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
MARKER="settle-exchange-nunca-reembolso-v1"
CONTRACT_VER="protection-flow-contract-v3"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR/lib" "$SHIM_DIR/lib" "$SHIM_DIR/scripts/lib"

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

log "1/4 contrato $CONTRACT_VER ($MARKER)"
tmp_c="$(mktemp)"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$tmp_c"
grep -q "$CONTRACT_VER" "$tmp_c" || die "contrato sem $CONTRACT_VER"
grep -q "$MARKER" "$tmp_c" || die "contrato sem $MARKER"
# Regressão: Exchange legado NÃO pode mais devolver stake−taxa
if grep -qE 'amount - keep|stake − taxa|stake - taxa' "$tmp_c"; then
  die "contrato ainda credita Exchange legado (stake-taxa)"
fi
for dest in \
  "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/scripts/lib/protection-flow-contract.mjs"; do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_c" "$dest"
  chmod 0644 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_c"

log "2/4 shim :3101 ($MARKER)"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q "$MARKER" "$tmp_shim" || die "shim sem $MARKER"
grep -q 'exchangeNoCredit' "$tmp_shim" || die "shim sem exchangeNoCredit"
cp -f "$tmp_shim" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
echo "  OK $SHIM_DIR/arbishield-serverfn-shim.mjs"
rm -f "$tmp_shim"

log "3/4 prelive :3098 ($MARKER)"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q "$MARKER" "$tmp_pre" || die "prelive sem $MARKER"
grep -q 'exchangeNoCredit' "$tmp_pre" || die "prelive sem exchangeNoCredit"
for dest in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/scripts/arbishield-prelive-events.mjs" \
  /opt/arbishield/scripts/arbishield-prelive-events.mjs; do
  mkdir -p "$(dirname "$dest")" 2>/dev/null || true
  cp -f "$tmp_pre" "$dest" 2>/dev/null || true
  [[ -f "$dest" ]] && echo "  OK $dest"
done
rm -f "$tmp_pre"

log "4/4 UI Minhas Proteções"
tmp_ui="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-protecoes.html" "$tmp_ui"
grep -q "$MARKER" "$tmp_ui" || die "app-protecoes sem $MARKER"
cp -f "$tmp_ui" "$WEB/app-protecoes.html"
cp -f "$tmp_ui" "$WEB_ROOT/app-protecoes.html" 2>/dev/null || true
while IFS= read -r -d '' f; do
  cp -f "$tmp_ui" "$f"
done < <(find /var/www -type f -name 'app-protecoes.html' -print0 2>/dev/null || true)
rm -f "$tmp_ui"
echo "  OK app-protecoes.html"

log "Reiniciar serviços"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-prelive-events.service 2>/dev/null || true
systemctl restart arbishield-prelive.service 2>/dev/null || true
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart arbishield-serverfn-shim 2>/dev/null || true
  pm2 restart arbishield-prelive-events 2>/dev/null || true
fi
if pgrep -af 'arbishield-prelive-events\.mjs' >/dev/null 2>&1; then
  pkill -f 'arbishield-prelive-events\.mjs' || true
fi
if pgrep -af 'arbishield-serverfn-shim\.mjs' >/dev/null 2>&1; then
  pkill -f 'arbishield-serverfn-shim\.mjs' || true
fi

echo
echo "OK — Exchange/PERDEU nunca credita Saldo Reembolso"
echo "  Markers: $CONTRACT_VER · $MARKER"
echo "  curl -s http://127.0.0.1:3098/health"
echo "  curl -s http://127.0.0.1:3101/health"
echo "  https://arbishield.app/v2/app-protecoes.html  (Ctrl+F5)"
echo "  Teste: liquidar BATEU EXCHANGE → deduction_balance_cents NÃO sobe"
