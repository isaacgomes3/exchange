#!/usr/bin/env bash
# Hotfix VPS: Exchange/PERDEU cobra dedução de verdade (não só audita R$0).
#
# Regra: R$ 0 Reembolso · cobra só dedução · destrava sem devolver
# Marker: settle-exchange-cobra-deducao-v6
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-hotfix-exchange-cobra-deducao-v6.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
MARKER="settle-exchange-cobra-deducao-v6"
CONTRACT_VER="protection-flow-contract-v6"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$SCRIPTS_DIR/lib" "$SHIM_DIR/lib" "$SHIM_DIR/scripts/lib"

download_repo_file() {
  local rel="$1" out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

BK="/opt/arbishield/backups/exchange-cobra-$BUST"
mkdir -p "$BK"

log "1/4 contrato $MARKER"
tmp_c="$(mktemp)"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$tmp_c"
grep -q "$MARKER" "$tmp_c" || die "contrato sem $MARKER"
grep -q 'isExchangeWalletComplete' "$tmp_c" || die "contrato sem isExchangeWalletComplete"
for dest in \
  "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/scripts/lib/protection-flow-contract.mjs"; do
  mkdir -p "$(dirname "$dest")"
  [[ -f "$dest" ]] && cp -a "$dest" "$BK/" 2>/dev/null || true
  cp -f "$tmp_c" "$dest"; chmod 0644 "$dest"; echo "  OK $dest"
done
rm -f "$tmp_c"

log "2/4 prelive :3098"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q "$MARKER" "$tmp_pre" || die "prelive sem $MARKER"
grep -q 'loadExchangeSettlementPrior' "$tmp_pre" || die "prelive sem loadExchangeSettlementPrior"
grep -q 'cobrar dedução' "$tmp_pre" || die "prelive sem fail-hard Exchange"
for dest in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/scripts/arbishield-prelive-events.mjs" \
  /opt/arbishield/scripts/arbishield-prelive-events.mjs \
  /opt/arbishield/arbishield-prelive-events.mjs; do
  mkdir -p "$(dirname "$dest")" 2>/dev/null || true
  [[ -f "$dest" ]] && cp -a "$dest" "$BK/" 2>/dev/null || true
  cp -f "$tmp_pre" "$dest" 2>/dev/null || true
  [[ -f "$dest" ]] && echo "  OK $dest"
done
rm -f "$tmp_pre"

log "3/4 shim :3101"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q "$MARKER" "$tmp_shim" || die "shim sem $MARKER"
grep -q 'loadExchangeSettlementPrior' "$tmp_shim" || die "shim sem loadExchangeSettlementPrior"
cp -f "$tmp_shim" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
echo "  OK shim"
rm -f "$tmp_shim"

log "4/4 admin-jogos hints"
tmp_ui="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/admin-jogos.html" "$tmp_ui"
grep -q 'cobra só a dedução' "$tmp_ui" || die "admin-jogos sem copy Exchange"
n=0
while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-exch-$BUST" 2>/dev/null || true
  cp -f "$tmp_ui" "$f"; chmod 0644 "$f"; echo "  OK $f"; n=$((n+1))
done < <(find /var/www /opt -type f -name 'admin-jogos.html' -print0 2>/dev/null || true)
rm -f "$tmp_ui"
echo "  => $n arquivo(s)"

systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-prelive-events.service 2>/dev/null || true
systemctl restart arbishield-prelive.service 2>/dev/null || true
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart arbishield-serverfn-shim 2>/dev/null || true
  pm2 restart arbishield-prelive-events 2>/dev/null || true
fi
sleep 2
H="$(curl -fsS --max-time 8 http://127.0.0.1:3098/health || true)"
echo "  health :3098 → $H"
echo "$H" | grep -q "$MARKER" || die "health :3098 sem $MARKER"

echo
echo "OK — Exchange agora: R\$ 0 Reembolso · COBRA dedução · destrava sem devolver"
echo "  Marker: $MARKER · $CONTRACT_VER"
echo "  Teste admin: liquidar BATEU EXCHANGE → Apostador cai a dedução; Congelado −stake; Reembolso inalterado"
