#!/usr/bin/env bash
# Hotfix: Lançar imediato — Gestão de Desafios + Gestão de Jogos.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/lancar-imediato-evento-2ebb/scripts/vps-hotfix-lancar-imediato.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/lancar-imediato-evento-2ebb}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
MARKER="desafio-publicar-imediato-v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR" "$SCRIPTS_DIR/lib"

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

publish_html() {
  local rel="$1"
  local needle="$2"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  grep -q "$needle" "$tmp" || die "$name sem $needle"
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-lancar-imediato-$(date +%s)" 2>/dev/null || true
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null || true)
  cp -f "$tmp" "$WEB/$name" 2>/dev/null || true
  cp -f "$tmp" "$WEB_ROOT/$name" 2>/dev/null || true
  rm -f "$tmp"
}

log "1/5 shim (API lançar imediato)"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q 'launchImmediate' "$tmp_shim" || die "shim sem launchImmediate"
grep -q 'desafio-step-update' "$tmp_shim" || die "shim sem rota desafio-step-update"
for dest in \
  "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" \
  "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  "$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs"
do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_shim" "$dest"
  chmod 0755 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_shim"

log "2/5 UI admin-desafios"
publish_html "deploy/vps-supabase/static/v2/admin-desafios.html" "$MARKER"
publish_html "deploy/vps-supabase/static/v2/admin-desafios.html" "Publicar de imediato"
publish_html "deploy/vps-supabase/static/v2/admin-desafios.html" "data-launch-immediate"
publish_html "deploy/vps-supabase/static/v2/admin-desafios.html" "btnSaveImmediate"

log "3/5 UI app-desafio (cliente)"
publish_html "deploy/vps-supabase/static/v2/app-desafio.html" "unlockAtMs"
publish_html "deploy/vps-supabase/static/v2/app-desafio.html" "$MARKER"

log "4/5 UI admin-jogos"
publish_html "deploy/vps-supabase/static/v2/admin-jogos.html" "Lançar imediato"
publish_html "deploy/vps-supabase/static/v2/admin-jogos.html" "data-launch-immediate"
publish_html "deploy/vps-supabase/static/v2/admin-jogos.html" "editReleaseMinutes"

log "5/5 restart serverfn"
for unit in arbishield-serverfn arbishield-serverfn-shim; do
  if systemctl list-unit-files "${unit}.service" 2>/dev/null | grep -q "$unit"; then
    systemctl restart "$unit" 2>/dev/null && echo "  restarted $unit" || true
  fi
done
while read -r unit; do
  [[ -n "$unit" ]] || continue
  systemctl restart "$unit" 2>/dev/null && echo "  restarted $unit" || true
done < <(systemctl list-units --type=service --all 2>/dev/null | awk '/serverfn/ {print $1}' | head -6)

log "OK — Ctrl+Shift+R em /admin-desafios.html e /admin-jogos.html"
echo "Marker: $MARKER"
echo "Desafios: botão amarelo 'Publicar de imediato' na gestão + cadastro."
echo "Jogos: Lançar/Publicar de imediato no cadastro, edição e lista."
