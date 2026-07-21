#!/usr/bin/env bash
# Restaura o frontend inicial publicado na VPS (SPA /app + /admin via espelho).
#
# Ordem de recuperação:
#   1) Backup local (.bak-stabilize, tar em /opt/arbishield/backups)
#   2) Espelho já na VPS (/opt/arbishield/arbishield-local)
#   3) Novo download de arbishield.app + cutover (último recurso)
#
# Depois aplica nginx híbrido + workers admin (estabilize).
#
# Uso na VPS (root):
#   bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-restore-initial-frontend.sh)
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/consolidate-arbishield-app-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
APP_DIR="${APP_DIR:-/opt/arbishield/app}"
SCRIPTS_DIR="${SCRIPTS_DIR:-/opt/arbishield/scripts}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"
BACKUP_DIR="${BACKUP_DIR:-/opt/arbishield/backups}"
ENV_FILE="${ENV_FILE:-/opt/arbishield/deploy/vps-supabase/.env}"
PUBLIC_URL="${PUBLIC_URL:-https://arbishield.app}"
LOCAL_MIRROR="${ARBISHIELD_SRC:-/opt/arbishield/arbishield-local}"

log() { echo "==> $*"; }
warn() { echo "AVISO: $*" >&2; }
die() { echo "ERRO: $*" >&2; exit 1; }

need curl node python3 rsync tar
mkdir -p "$SCRIPTS_DIR" "$WEB" "$BACKUP_DIR" "$(dirname "$APP_DIR")"

download() { curl -fsSL "$RAW/$1" -o "$2"; }

log "Backup de segurança do www atual"
STAMP="$(date +%Y%m%d-%H%M%S)"
tar czf "$BACKUP_DIR/www-before-restore-$STAMP.tar.gz" -C "$(dirname "$WEB")" "$(basename "$WEB")" 2>/dev/null || true
echo "    salvo: $BACKUP_DIR/www-before-restore-$STAMP.tar.gz"

log "Baixando scripts de restauração"
download "scripts/mirror-arbishield-app.mjs" "$SCRIPTS_DIR/mirror-arbishield-app.mjs"
download "scripts/arbishield-cutover-frontend.sh" "$SCRIPTS_DIR/arbishield-cutover-frontend.sh"
download "scripts/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
download "scripts/vps-stabilize-arbishield.sh" "$SCRIPTS_DIR/vps-stabilize-arbishield.sh"
chmod +x "$SCRIPTS_DIR"/*.sh "$SCRIPTS_DIR"/*.mjs 2>/dev/null || true

restored=0

try_restore_bak() {
  if [[ -f "$WEB/index.html.bak-stabilize" ]]; then
    log "Restaurando index.html.bak-stabilize"
    cp -a "$WEB/index.html.bak-stabilize" "$WEB/index.html"
    restored=1
    return 0
  fi
  if [[ -f "$WEB/index.html.bak" ]]; then
    log "Restaurando index.html.bak"
    cp -a "$WEB/index.html.bak" "$WEB/index.html"
    restored=1
    return 0
  fi
  return 1
}

try_restore_tar() {
  local latest
  latest="$(ls -t "$BACKUP_DIR"/www-before-restore-*.tar.gz "$BACKUP_DIR"/www-*.tar.gz 2>/dev/null | head -1 || true)"
  [[ -n "$latest" ]] || return 1
  log "Restaurando tarball: $latest"
  tar xzf "$latest" -C "$(dirname "$WEB")" --strip-components=0 2>/dev/null || \
    tar xzf "$latest" -C / 2>/dev/null || return 1
  restored=1
}

try_cutover_from_mirror() {
  local src="$1"
  [[ -d "$src/assets" && -f "$src/index.html" ]] || return 1
  ANON="$(grep '^ANON_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
  [[ -n "$ANON" ]] || die "ANON_KEY ausente em $ENV_FILE"
  log "Cutover espelho → $WEB (API $PUBLIC_URL)"
  export ARBISHIELD_SRC="$src"
  export ARBISHIELD_WWW="$WEB"
  export API_PUBLIC_URL="$PUBLIC_URL"
  export VPS_ANON_KEY="$ANON"
  bash "$SCRIPTS_DIR/arbishield-cutover-frontend.sh"
  restored=1
}

if try_restore_bak; then
  log "Backup local aplicado"
elif try_restore_tar; then
  log "Tarball aplicado"
elif [[ -d "$LOCAL_MIRROR/assets" ]]; then
  try_cutover_from_mirror "$LOCAL_MIRROR"
elif [[ -d "$APP_DIR/arbishield-local/assets" ]]; then
  try_cutover_from_mirror "$APP_DIR/arbishield-local"
else
  log "Sem backup local — baixando espelho de $PUBLIC_URL (pode demorar)"
  ROOT_OPT="$(dirname "$SCRIPTS_DIR")"
  (cd "$ROOT_OPT" && ARBISHIELD_REMOTE_ORIGIN="$PUBLIC_URL" node "$SCRIPTS_DIR/mirror-arbishield-app.mjs")
  if [[ -d "$ROOT_OPT/arbishield-local/assets" ]]; then
    try_cutover_from_mirror "$ROOT_OPT/arbishield-local"
  elif command -v git >/dev/null 2>&1; then
    [[ -d "$APP_DIR/.git" ]] || git clone --branch "$BRANCH" --depth 1 "${ARBISHIELD_REPO:-https://github.com/isaacgomes3/exchange.git}" "$APP_DIR"
    (cd "$APP_DIR" && ARBISHIELD_REMOTE_ORIGIN="$PUBLIC_URL" node "$SCRIPTS_DIR/mirror-arbishield-app.mjs")
    try_cutover_from_mirror "$APP_DIR/arbishield-local"
  else
    die "Não foi possível restaurar. Verifique $BACKUP_DIR ou backup Hostinger"
  fi
fi

[[ -f "$WEB/index.html" ]] || die "index.html ainda ausente após restauração"
[[ -d "$WEB/assets" ]] || warn "pasta assets ausente — app pode carregar incompleto"

log "Aplicar estabilização (nginx híbrido + admin + serverfn)"
bash "$SCRIPTS_DIR/vps-stabilize-arbishield.sh"

echo
echo "OK — frontend inicial restaurado + admin estável"
echo "  App:   $PUBLIC_URL/app"
echo "  Admin: $PUBLIC_URL/admin"
echo "  Backup desta sessão: $BACKUP_DIR/www-before-restore-$STAMP.tar.gz"
