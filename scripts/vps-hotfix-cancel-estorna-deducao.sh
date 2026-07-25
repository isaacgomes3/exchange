#!/usr/bin/env bash
# Cancelamento fee_upfront: estorna a DEDUÇÃO ArbiShield + botão Cancelar abaixo de Contestar
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-fee-upfront-3cf9/scripts/vps-hotfix-cancel-estorna-deducao.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-fee-upfront-3cf9}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
TS="$(date +%s)"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need systemctl

PRELIVE=""
for c in \
  /opt/arbishield/scripts/arbishield-prelive-events.mjs \
  /opt/arbishield/arbishield-prelive-events.mjs
do
  [[ -f "$c" ]] && PRELIVE="$c" && break
done
[[ -n "$PRELIVE" ]] || die "prelive não encontrado"

log "1) API prelive (cancel estorna dedução)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-prelive-events.mjs?v=$TS" -o "$PRELIVE"
chmod 0755 "$PRELIVE"
cp -f "$PRELIVE" /opt/arbishield/scripts/arbishield-prelive-events.mjs 2>/dev/null || true
grep -q 'refund_kind' "$PRELIVE" || die "prelive sem refund_kind"
grep -q 'fee_charged_cents' "$PRELIVE" || die "prelive sem fee_charged_cents no cancel"
grep -qE 'protection-fee-upfront-v[0-9]+' "$PRELIVE" || die "sem marker health"

systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || \
  die "falha ao reiniciar prelive"
sleep 1
H="$(curl -fsS --max-time 5 http://127.0.0.1:3098/health || true)"
echo "$H" | grep -qE 'protection-fee-upfront-v[0-9]+' || die "health sem fee_upfront: $H"
log "health OK → $H"

# Sandbox worker, se existir
if [[ -f /opt/arbishield-teste/scripts/arbishield-prelive-events.mjs ]]; then
  cp -f "$PRELIVE" /opt/arbishield-teste/scripts/arbishield-prelive-events.mjs
  systemctl restart arbishield-prelive-events-teste.service 2>/dev/null || true
fi

log "2) UI Minhas Proteções (Cancelar abaixo de Contestar)"
for dest in \
  /var/www/arbishield/v2/app-protecoes.html \
  /var/www/arbishield/sandbox/app-protecoes.html
do
  dir="$(dirname "$dest")"
  [[ -d "$dir" ]] || continue
  curl -fsSL --retry 3 "$RAW/deploy/vps-supabase/static/v2/app-protecoes.html?v=$TS" -o "$dest"
  sed -i "s/?v=[^\"']*/?v=cancel-fee-$TS/g" "$dest" || true
  grep -q 'btnCancelProt' "$dest" || die "$dest sem btnCancelProt"
  grep -q 'isVisibleProtection\|neq("status", "cancelled")' "$dest" \
    || die "$dest ainda lista canceladas"
  echo "  OK $dest"
done

# sandbox api rewrite se necessário
if [[ -f /var/www/arbishield/sandbox/app-protecoes.html ]]; then
  python3 - <<'PY'
from pathlib import Path
p = Path("/var/www/arbishield/sandbox/app-protecoes.html")
t = p.read_text(encoding="utf-8", errors="replace")
t = t.replace('"/api/arbishield/', '"/__sandbox_api/arbishield/')
t = t.replace("'/api/arbishield/", "'/__sandbox_api/arbishield/")
p.write_text(t, encoding="utf-8")
print("  sandbox api rewrite")
PY
fi

log "3) Reparar cancelamentos fee_upfront que não estornaram a dedução"
curl -fsSL --retry 3 \
  "$RAW/scripts/vps-reparar-cancel-fee-upfront.mjs?v=$TS" \
  -o /opt/arbishield/scripts/vps-reparar-cancel-fee-upfront.mjs
FIX=1 node /opt/arbishield/scripts/vps-reparar-cancel-fee-upfront.mjs || {
  echo "AVISO: reparo retornou erro (pode não haver casos)" >&2
}

echo
echo "OK — cancelamento estorna dedução ArbiShield"
echo "  https://arbishield.app/app-protecoes.html?v=$TS"
echo "  Botões: Contestar (cima) · Cancelar (baixo)"
