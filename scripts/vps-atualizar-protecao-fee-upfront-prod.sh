#!/usr/bin/env bash
# ATUALIZA PRODUÇÃO: fee_upfront_v1 (API :3098 + UI /app-proteger.html)
#
# - Proteções JÁ ATIVAS (legado) continuam liquidando no modelo antigo
# - Só proteções NOVAS usam cobrança na criação
# - LAY converte odd → back L/(L−1)
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-fee-upfront-3cf9/scripts/vps-atualizar-protecao-fee-upfront-prod.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-fee-upfront-3cf9}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
WEB_V2="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
SANDBOX_WEB="${ARBISHIELD_SANDBOX_WEB:-/var/www/arbishield/sandbox}"
TS="$(date +%s)"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need systemctl
need python3
[[ "$(id -u)" -eq 0 ]] || die "rode como root"

# Localiza prelive de produção (path varia entre VPS)
PRELIVE_DST=""
for c in \
  /opt/arbishield/scripts/arbishield-prelive-events.mjs \
  /opt/arbishield/arbishield-prelive-events.mjs \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
do
  if [[ -f "$c" ]]; then PRELIVE_DST="$c"; break; fi
done
if [[ -z "$PRELIVE_DST" ]]; then
  mkdir -p /opt/arbishield/scripts
  PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
fi
SCRIPTS_DIR="$(dirname "$PRELIVE_DST")"
mkdir -p "$SCRIPTS_DIR" "$WEB_V2" "$SANDBOX_WEB"

# Backup rápido
BK="/opt/arbishield/backups/fee-upfront-$TS"
mkdir -p "$BK"
cp -a "$PRELIVE_DST" "$BK/" 2>/dev/null || true
[[ -f "$WEB_V2/app-proteger.html" ]] && \
  cp -a "$WEB_V2/app-proteger.html" "$BK/" || true
log "Backup → $BK"
log "Prelive dst → $PRELIVE_DST"

log "1) API produção :3098 (prelive fee_upfront)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-prelive-events.mjs?v=$TS" \
  -o "$PRELIVE_DST"
chmod 0755 "$PRELIVE_DST"
# espelha nos paths comuns
cp -f "$PRELIVE_DST" /opt/arbishield/scripts/arbishield-prelive-events.mjs 2>/dev/null || true
cp -f "$PRELIVE_DST" /opt/arbishield/arbishield-prelive-events.mjs 2>/dev/null || true
grep -q 'fee_upfront_v1' "$PRELIVE_DST" || die "prelive sem fee_upfront_v1"
grep -q 'isFeeUpfrontProtection' "$PRELIVE_DST" || die "prelive sem dual-path legado/fee_upfront"
grep -q 'layToBackOdd' "$PRELIVE_DST" || die "prelive sem layToBackOdd"
grep -qE 'protection-fee-upfront-v[0-9]+' "$PRELIVE_DST" || die "prelive sem marker health"

systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || \
  die "não consegui reiniciar arbishield-prelive-events"
sleep 1
BODY="$(curl -fsS --max-time 8 http://127.0.0.1:3098/health || true)"
echo "$BODY" | grep -qE 'protection-fee-upfront-v[0-9]+' \
  || die "health :3098 sem fee_upfront: $BODY"
log "health :3098 OK → $BODY"

log "2) UI produção app-proteger.html"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/app-proteger.html?v=$TS" \
  -o "$WEB_V2/app-proteger.html"
grep -q 'lucroBruto' "$WEB_V2/app-proteger.html" \
  || die "UI sem lucroBruto"
grep -q 'layToBackOdd\|layOdd / (layOdd - 1)' "$WEB_V2/app-proteger.html" \
  || die "UI sem conversão LAY→back"
# cache bust
sed -i "s/?v=[^\"']*/?v=fee-upfront-prod-$TS/g" "$WEB_V2/app-proteger.html" || true

# Publica também em qualquer outra cópia sob /var/www/arbishield
while IFS= read -r f; do
  [[ "$f" == "$WEB_V2/app-proteger.html" ]] && continue
  cp -f "$WEB_V2/app-proteger.html" "$f"
  echo "  copiado → $f"
done < <(find /var/www/arbishield -type f -name 'app-proteger.html' 2>/dev/null || true)

log "3) Override preview inline (garante retorno/dedução no DOM)"
curl -fsSL --retry 3 \
  "$RAW/scripts/vps-fix-preview-proteger-agora.sh?v=$TS" \
  -o "$SCRIPTS_DIR/vps-fix-preview-proteger-agora.sh"
chmod 0755 "$SCRIPTS_DIR/vps-fix-preview-proteger-agora.sh"
bash "$SCRIPTS_DIR/vps-fix-preview-proteger-agora.sh" || {
  echo "AVISO: fix-preview retornou erro — UI base já está publicada" >&2
}

log "4) Sandbox alinhado (opcional, não quebra prod)"
if [[ -d /opt/arbishield-teste/scripts ]]; then
  cp -f "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
    /opt/arbishield-teste/scripts/arbishield-prelive-events.mjs
  if systemctl list-unit-files 2>/dev/null | grep -q 'arbishield-prelive-events-teste'; then
    systemctl restart arbishield-prelive-events-teste.service || true
  fi
fi
if [[ -d "$SANDBOX_WEB" ]]; then
  cp -f "$WEB_V2/app-proteger.html" "$SANDBOX_WEB/app-proteger.html"
  python3 - "$SANDBOX_WEB/app-proteger.html" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
t = p.read_text(encoding="utf-8", errors="replace")
t = t.replace('"/api/arbishield/', '"/__sandbox_api/arbishield/')
t = t.replace("'/api/arbishield/", "'/__sandbox_api/arbishield/")
p.write_text(t, encoding="utf-8")
print("  sandbox api rewrite")
PY
fi

command -v nginx >/dev/null && nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true

echo
echo "======== VERIFICAÇÃO ========"
H=$(curl -fsS --max-time 5 http://127.0.0.1:3098/health || true)
echo "  health :3098 = $H"
PUB=$(curl -fsS "https://arbishield.app/app-proteger.html?v=$TS" | grep -c 'lucroBruto' || true)
echo "  HTML público lucroBruto=$PUB"
echo "$H" | grep -qE 'protection-fee-upfront-v[0-9]+' || die "produção sem marker"
[[ "$PUB" -ge 1 ]] || echo "AVISO: HTML público ainda sem lucroBruto (cache?) — use janela anônima"

echo
echo "OK — PRODUÇÃO atualizada (fee_upfront)"
echo "  Backup: $BK"
echo "  Abrir: https://arbishield.app/app-proteger.html?v=$TS"
echo "  Legado ativo: settle continua no modelo antigo"
echo "  Novo: cobra dedução na criação (LAY→back equiv.)"
echo
echo "Opcional — reviver evento teste:"
echo "  bash <(curl -fsSL \"$RAW/scripts/vps-sandbox-lancar-evento-teste.sh?v=$TS\")"
