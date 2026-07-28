#!/usr/bin/env bash
# Hotfix cirúrgico: Lançar Desafio (SPA) + Próximos jogos (BetBra).
# NÃO injeta guard Jogos no index (isso quebra /app). Rode vps-hotfix-unfreeze-site.sh antes.
#
# Uso na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/admin-ops-fix-723d/scripts/vps-hotfix-unfreeze-site.sh?v=1")
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/admin-ops-fix-723d/scripts/vps-hotfix-admin-ops.sh?v=7")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/admin-ops-fix-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
SCRIPTS_DIR="${SCRIPTS_DIR:-/opt/arbishield/scripts}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

for cmd in curl systemctl; do
  command -v "$cmd" >/dev/null 2>&1 || die "comando '$cmd' não encontrado"
done

mkdir -p "$SCRIPTS_DIR" "$WEB/assets"

download() { curl -fsSL "$RAW/$1" -o "$2"; }

log "1/4 — assets admin (sem guard inline no index)"
download "deploy/vps-supabase/static/app-boot-fix.js" "$WEB/assets/app-boot-fix.js"
download "deploy/vps-supabase/static/app-stability.js" "$WEB/assets/app-stability.js"
download "deploy/vps-supabase/static/admin-modal-fix.js" "$WEB/assets/admin-modal-fix.js"
download "deploy/vps-supabase/static/desafio-sugestoes-inject.js" "$WEB/assets/desafio-sugestoes-inject.js"
chmod 0644 \
  "$WEB/assets/app-boot-fix.js" \
  "$WEB/assets/app-stability.js" \
  "$WEB/assets/admin-modal-fix.js" \
  "$WEB/assets/desafio-sugestoes-inject.js"

log "2/4 — Gestão de Jogos (canônico manualLaunchPanel)"
JOGOS_HELPER="$(mktemp)"
curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/manual-evento-escudo-times-bb44/scripts/arbishield-fetch-admin-jogos.sh" -o "$JOGOS_HELPER"
# shellcheck source=/dev/null
source "$JOGOS_HELPER"
arbishield_deploy_admin_jogos_html "$WEB" || die "falha ao publicar admin-jogos.html canônico"
rm -f "$JOGOS_HELPER"

log "3/4 — shim serverFn (salvar desafio no SPA)"
download "scripts/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"

log "4/4 — worker pré-live :3098 (lista jogos + POST matches)"
download "scripts/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"

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
echo "  Jogos BetBra:  https://arbishield.app/admin/matches  (F5 direto; menu SPA após guard separado)"
echo
echo "Se /app ainda congelar, rode primeiro:"
echo "  bash <(curl -fsSL \"$RAW/scripts/vps-hotfix-unfreeze-site.sh?v=1\")"
