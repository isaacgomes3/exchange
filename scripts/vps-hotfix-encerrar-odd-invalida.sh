#!/usr/bin/env bash
# Hotfix: Encerrar partida — "Odd inválida" (prelive antigo sem mode=settle)
#
# Causa: POST /api/arbishield/matches com mode=settle caía em createMatchFromMarket
# e respondia "Odd inválida". Este script atualiza o prelive + UI + nginx match-settle.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-encerrar-odd-invalida-723d/scripts/vps-hotfix-encerrar-odd-invalida.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-encerrar-odd-invalida-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$SCRIPTS_DIR"

log "UI Admin Jogos (canônico — manualLaunchPanel full-page)"
JOGOS_HELPER="$(mktemp)"
curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/manual-evento-escudo-times-bb44/scripts/arbishield-fetch-admin-jogos.sh" -o "$JOGOS_HELPER"
# shellcheck source=/dev/null
source "$JOGOS_HELPER"
arbishield_deploy_admin_jogos_html "$WEB_ROOT" || die "falha ao publicar admin-jogos.html canônico"
rm -f "$JOGOS_HELPER"
grep -q 'mode: "settle"' "$WEB/admin-jogos.html" || die "HTML canônico sem mode settle"

log "Prelive :3098 (settleMatchFromBody)"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
grep -q 'settleMatchFromBody' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem settleMatchFromBody"
grep -q 'looksLikeSettle' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem looksLikeSettle"
systemctl restart arbishield-prelive-events.service 2>/dev/null || true

log "Shim :3101 (match-settle)"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "Nginx match-settle"
for conf in \
  /etc/nginx/conf.d/arbishield-cutover.conf \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/sites-enabled/arbishield \
  /etc/nginx/sites-available/arbishield.app
do
  [[ -f "$conf" ]] || continue
  if ! grep -q 'match-settle' "$conf"; then
    if grep -q 'protection-cancel)' "$conf"; then
      sed -i 's/protection-cancel)/protection-cancel|match-settle)/g' "$conf" || true
      echo "  patched regex $conf"
    fi
  else
    echo "  ok $conf"
  fi
done
if command -v nginx >/dev/null 2>&1; then
  nginx -t && systemctl reload nginx || true
fi

sleep 1
log "Smoke — NÃO pode retornar Odd inválida"
CODE=$(curl -sS -o /tmp/settle-odd.json -w "%{http_code}" -X POST http://127.0.0.1:3098/api/arbishield/matches \
  -H 'Content-Type: application/json' \
  -d '{"mode":"settle","matchId":"00000000-0000-0000-0000-000000000001","outcome":"arbishield","finalScore":"1-0"}' || echo 000)
BODY=$(cat /tmp/settle-odd.json 2>/dev/null || true)
echo "  HTTP $CODE · $BODY"
echo "$BODY" | grep -qi 'odd inválida\|odd invalida' && die "Ainda Odd inválida — prelive não atualizou"
# Espera erro de auth/partida, nunca Odd inválida
echo "$BODY" | grep -Eqi 'autoriz|negado|partida|matchId|token|Login|Acesso' \
  || echo "$BODY" | grep -Eqi 'não encontrado|nao encontrado|not found|obrigat' \
  || [[ "$CODE" == "401" || "$CODE" == "403" || "$CODE" == "400" || "$CODE" == "404" ]] \
  || die "Resposta inesperada no smoke settle"

echo
echo "OK — Encerrar partida"
echo "  https://arbishield.app/admin-jogos.html  (Ctrl+F5)"
echo "  mode=settle agora liquida; não cai mais em criar jogo"
