#!/usr/bin/env bash
# Hotfix: liquidez real inicial padrão R$ 200 no formulário de mercado.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-liquidez-real-default-200.sh?ref=cursor/liquidez-real-default-200-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/liquidez-real-default-200-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl

echo "==> vps-hotfix-liquidez-real-default-200.sh ($(date -Is)) ref=$REF"

fetch_raw() {
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
    -H "Cache-Control: no-cache" \
    "$RAW/${path}?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || return 1
}

tmp="$(mktemp)"
fetch_raw "deploy/vps-supabase/static/v2/admin-jogos.html" "$tmp" \
  || die "download vazio admin-jogos.html"

grep -q 'liquidity_brl: "200"' "$tmp" || die "admin-jogos sem liquidez padrão 200"
grep -qE 'liquidity_brl != null && m.liquidity_brl !== "" \? m.liquidity_brl : "200"' "$tmp" \
  || die "admin-jogos sem fallback UI 200"
grep -q 'value="200"' "$tmp" || die "admin-jogos sem value=200 no input prelive"
# não regressar para 2000 como default de mercado
if grep -qE 'liquidity_brl: "2000"|: "2000";|value="2000"' "$tmp"; then
  die "admin-jogos ainda tem default 2000"
fi

n=0
while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-liq200-$(date +%s)" 2>/dev/null || true
  cp -f "$tmp" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
  n=$((n + 1))
done < <(find /var/www -type f -name 'admin-jogos.html' -print0 2>/dev/null)

if [[ "$n" -eq 0 ]]; then
  mkdir -p "$WEB"
  cp -f "$tmp" "$WEB/admin-jogos.html"
  chmod 0644 "$WEB/admin-jogos.html"
  echo "  OK $WEB/admin-jogos.html (fallback)"
  n=1
fi
rm -f "$tmp"

# Fallback backend R$ 200 quando liquidez não vem no body
PRELIVE_DST="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
[[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]] && \
  PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
mkdir -p "$(dirname "$PRELIVE_DST")"
ptmp="$(mktemp)"
if fetch_raw "scripts/arbishield-prelive-events.mjs" "$ptmp"; then
  grep -q '20_000; // fallback R$ 200' "$ptmp" || die "prelive sem fallback 20_000"
  cp -a "$PRELIVE_DST" "${PRELIVE_DST}.bak-liq200-$(date +%s)" 2>/dev/null || true
  cp -f "$ptmp" "$PRELIVE_DST"
  chmod 0755 "$PRELIVE_DST"
  cp -f "$PRELIVE_DST" /opt/arbishield/scripts/arbishield-prelive-events.mjs 2>/dev/null || true
  echo "  OK $PRELIVE_DST"
else
  echo "  AVISO: prelive não atualizado (download falhou)"
fi
rm -f "$ptmp"

# reinicia processo que carrega o prelive, se existir
if systemctl is-active --quiet arbishield-shim 2>/dev/null; then
  systemctl restart arbishield-shim || true
  echo "  restarted arbishield-shim"
elif systemctl is-active --quiet arbishield 2>/dev/null; then
  systemctl restart arbishield || true
  echo "  restarted arbishield"
fi

echo ""
echo "OK ($n HTML). Liquidez real inicial padrão = R$ 200."
echo "Hard refresh (Ctrl+Shift+R) em Gestão de Jogos → Lançar jogo."
