#!/usr/bin/env bash
# Auditoria: migração dos dados de perfil (site antigo → Meu Perfil v2)
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/verificar-migracao-perfil-723d/scripts/vps-audit-profiles-migration.sh" -o /tmp/audit-perfil.sh
#   bash /tmp/audit-perfil.sh
#
# Opcional (reescrever URLs de foto do Cloud antigo):
#   FIX_AVATAR_URLS=1 bash /tmp/audit-perfil.sh
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/verificar-migracao-perfil-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

log "1/2 — baixar auditoria"
curl -fsSL "$RAW/scripts/vps-audit-profiles-migration.mjs" -o "$SCRIPTS_DIR/vps-audit-profiles-migration.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-audit-profiles-migration.mjs"

log "2/2 — executar"
export PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://arbishield.app}"
export FIX_AVATAR_URLS="${FIX_AVATAR_URLS:-0}"
if ! command -v node >/dev/null 2>&1; then
  die "node não encontrado na VPS"
fi
node "$SCRIPTS_DIR/vps-audit-profiles-migration.mjs"
