#!/usr/bin/env bash
# Reinicia prelive/shim sob stake_lock v10.
# Republica o shim em /opt/arbishield/scripts/ (path do ExecStart do unit).
#
# PREFIRA SHA (jsDelivr cacheia branch):
#   bash <(curl -fsSL "https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@8af363f/scripts/vps-restart-stake-lock-v10.sh")
# Ou API GitHub:
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-restart-stake-lock-v10.sh?ref=main&t=$(date +%s)")
set -euo pipefail

RESTART_VER="restart-stake-lock-v10-shim-scripts-path-20260730b"
REF="${ARBISHIELD_REF:-main}"
BUST="$(date +%s%N)"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
JSDELIVR="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${REF}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
RUNTIME_MARKER="protection-runtime-stake-lock-v10"
MODEL="stake_lock_v1"

die() { echo "ERRO: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p /opt/arbishield/scripts/lib /opt/arbishield/lib

echo "======== $RESTART_VER ========"
echo "  Se NÃO ver esta linha, está no script CACHEADO — use @SHA ou API GitHub"
echo "================================"

download_repo_file() {
  local rel="$1" out="$2"
  local t; t="$(date +%s%N)"
  if curl -fsSL --retry 3 -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" -H "User-Agent: arbishield-restart" \
    "$API/$rel?ref=${REF}&t=$t" -o "$out" && [[ -s "$out" ]]; then
    echo "  baixou via API: $rel"
    return 0
  fi
  if curl -fsSL --retry 3 -H "Cache-Control: no-cache" \
    "$JSDELIVR/$rel?t=$t" -o "$out" && [[ -s "$out" ]]; then
    echo "  baixou via jsDelivr: $rel"
    return 0
  fi
  curl -fsSL --retry 3 -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$t" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
  echo "  baixou via raw: $rel"
}

echo "==> republicar shim + contrato no path do unit (:3101)"
tmp_c="$(mktemp)"
tmp_s="$(mktemp)"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$tmp_c"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_s"
grep -q "$RUNTIME_MARKER" "$tmp_c" || die "contrato sem $RUNTIME_MARKER"
grep -q "$RUNTIME_MARKER" "$tmp_s" || die "shim sem $RUNTIME_MARKER"
grep -q "$MODEL" "$tmp_s" || die "shim sem $MODEL"

for dest in \
  /opt/arbishield/scripts/lib/protection-flow-contract.mjs \
  /opt/arbishield/lib/protection-flow-contract.mjs
do
  mkdir -p "$(dirname "$dest")" 2>/dev/null || true
  cp -f "$tmp_c" "$dest"
  chmod 0644 "$dest"
  echo "  contrato → $dest"
done

for dest in \
  /opt/arbishield/scripts/arbishield-serverfn-shim.mjs \
  /opt/arbishield/arbishield-serverfn-shim.mjs
do
  mkdir -p "$(dirname "$dest")" 2>/dev/null || true
  cp -f "$tmp_s" "$dest"
  chmod 0644 "$dest"
  echo "  shim → $dest"
done
rm -f "$tmp_c" "$tmp_s"

# Confirma disco
UNIT_SHIM="/opt/arbishield/scripts/arbishield-serverfn-shim.mjs"
grep -q "$RUNTIME_MARKER" "$UNIT_SHIM" || die "disco $UNIT_SHIM sem $RUNTIME_MARKER"
echo "  disco OK: $UNIT_SHIM tem $RUNTIME_MARKER"

if systemctl cat arbishield-serverfn-shim.service >/tmp/shim-unit.txt 2>/dev/null; then
  echo "  unit ExecStart:"
  grep -E 'ExecStart=' /tmp/shim-unit.txt || true
fi

echo "==> stop / kill / start :3101 + :3098"
systemctl stop arbishield-serverfn-shim.service 2>/dev/null || true
pkill -f 'arbishield-serverfn-shim\.mjs' 2>/dev/null || true
if command -v fuser >/dev/null 2>&1; then
  fuser -k 3101/tcp 2>/dev/null || true
fi
sleep 1
systemctl start arbishield-serverfn-shim.service 2>/dev/null || \
  systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

systemctl restart arbishield-prelive-events.service 2>/dev/null || true
systemctl restart arbishield-prelive.service 2>/dev/null || true
if pgrep -af 'arbishield-prelive-events\.mjs' >/dev/null 2>&1; then
  pkill -f 'arbishield-prelive-events\.mjs' || true
  sleep 1
  systemctl start arbishield-prelive-events.service 2>/dev/null || \
    systemctl start arbishield-prelive.service 2>/dev/null || true
fi
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart arbishield-serverfn-shim 2>/dev/null || true
  pm2 restart arbishield-prelive-events 2>/dev/null || true
fi

sleep 2
# Mostra quem escuta
echo "  listeners:"
(ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null || true) | grep -E ':3098|:3101' || true
pgrep -af 'arbishield-serverfn-shim|arbishield-prelive' || true

H3098="$(curl -fsS --max-time 8 http://127.0.0.1:3098/health || true)"
H3101="$(curl -fsS --max-time 8 http://127.0.0.1:3101/health || true)"
echo "health :3098 → $H3098"
echo "health :3101 → $H3101"

echo "$H3098" | grep -q "$RUNTIME_MARKER" || die "health :3098 sem $RUNTIME_MARKER"
echo "$H3098" | grep -q "$MODEL" || die "health :3098 sem $MODEL"
echo "$H3101" | grep -q "$RUNTIME_MARKER" || die "health :3101 sem $RUNTIME_MARKER — processo não leu $UNIT_SHIM"
echo "$H3101" | grep -q "$MODEL" || die "health :3101 sem $MODEL"

echo "OK — $RESTART_VER (:3098 + :3101)"
echo "Validar: bash <(curl -fsSL -H 'Accept: application/vnd.github.raw' \"https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-check-pos-deploy-v10.sh?ref=${REF}&t=\$(date +%s)\")"
