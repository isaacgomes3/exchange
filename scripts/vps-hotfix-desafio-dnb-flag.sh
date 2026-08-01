#!/usr/bin/env bash
# Desafio no card do cliente:
#   - Empate Anula marca V/× pelo time nomeado (empate = E, estorno)
#   - cada quadro fica embaixo do time em que aposta
#   - logo da casa de aposta no topo do quadro
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-desafio-dnb-flag.sh?ref=cursor/desafio-empate-anula-flag-4759&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/desafio-empate-anula-flag-4759}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT"

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

echo "==> vps-hotfix-desafio-dnb-flag.sh ($(date -Is)) ref=$REF"

log "1/3 baixar e validar app-desafio.html"
tmp_html="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-desafio.html" "$tmp_html"
grep -q 'desafio-dnb-flag-v1' "$tmp_html" || die "sem marker desafio-dnb-flag-v1"
grep -q 'desafio-painel-lado-time-v1' "$tmp_html" || die "sem marker desafio-painel-lado-time-v1"
grep -q 'desafio-casa-logo-v1' "$tmp_html" || die "sem marker desafio-casa-logo-v1"
grep -q 'var DNB_RE' "$tmp_html" || die "sem DNB_RE"
grep -q 'namesOverlap' "$tmp_html" || die "sem namesOverlap"
grep -q 'dz-mkt-flag.is-void' "$tmp_html" || die "sem estilo is-void"
grep -q 'marketLineHtml(item.marketArbi, item.liveInfo, teams)' "$tmp_html" \
  || die "painel ArbiShield sem os times no marcador"
grep -q 'marketLineHtml(item.marketCasa, item.liveInfo, teams)' "$tmp_html" \
  || die "painel casa sem os times no marcador"
grep -q 'is-swapped' "$tmp_html" || die "sem troca de lado dos quadros"
grep -q 'casaBrandLogo(item.casaBrand)' "$tmp_html" || die "sem logo da casa de aposta"
# Não pode voltar a versão que tratava Empate Anula como aposta no empate
grep -q 'marketDecidedStatus(name, home, away, finished, teams)' "$tmp_html" \
  || die "marketDecidedStatus sem parametro teams (versao antiga)"

log "2/3 logos das casas de aposta"
for pair in \
  "deploy/vps-supabase/static/v2/brand/houses/betbra.png:brand/houses/betbra.png" \
  "deploy/vps-supabase/static/v2/brand/houses/casa.svg:brand/houses/casa.svg"; do
  IFS=: read -r rel dest <<<"$pair"
  tmp_asset="$(mktemp)"
  download_repo_file "$rel" "$tmp_asset"
  [[ -s "$tmp_asset" ]] || die "asset vazio: $rel"
  for root_dir in "$WEB" "$WEB_ROOT" /var/www/html /var/www/html/v2; do
    [[ -d "$root_dir" ]] || continue
    mkdir -p "$root_dir/$(dirname "$dest")"
    cp -f "$tmp_asset" "$root_dir/$dest"
    chmod 0644 "$root_dir/$dest"
    echo "  OK $root_dir/$dest"
  done
  rm -f "$tmp_asset"
done

log "3/3 publicar em todos os app-desafio.html"
n=0
while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-dz-dnb-$(date +%s)" 2>/dev/null || true
  cp -f "$tmp_html" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
  n=$((n + 1))
done < <(find /var/www -type f -name 'app-desafio.html' -print0 2>/dev/null || true)
for f in "$WEB/app-desafio.html" "$WEB_ROOT/app-desafio.html"; do
  mkdir -p "$(dirname "$f")" 2>/dev/null || true
  [[ -d "$(dirname "$f")" ]] || continue
  cp -f "$tmp_html" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
  n=$((n + 1))
done
rm -f "$tmp_html"

if command -v nginx >/dev/null 2>&1; then
  nginx -s reload 2>/dev/null || true
fi

check="$(curl -fsS "http://127.0.0.1/app-desafio.html" 2>/dev/null || true)"
if [[ -z "$check" ]]; then
  check="$(cat "$WEB_ROOT/app-desafio.html" 2>/dev/null || cat "$WEB/app-desafio.html" 2>/dev/null || true)"
fi
echo "$check" | grep -q 'desafio-dnb-flag-v1' || die "apos publish, sem desafio-dnb-flag-v1"

log "OK — arquivos atualizados: $n"
echo "Abra https://arbishield.app/app-desafio.html e Ctrl+Shift+R"
echo "Empate Anula: V no time que ganhou, × no outro; empate = E (valor estornado)"
echo "Quadros: cada um embaixo do time em que aposta (mandante à esquerda)"
echo "Casa de aposta: logo no topo do quadro (/brand/houses/betbra.png)"
