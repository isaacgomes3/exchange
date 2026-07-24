#!/usr/bin/env bash
# Restaura Lançar Evento Manual + Lançar Desafio:
# - painel expandido (não lateral estreito)
# - API / busca de time com logo
# - autocomplete de mercados (market-catalog.js)
# - nginx proxy football-teams + prelive
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-restaurar-lancar-form.sh")
set -euo pipefail

REF="488b49307c3f94fcdfa4759770fdd81d355488a0"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/4 UI — admin-jogos + admin-desafios + market-catalog"
for f in admin-jogos.html admin-desafios.html market-catalog.js; do
  dl "deploy/vps-supabase/static/v2/$f" "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done
dl "deploy/vps-supabase/static/admin-jogos-vps.html" "$WEB_ROOT/admin-jogos-vps.html" 2>/dev/null || true
dl "deploy/vps-supabase/static/admin-desafios-vps.html" "$WEB_ROOT/admin-desafios-vps.html" 2>/dev/null || true

grep -q 'bindTeamPicker\|football-teams\|Buscar time\|manHomeLogo' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem busca de time/logo"
grep -q 'bindMarketNamePicker\|market-suggest\|ARBISHIELD_MARKET_CATALOG' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem autocomplete de mercados"
grep -q 'btnBackManual\|Página completa\|app.hidden = true' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem página justificada (ainda modal?)"
grep -q 'data-f="odd"\|Liquidez real\|manualMarkets' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem campos de mercado/odd/liquidez"
grep -q 'Mercados de proteção' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem seção de mercados visível"
grep -q 'bindDesafioLaunchPickers\|football-teams' "$WEB/admin-desafios.html" \
  || die "admin-desafios sem busca de time"
grep -q 'market-suggest\|market-catalog.js' "$WEB/admin-desafios.html" \
  || die "admin-desafios sem autocomplete de mercados"
grep -q 'desafio-launch-open\|btnBackDraft\|Página completa' "$WEB/admin-desafios.html" \
  || die "admin-desafios sem página justificada (ainda modal?)"
grep -q 'ARBISHIELD_MARKET_CATALOG' "$WEB/market-catalog.js" \
  || die "market-catalog.js ausente/ inválido"

log "2/4 Backend prelive — API /football-teams"
PRELIVE_DST="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
[[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]] && \
  PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
dl "scripts/arbishield-prelive-events.mjs" "$PRELIVE_DST"
chmod 0755 "$PRELIVE_DST"
grep -q 'searchFootballTeams\|/api/arbishield/football-teams' "$PRELIVE_DST" \
  || die "prelive sem endpoint football-teams"
grep -q 'strBadge ||' "$PRELIVE_DST" \
  || die "prelive não prioriza escudo (strBadge) — logo fica descentralizada"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true

log "3/4 Nginx — /api/arbishield/football-teams → :3098"
FOOTBALL_BLOCK='
    location = /api/arbishield/football-teams {
        proxy_pass http://127.0.0.1:3098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 60s;
    }
'
patched=0
for conf in /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-available/arbishield.app \
  /etc/nginx/conf.d/arbishield-cutover.conf; do
  [[ -f "$conf" ]] || continue
  if grep -q 'location = /api/arbishield/football-teams' "$conf"; then
    echo "  ok already: $conf"
    patched=1
    continue
  fi
  if grep -q 'location = /api/arbishield/matches' "$conf"; then
    tmp="$(mktemp)"
    awk -v block="$FOOTBALL_BLOCK" '
      /location = \/api\/arbishield\/matches \{/ { inb=1 }
      { print }
      inb && /^\s*\}/ && !done {
        print block
        done=1
        inb=0
      }
    ' "$conf" > "$tmp"
    if grep -q 'location = /api/arbishield/football-teams' "$tmp"; then
      cp -f "$tmp" "$conf"
      echo "  patched $conf"
      patched=1
    else
      echo "  WARN: falha ao inserir em $conf"
    fi
    rm -f "$tmp"
  fi
done
if [[ "$patched" -eq 1 ]]; then
  nginx -t && systemctl reload nginx
else
  echo "  WARN: nenhum conf nginx patchado — confira proxy football-teams manualmente"
fi

log "4/4 Smoke"
curl -fsS "http://127.0.0.1:3098/api/arbishield/football-teams?q=santos" \
  | grep -q '"ok":true\|"teams"' \
  && echo "  API local football-teams OK" \
  || echo "  WARN: API local football-teams sem resposta JSON (serviço pode estar subindo)"
test -f "$WEB/market-catalog.js" || die "market-catalog.js não está em $WEB"

log "OK — hard refresh em /admin-jogos.html e /admin-desafios.html"
log "Lançar Evento Manual / Lançar Desafio: painel largo + logos + autocomplete."
