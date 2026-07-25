#!/usr/bin/env bash
# Publica o app-proteger.html COMPLETO (com retorno + dedução) em /v2 e /sandbox.
# Não faz patch cirúrgico — evita cair no calcLay legado que zerava os campos.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-fee-upfront-3cf9/scripts/vps-fix-preview-proteger-agora.sh?v=$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-fee-upfront-3cf9}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
V2="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
SANDBOX="${ARBISHIELD_SANDBOX_WEB:-/var/www/arbishield/sandbox}"
TS="$(date +%s)"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need python3
need grep
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$V2" "$SANDBOX"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

log "Baixar app-proteger.html (ref=$REF)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/app-proteger.html?v=$TS" \
  -o "$TMP"

grep -q 'Retorno casa externa' "$TMP" || die "download sem Retorno casa externa"
grep -q 'Dedução ArbiShield' "$TMP" || die "download sem Dedução ArbiShield"
grep -q 'layToBackOdd' "$TMP" || die "download sem layToBackOdd"
grep -q 'lucroBruto' "$TMP" || die "download sem cálculo local de preview (lucroBruto)"

install_file() {
  local dest="$1"
  local mode="$2"
  cp -f "$TMP" "$dest"
  # bust cache
  sed -i "s/proteger-lay-back-equiv-[0-9]*/proteger-lay-back-equiv-$TS/g" "$dest" || true
  sed -i "s/proteger-fee-upfront-[0-9]*/proteger-lay-back-equiv-$TS/g" "$dest" || true

  if [[ "$mode" == "sandbox" ]]; then
    python3 - "$dest" <<'PY'
from pathlib import Path
import re, sys
p = Path(sys.argv[1])
t = p.read_text(encoding="utf-8", errors="replace")
t = t.replace('"/api/arbishield/', '"/__sandbox_api/arbishield/')
t = t.replace("'/api/arbishield/", "'/__sandbox_api/arbishield/")
t = t.replace("`/api/arbishield/", "`/__sandbox_api/arbishield/")
if "arbishield-sandbox-banner" not in t:
    banner = (
        '<div id="arbishield-sandbox-banner" style="position:sticky;top:0;z-index:99999;'
        'background:#7c2d12;color:#ffedd5;text-align:center;padding:8px 12px;'
        'font:700 12px/1.4 sans-serif">SANDBOX — retorno + dedução (LAY→back)</div>\n'
    )
    t = re.sub(r"(<body[^>]*>)", r"\1\n" + banner, t, count=1, flags=re.I)
p.write_text(t, encoding="utf-8")
print("  sandbox api rewrite OK")
PY
  fi

  grep -q 'Retorno casa externa' "$dest" || die "$dest sem Retorno"
  grep -q 'lucroBruto' "$dest" || die "$dest sem lucroBruto"
  # Não pode restar preview que zera retorno
  if grep -q '__ret = __pv.grossReturnCents' "$dest"; then
    die "$dest ainda tem preview frágil (__pv.grossReturnCents)"
  fi
  echo "  OK $dest"
  # mostra as linhas do cálculo
  grep -n 'Retorno casa externa\|Dedução ArbiShield\|lucroBruto\|layToBackOdd' "$dest" | head -12
}

log "1) Produção → $V2/app-proteger.html"
install_file "$V2/app-proteger.html" prod

log "2) Sandbox → $SANDBOX/app-proteger.html"
install_file "$SANDBOX/app-proteger.html" sandbox

echo
echo "OK — HTML completo publicado"
echo "  https://arbishield.app/app-proteger.html?v=$TS"
echo "  https://arbishield.app/sandbox/app-proteger.html?v=$TS"
echo
echo "LAY 13 · R\$ 1.000 → back equiv. 1,083 · retorno R\$ 1.083,00 · dedução R\$ 68,00"
echo "Abra em janela anônima (Ctrl+Shift+N) para evitar cache."
