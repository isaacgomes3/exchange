#!/usr/bin/env bash
# Libera transferência Saldo Reembolso → Desafio (UI + API).
# Banca Real → Desafio continua bloqueada.
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
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

publish_web() {
  local rel="$1"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-xfer-reemb-$(date +%s)" 2>/dev/null || true
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

log "1/2 UI carteira + financeiro"
publish_web "deploy/vps-supabase/static/v2/app-carteira.html"
publish_web "deploy/vps-supabase/static/v2/v2-financeiro.js"
grep -q 'carteira-xfer-reembolso-desafio-v1' "$WEB/app-carteira.html" \
  || die "sem marker carteira-xfer-reembolso-desafio-v1"
grep -q 'btnTransferDeductionDesafio' "$WEB/app-carteira.html" \
  || die "sem botão Transferir p/ Desafio"
grep -q 'openTransferReembolsoDesafio' "$WEB/v2-financeiro.js" \
  || die "sem openTransferReembolsoDesafio"
grep -q 'source: "reembolso"' "$WEB/v2-financeiro.js" \
  || die "sem source reembolso no JS"

log "2/2 API shim"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q 'transferDeductionToDesafio' "$tmp_shim" || die "shim sem transferDeductionToDesafio"
grep -q 'transfer_reembolso_desafio_v1' "$tmp_shim" || die "shim sem marker transfer_reembolso_desafio_v1"
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

systemctl restart arbishield-serverfn-shim.service 2>/dev/null || \
  systemctl restart arbishield-shim.service 2>/dev/null || true

sleep 1
CODE=$(curl -sS -o /tmp/xfer-reemb.json -w "%{http_code}" \
  -X POST "http://127.0.0.1:3101/api/arbishield/transfer-desafio" \
  -H "Content-Type: application/json" \
  -d '{"source":"reembolso","amountCents":100}' || true)
echo "  smoke transfer-desafio (reembolso sem auth) → HTTP $CODE"
head -c 220 /tmp/xfer-reemb.json 2>/dev/null; echo

log "OK — Ctrl+Shift+R em /app-carteira.html"
echo "  Botão: Saldo Reembolso → Transferir p/ Desafio"
