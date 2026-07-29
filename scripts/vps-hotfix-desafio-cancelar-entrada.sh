#!/usr/bin/env bash
# Desafio: botao Cancelar entrada (antes do kickoff) + shim sem used_liquidity_cents.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-cancelar-entrada-9c21/scripts/vps-hotfix-desafio-cancelar-entrada.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/desafio-cancelar-entrada-9c21}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR"

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

install_named() {
  local name="$1"
  local marker="$2"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "deploy/vps-supabase/static/v2/$name" "$tmp"
  grep -q "$marker" "$tmp" || die "$name sem marker $marker"
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-desafio-cancel-$(date +%s)" 2>/dev/null || true
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null || true)
  for f in "$WEB/$name" "$WEB_ROOT/$name" "$WEB_ROOT/sandbox/$name"; do
    mkdir -p "$(dirname "$f")" 2>/dev/null || true
    [[ -d "$(dirname "$f")" ]] || continue
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
  done
  rm -f "$tmp"
}

log "1/3 UI — app-desafio.html (Cancelar entrada)"
install_named "app-desafio.html" "desafio-cancelar-entrada-v1"
grep -q 'data-cancel-entrada' "$WEB/app-desafio.html" || die "sem data-cancel-entrada"
grep -q 'desafio-cancel' "$WEB/app-desafio.html" || die "sem fetch desafio-cancel"

log "2/3 UI — v2.css (botao cancel)"
install_named "v2.css" "dz-v2-cta.cancel"
grep -q 'dz-v2-cta.cancel' "$WEB/v2.css" || die "css sem .dz-v2-cta.cancel"

log "3/3 shim — cancel SEM used_liquidity_cents (v2)"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q 'desafio-cancel-sem-used-liquidity-v2' "$tmp_shim" \
  || die "shim sem marker desafio-cancel-sem-used-liquidity-v2"
# Garante que o SELECT de cancel nao pede mais a coluna
! grep -q 'select=id,status,starts_at,desafio_id,used_liquidity_cents' "$tmp_shim" \
  || die "shim ainda seleciona used_liquidity_cents no cancel"
for dest in \
  "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" \
  "$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs"
do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_shim" "$dest"
  chmod 0644 "$dest"
  echo "  OK $dest"
done
for u in arbishield-serverfn-shim.service; do
  exec="$(systemctl show -p ExecStart --value "$u" 2>/dev/null || true)"
  if [[ "$exec" =~ (/[^[:space:]]+arbishield-serverfn-shim\.mjs) ]]; then
    cp -f "$tmp_shim" "${BASH_REMATCH[1]}"
    chmod 0644 "${BASH_REMATCH[1]}"
    echo "  OK ${BASH_REMATCH[1]} (via $u)"
  fi
done
rm -f "$tmp_shim"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || \
  systemctl restart arbishield-shim.service 2>/dev/null || \
  echo "AVISO: nao reiniciou shim (reinicie manualmente)"
sleep 1
# Confirma marker no arquivo em execucao
if systemctl show -p ExecStart --value arbishield-serverfn-shim.service 2>/dev/null | grep -qoE '/[^ ]+arbishield-serverfn-shim\.mjs'; then
  EXEC_FILE="$(systemctl show -p ExecStart --value arbishield-serverfn-shim.service | grep -oE '/[^ ]+arbishield-serverfn-shim\.mjs' | head -1)"
  if [[ -n "$EXEC_FILE" ]]; then
    grep -q 'desafio-cancel-sem-used-liquidity-v2' "$EXEC_FILE" \
      || die "shim em execucao ainda sem v2: $EXEC_FILE"
    echo "  confere OK $EXEC_FILE"
  fi
fi

log "OK — Ctrl+Shift+R em Desafio e tente Cancelar entrada de novo."
echo "  https://arbishield.app/app-desafio.html"
echo "  marker shim: desafio-cancel-sem-used-liquidity-v2"
