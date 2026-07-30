#!/usr/bin/env bash
# Hotfix VPS: LAY lucro fee = responsabilidade / odd (v8)
# Ex.: 1000 @10 = 100 → cliente 15 · Exchange 4,50 · ArbiShield 80,50
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-hotfix-lay-lucro-sobre-odd-v8.sh?$(date +%s)" -o /tmp/hf-lay-v8.sh
#   bash /tmp/hf-lay-v8.sh
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
MARKER="lay-lucro-responsabilidade-sobre-odd-v8"

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

log "1/5 contrato v8"
tmp_c="$(mktemp)"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$tmp_c"
grep -q "$MARKER" "$tmp_c" || die "contrato sem $MARKER"
grep -q 'protection-flow-contract-v8' "$tmp_c" || die "contrato sem v8"
for dest in \
  "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/scripts/lib/protection-flow-contract.mjs"; do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_c" "$dest"; chmod 0644 "$dest"; echo "  OK $dest"
done
rm -f "$tmp_c"

log "2/5 prelive"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
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

log "3/5 shim"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q "$MARKER\|Math.round(stake / odd)" "$tmp_shim" || die "shim sem LAY resp/odd"
cp -f "$tmp_shim" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
rm -f "$tmp_shim"

log "4/5 UI"
for pair in \
  "deploy/vps-supabase/static/v2/app-proteger.html:app-proteger.html" \
  "deploy/vps-supabase/static/v2/app-protecoes.html:app-protecoes.html" \
  "deploy/vps-supabase/static/v2/proteger-preview-fix.js:proteger-preview-fix.js"
do
  rel="${pair%%:*}"; name="${pair##*:}"
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  n=0
  while IFS= read -r -d '' f; do
    cp -f "$tmp" "$f"; chmod 0644 "$f"; n=$((n+1)); echo "  OK $f"
  done < <(find /var/www /opt -type f -name "$name" -print0 2>/dev/null || true)
  rm -f "$tmp"
  echo "  => $n × $name"
done

log "5/5 restart"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-prelive-events.service 2>/dev/null || true
systemctl restart arbishield-prelive.service 2>/dev/null || true
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart arbishield-serverfn-shim 2>/dev/null || true
  pm2 restart arbishield-prelive-events 2>/dev/null || true
fi
sleep 1
echo
echo "OK — LAY lucro = responsabilidade / odd (v8):"
echo "  · Ex. R\$1000 @10 → lucro R\$100"
echo "  · Cliente R\$15,00 · Exchange R\$4,50 · ArbiShield R\$80,50"
echo "  · Marker: $MARKER"
