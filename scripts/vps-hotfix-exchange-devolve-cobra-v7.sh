#!/usr/bin/env bash
# Hotfix VPS: Exchange/PERDEU v7
#   R$ 0 Reembolso · destrava e DEVOLVE stake · cobra dedução + comissão 4,5%
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-hotfix-exchange-devolve-cobra-v7.sh?$(date +%s)" -o /tmp/hf-ex-v7.sh
#   bash /tmp/hf-ex-v7.sh
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
MARKER="settle-exchange-devolve-cobra-v7"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$SCRIPTS_DIR/lib" "$SHIM_DIR/lib" "$SHIM_DIR/scripts/lib"

download_repo_file() {
  local rel="$1" out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

log "1/4 contrato v7"
tmp_c="$(mktemp)"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$tmp_c"
grep -q "$MARKER" "$tmp_c" || die "contrato sem $MARKER"
grep -q 'protection-flow-contract-v7' "$tmp_c" || die "contrato sem v7"
grep -q 'unlockReturnToOrigin: true' "$tmp_c" || die "contrato sem unlockReturnToOrigin"
for dest in \
  "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/scripts/lib/protection-flow-contract.mjs"; do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_c" "$dest"; chmod 0644 "$dest"; echo "  OK $dest"
done
rm -f "$tmp_c"

log "2/4 prelive"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q "$MARKER" "$tmp_pre" || die "prelive sem $MARKER"
grep -q 'needsReturn' "$tmp_pre" || die "prelive sem needsReturn"
for dest in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/scripts/arbishield-prelive-events.mjs" \
  /opt/arbishield/scripts/arbishield-prelive-events.mjs \
  /opt/arbishield/arbishield-prelive-events.mjs; do
  mkdir -p "$(dirname "$dest")" 2>/dev/null || true
  cp -f "$tmp_pre" "$dest" 2>/dev/null || true
  [[ -f "$dest" ]] && echo "  OK $dest"
done
rm -f "$tmp_pre"

log "3/4 shim + admin UI"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q "$MARKER" "$tmp_shim" || die "shim sem $MARKER"
grep -q 'needsReturn' "$tmp_shim" || die "shim sem needsReturn"
cp -f "$tmp_shim" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
rm -f "$tmp_shim"

tmp_ui="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/admin-jogos.html" "$tmp_ui"
n=0
while IFS= read -r -d '' f; do
  cp -f "$tmp_ui" "$f"; chmod 0644 "$f"; n=$((n+1)); echo "  OK $f"
done < <(find /var/www /opt -type f -name 'admin-jogos.html' -print0 2>/dev/null || true)
rm -f "$tmp_ui"
echo "  => $n × admin-jogos.html"

log "4/4 restart"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-prelive-events.service 2>/dev/null || true
systemctl restart arbishield-prelive.service 2>/dev/null || true
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart arbishield-serverfn-shim 2>/dev/null || true
  pm2 restart arbishield-prelive-events 2>/dev/null || true
fi
sleep 1
echo
echo "OK — Exchange/PERDEU v7:"
echo "  · R\$ 0 Reembolso"
echo "  · destrava e DEVOLVE o stake à origem"
echo "  · cobra dedução ArbiShield (lucro − 4,5% − 1,5%)"
echo "  · cobra comissão Exchange 4,5% do lucro"
echo
echo "Ex. LAY R\$1000 @10: devolve R\$1000, cobra R\$80,50 + R\$4,50"
