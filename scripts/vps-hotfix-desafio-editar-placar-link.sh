#!/usr/bin/env bash
# Hotfix: Gestão de Desafios — editar placar e link do jogo por etapa.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-editar-placar-link-6a41/scripts/vps-hotfix-desafio-editar-placar-link.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/desafio-editar-placar-link-6a41}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
MARKER="desafio-editar-placar-link-v1"
NGINX_NEEDLE="desafio-step-update"

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
    cp -a "$f" "${f}.bak-stepmeta-$(date +%s)" 2>/dev/null || true
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null || true)
  cp -f "$tmp" "$WEB/$name" 2>/dev/null || true
  cp -f "$tmp" "$WEB_ROOT/$name" 2>/dev/null || true
  rm -f "$tmp"
}

log "1/4 shim (API desafio-step-update)"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q 'updateDesafioStepMeta' "$tmp_shim" || die "shim sem updateDesafioStepMeta"
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

log "2/4 UI admin-desafios"
publish_html "deploy/vps-supabase/static/v2/admin-desafios.html" "$MARKER"
publish_html "deploy/vps-supabase/static/v2/admin-desafios.html" "data-save-step-meta"

log "3/4 nginx (proxy desafio-step-update → :3101)"
patched=0
while IFS= read -r -d '' conf; do
  if grep -q 'desafio-settle' "$conf" 2>/dev/null; then
    if grep -q "$NGINX_NEEDLE" "$conf"; then
      echo "  já ok: $conf"
      patched=1
      continue
    fi
    cp -a "$conf" "${conf}.bak-stepmeta-$(date +%s)" 2>/dev/null || true
    sed -i 's/desafio-settle|/desafio-settle|desafio-step-update|/g' "$conf"
    if grep -q "$NGINX_NEEDLE" "$conf"; then
      echo "  patched: $conf"
      patched=1
    fi
  fi
done < <(find /etc/nginx /opt/arbishield /var/www -type f \( -name '*.conf' -o -name '*nginx*' \) -print0 2>/dev/null || true)

if command -v nginx >/dev/null 2>&1; then
  nginx -t 2>/dev/null && nginx -s reload 2>/dev/null || true
fi
[[ "$patched" -eq 1 ]] || echo "  aviso: nginx não encontrado/alterado — UI tem fallback Supabase"

log "4/4 restart serverfn"
for unit in arbishield-serverfn arbishield-serverfn-shim; do
  if systemctl list-unit-files "${unit}.service" 2>/dev/null | grep -q "$unit"; then
    systemctl restart "$unit" 2>/dev/null && echo "  restarted $unit" || true
  fi
done
while read -r unit; do
  [[ -n "$unit" ]] || continue
  systemctl restart "$unit" 2>/dev/null && echo "  restarted $unit" || true
done < <(systemctl list-units --type=service --all 2>/dev/null | awk '/serverfn/ {print $1}' | head -6)

log "OK — Ctrl+Shift+R em /admin-desafios.html"
echo "Marker: $MARKER"
echo "Em cada etapa: edite placar + link e clique em Salvar placar / link."
