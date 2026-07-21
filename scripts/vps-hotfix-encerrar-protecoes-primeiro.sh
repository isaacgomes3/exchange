#!/usr/bin/env bash
# Hotfix: Encerrar partida liquida proteções ANTES de marcar o jogo
#
# Sintoma:
#   "Encerramento bloqueado: existem N proteções LAY e M proteções BACK ainda ativas.
#    Use a liquidação oficial do jogo/mercado."
#
# Causa: trigger no Postgres impede UPDATE matches→settled com proteções ativas.
# O serviço antigo marcava a partida primeiro e falhava antes de liquidar.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-encerrar-protecoes-primeiro-723d/scripts/vps-hotfix-encerrar-protecoes-primeiro.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-encerrar-protecoes-primeiro-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$SHIM_DIR" "$SCRIPTS_DIR"

log "Prelive :3098 (proteções antes da partida)"
# Preferir o path que o systemd realmente usa
PRELIVE_DST="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
if [[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]]; then
  PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
fi
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$PRELIVE_DST"
chmod 0755 "$PRELIVE_DST"
# espelho comum
cp -f "$PRELIVE_DST" "$SCRIPTS_DIR/arbishield-prelive-events.mjs" 2>/dev/null || true
cp -f "$PRELIVE_DST" /opt/arbishield/scripts/arbishield-prelive-events.mjs 2>/dev/null || true
grep -q 'encerrar-protecoes-primeiro-v1' "$PRELIVE_DST" || die "prelive sem fix v1"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true

log "Shim :3101"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'encerrar-protecoes-primeiro-v1' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem fix v1"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "UI Admin Jogos"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
grep -q 'encerrar-protecoes-primeiro\|proteção ainda ativa' "$WEB/admin-jogos.html" || \
  echo "AVISO: UI sem mensagem nova (ok se só backend mudou)"

echo
echo "OK — Encerrar liquida proteções antes da partida (v1)"
echo "  Confirme: curl -s http://127.0.0.1:3098/health | head"
echo "  Depois: Admin → Jogos → Encerrar partida (Ctrl+F5)"
