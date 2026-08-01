#!/usr/bin/env bash
# Desafio: botao Historico ao lado de Depositar (ciclos, apostado, lucros).
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

log "1/3 UI app-desafio.html"
tmp_html="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-desafio.html" "$tmp_html"
grep -q 'desafio-historico-v2' "$tmp_html" || die "sem marker desafio-historico-v2"
grep -q 'btnDesafioHistorico' "$tmp_html" || die "sem botao Historico"
grep -q 'desafio-history' "$tmp_html" || die "sem fetch desafio-history"
grep -q 'loadDesafioHistoryFallback' "$tmp_html" || die "sem fallback histórico"

while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-dz-hist-$(date +%s)" 2>/dev/null || true
  cp -f "$tmp_html" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
done < <(find /var/www -type f -name 'app-desafio.html' -print0 2>/dev/null || true)
for f in "$WEB/app-desafio.html" "$WEB_ROOT/app-desafio.html"; do
  mkdir -p "$(dirname "$f")" 2>/dev/null || true
  [[ -d "$(dirname "$f")" ]] || continue
  cp -f "$tmp_html" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
done
rm -f "$tmp_html"

log "2/3 shim desafio-history"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q 'listMyDesafioHistory' "$tmp_shim" || die "shim sem listMyDesafioHistory"
grep -q 'normalizeDesafioPartResult' "$tmp_shim" || die "shim sem normalizeDesafioPartResult"
grep -q 'desafio-history' "$tmp_shim" || die "shim sem rota desafio-history"
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

log "3/3 nginx — incluir desafio-history no proxy :3101"
for conf in \
  /etc/nginx/conf.d/arbishield-cutover.conf \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/sites-enabled/arbishield \
  /etc/nginx/sites-available/arbishield.app
do
  [[ -f "$conf" ]] || continue
  python3 - "$conf" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path, encoding="utf-8", errors="replace").read()
if "desafio-history" in text:
    print("  ja tem desafio-history em", path)
    raise SystemExit(0)
# Insere em qualquer regex de locations desafio-*
new_text, n = re.subn(
    r"(desafio-participations)(\|)?",
    r"\1|desafio-history\2",
    text,
    count=1,
)
if n == 0:
    new_text, n = re.subn(
        r"(desafio-register\|desafio-settle)",
        r"\1|desafio-history",
        text,
        count=1,
    )
if n == 0:
    print("  aviso: nao achei bloco desafio em", path)
    raise SystemExit(0)
open(path, "w", encoding="utf-8").write(new_text)
print("  patched", path)
PY
done

if command -v nginx >/dev/null 2>&1; then
  nginx -t && systemctl reload nginx || true
fi

sleep 1
CODE=$(curl -sS -o /tmp/dz-hist-smoke.json -w "%{http_code}" \
  -X GET "http://127.0.0.1:3101/api/arbishield/desafio-history" || true)
echo "  smoke local GET desafio-history → HTTP $CODE (401 sem token = ok)"

log "OK — Ctrl+Shift+R em /app-desafio.html"
echo "  Botao Historico ao lado de Depositar."
