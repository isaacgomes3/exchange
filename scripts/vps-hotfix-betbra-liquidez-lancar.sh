#!/usr/bin/env bash
# Liquidez no lançamento BetBra + barra/valor utilizado na lista ADM (igual cliente).
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/betbra-liquidez-antes-lancar-723d/scripts/vps-hotfix-betbra-liquidez-lancar.sh?v=4" -o /tmp/hotfix-liq.sh
#   bash /tmp/hotfix-liq.sh
#   # ou por SHA (evita cache):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-betbra-liquidez-lancar.sh" -o /tmp/hotfix-liq.sh && bash /tmp/hotfix-liq.sh
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/betbra-liquidez-antes-lancar-723d}"
# ARBISHIELD_REF=sha|branch opcional; default = branch
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$WEB" "$SHIM_DIR" "$SCRIPTS_DIR"

echo "==> UI admin-jogos.html (ref=$REF)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
# também em paths comuns do nginx
for alt in "$WEB_ROOT/v2/admin-jogos.html" /var/www/html/v2/admin-jogos.html; do
  [[ "$alt" == "$WEB/admin-jogos.html" ]] && continue
  dir="$(dirname "$alt")"
  [[ -d "$dir" ]] || continue
  cp -f "$WEB/admin-jogos.html" "$alt" 2>/dev/null || true
done
bytes="$(wc -c < "$WEB/admin-jogos.html" | tr -d ' ')"
echo "  bytes=$bytes"
grep -q 'preliveLiquidityBrl' "$WEB/admin-jogos.html" || { echo "ERRO: sem campo liquidez acima da lista"; exit 1; }
grep -q 'btnConfirmPreliveLiq' "$WEB/admin-jogos.html" || { echo "ERRO: sem botão Confirmar liquidez"; exit 1; }
grep -q 'liquidityCents' "$WEB/admin-jogos.html" || { echo "ERRO: sem liquidityCents no payload"; exit 1; }
# greps separados (BusyBox/grep antigo quebra em \|)
grep -q 'adm-liq-bar' "$WEB/admin-jogos.html" || { echo "ERRO: sem adm-liq-bar"; exit 1; }
grep -q 'function liqStats' "$WEB/admin-jogos.html" || { echo "ERRO: sem liqStats"; exit 1; }
# "Só seleções com odd" NÃO deve vir marcado
if grep -q 'id="onlyWithOdds"[[:space:]]*checked' "$WEB/admin-jogos.html"; then
  echo "ERRO: onlyWithOdds ainda vem marcado por padrão"
  exit 1
fi
echo "  ok preliveLiquidityBrl + checkbox desmarcado + barra ADM"

echo "==> prelive createMatchFromMarket"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SHIM_DIR/arbishield-prelive-events.mjs"
chmod 0644 "$SHIM_DIR/arbishield-prelive-events.mjs"
cp -f "$SHIM_DIR/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-prelive-events.mjs" 2>/dev/null || true
grep -q 'liquidity_brl' "$SHIM_DIR/arbishield-prelive-events.mjs" || echo "AVISO: prelive sem liquidity_brl"

for u in arbishield-prelive-events.service; do
  if systemctl cat "$u" >/dev/null 2>&1; then
    exec="$(systemctl show -p ExecStart --value "$u" 2>/dev/null | head -1 || true)"
    if [[ "$exec" =~ (/[^[:space:]]+arbishield-prelive-events\.mjs) ]]; then
      cp -f "$SHIM_DIR/arbishield-prelive-events.mjs" "${BASH_REMATCH[1]}"
      echo "  wrote ${BASH_REMATCH[1]}"
    fi
  fi
done
systemctl restart arbishield-prelive-events.service 2>/dev/null || echo "AVISO: não reiniciou prelive"

echo "OK — Ctrl+Shift+R em https://arbishield.app/admin-jogos.html"
echo "1) Liquidez: campo acima de 'Próximos jogos (BetBra)'"
echo "2) 'Só seleções com odd' vem desmarcado"
echo "3) Lista ADM: barra + disponível + 'usado X de Y'"
