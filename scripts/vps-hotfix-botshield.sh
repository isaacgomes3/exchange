#!/usr/bin/env bash
# Atualiza só os arquivos do painel BotShield (UI).
# Se o site nginx ainda não existir, rode vps-enable-botshield.sh antes.
#
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-botshield.sh?ref=cursor/botshield-painel-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/botshield-painel-e85c}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${BOTSHIELD_WEB:-/var/www/arbishield-botshield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl

fetch() {
  local path="$1" out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/${path}?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "$RAW/${path}?t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]]
}

echo "==> vps-hotfix-botshield.sh ($(date -Is)) ref=$REF"
mkdir -p "$WEB_ROOT"
tmpd="$(mktemp -d)"
n=0
for f in \
  index.html auth.html bots.html criar.html modelos.html ordens.html integracoes.html \
  botshield.css botshield.js botshield-shell.js; do
  fetch "deploy/vps-supabase/static/botshield/$f" "$tmpd/$f" || die "falha $f"
  cp -f "$tmpd/$f" "$WEB_ROOT/$f"
  chmod 0644 "$WEB_ROOT/$f"
  echo "  OK $f"
  n=$((n + 1))
done
rm -rf "$tmpd"

grep -q 'data-active="bots"' "$WEB_ROOT/bots.html" || die "bots.html sem marker"
grep -q 'botshield.arbishield.app' "$WEB_ROOT/botshield.js" || die "host check ausente"
# garantia: não misturar no v2 principal
if [[ -f /var/www/arbishield/v2/bots.html ]] && grep -q 'botshield' /var/www/arbishield/v2/bots.html 2>/dev/null; then
  echo "  AVISO: há bots.html no v2 principal — remova se quiser isolamento total"
fi

echo ""
echo "OK ($n arquivos). https://botshield.arbishield.app/bots.html"
echo "Hard refresh. Sem entrada no menu de clientes/admin."
