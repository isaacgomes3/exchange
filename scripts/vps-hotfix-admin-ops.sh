#!/usr/bin/env bash
# Hotfix cirúrgico: Lançar Desafio (SPA) + Gestão de Jogos (manual).
# NÃO injeta guard Jogos no index (isso quebra /app). Rode vps-hotfix-unfreeze-site.sh antes.
#
# Uso na VPS (root):
#   Preferir: scripts/vps-hotfix-remover-betbra-api.sh (remove API BetBra)
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/remover-betbra-api-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
SCRIPTS_DIR="${SCRIPTS_DIR:-/opt/arbishield/scripts}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

for cmd in curl systemctl; do
  command -v "$cmd" >/dev/null 2>&1 || die "comando '$cmd' não encontrado"
done

mkdir -p "$SCRIPTS_DIR" "$WEB/assets" "$WEB/v2"

download() { curl -fsSL "$RAW/$1" -o "$2"; }

log "1/4 — assets admin (sem inject BetBra)"
download "deploy/vps-supabase/static/app-boot-fix.js" "$WEB/assets/app-boot-fix.js"
download "deploy/vps-supabase/static/app-stability.js" "$WEB/assets/app-stability.js"
download "deploy/vps-supabase/static/admin-modal-fix.js" "$WEB/assets/admin-modal-fix.js"
download "deploy/vps-supabase/static/admin-jogos-guard.js" "$WEB/assets/admin-jogos-guard.js" || true
chmod 0644 \
  "$WEB/assets/app-boot-fix.js" \
  "$WEB/assets/app-stability.js" \
  "$WEB/assets/admin-modal-fix.js"
rm -f "$WEB/assets/desafio-sugestoes-inject.js" 2>/dev/null || true

log "2/4 — página Gestão de Jogos (lançamento manual)"
download "deploy/vps-supabase/static/admin-jogos-vps.html" "$WEB/admin-jogos-vps.html"
download "deploy/vps-supabase/static/v2/admin-jogos.html" "$WEB/v2/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos-vps.html" "$WEB/v2/admin-jogos.html"

log "3/4 — shim serverFn (salvar desafio no SPA)"
download "scripts/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"

log "4/4 — worker admin :3098 (matches/settle/proteções; sem BetBra)"
download "scripts/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
systemctl disable --now arbishield-desafio-suggestions.service 2>/dev/null || true

if systemctl is-active --quiet arbishield-serverfn-shim.service 2>/dev/null; then
  systemctl restart arbishield-serverfn-shim.service
  log "shim :3101 reiniciado"
else
  echo "AVISO: arbishield-serverfn-shim inativo — suba com vps-stabilize-arbishield.sh" >&2
fi

if systemctl is-active --quiet arbishield-prelive-events.service 2>/dev/null; then
  systemctl restart arbishield-prelive-events.service
  log "prelive :3098 reiniciado"
else
  echo "AVISO: arbishield-prelive-events inativo — suba com vps-stabilize-arbishield.sh" >&2
fi

echo
echo "OK — hotfix admin aplicado (index.html intacto; /app não afetado)"
echo "  Desafios SPA:  https://arbishield.app/admin/desafios"
echo "  Jogos (manual): https://arbishield.app/admin/matches"
echo
echo "Para remoção completa da API BetBra, rode:"
echo "  bash <(curl -fsSL \"$RAW/scripts/vps-hotfix-remover-betbra-api.sh\")"
