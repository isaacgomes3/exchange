#!/usr/bin/env bash
# Hotfix: Encerrar partida — proteções primeiro + sem coluna updated_at
#
# Sintomas:
#   1) "Encerramento bloqueado: existem N proteções LAY…"
#   2) "Could not find the 'updated_at' column of 'protections'"
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-encerrar-protecoes-primeiro-723d/scripts/vps-hotfix-encerrar-protecoes-primeiro.sh?v=2")
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

log "Prelive :3098 (v2 — sem updated_at em protections)"
PRELIVE_DST="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
if [[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]]; then
  PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
fi
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$PRELIVE_DST"
chmod 0755 "$PRELIVE_DST"
cp -f "$PRELIVE_DST" "$SCRIPTS_DIR/arbishield-prelive-events.mjs" 2>/dev/null || true
cp -f "$PRELIVE_DST" /opt/arbishield/scripts/arbishield-prelive-events.mjs 2>/dev/null || true
grep -q 'encerrar-protecoes-primeiro-v2' "$PRELIVE_DST" || die "prelive sem fix v2"
# garante que o PATCH de proteção não exige updated_at no 1º attempt
if grep -n 'settleOneProtectionRow\|updated_at: now' "$PRELIVE_DST" | grep -A2 'settled_outcome' | grep -q 'updated_at'; then
  echo "AVISO: ainda há updated_at junto de settled_outcome — conferir manualmente"
fi
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true

log "Shim :3101"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'encerrar-protecoes-primeiro-v2' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem fix v2"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "UI Admin Jogos"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html" 2>/dev/null || true
chmod 0644 "$WEB/admin-jogos.html" 2>/dev/null || true
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true

echo
echo "OK — Encerrar v2 (proteções primeiro, sem updated_at)"
echo "  curl -s http://127.0.0.1:3098/health   # deve trazer encerrar-protecoes-primeiro-v2"
echo "  Depois: Admin → Jogos → Encerrar partida"
