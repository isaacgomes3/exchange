#!/usr/bin/env bash
# Hotfix: busca de times + logos + formulário full-page + Saldo Reembolso
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/manual-evento-escudo-times-bb44/scripts/vps-hotfix-times-busca-logo.sh?v=15")
set -euo pipefail

REPO="isaacgomes3/exchange"
BRANCH="${ARBISHIELD_BRANCH:-cursor/manual-evento-escudo-times-bb44}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"
NGINX_SITE="${ARBISHIELD_NGINX_SITE:-/etc/nginx/sites-available/arbishield.app}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
verify_html() {
  local f="$1"
  grep -q 'manualLaunchPanel' "$f" || die "$f sem manualLaunchPanel (HTML antigo ou download incompleto)"
  grep -q 'drawer-backdrop' "$f" && die "$f ainda usa drawer lateral (HTML antigo)"
}

need curl
mkdir -p "$WEB" "$SCRIPTS_DIR"

log "Limpar artefatos de layout antigo (drawer / guard / vps)"
rm -f \
  "$WEB_ROOT/admin-jogos-vps.html" \
  "$WEB_ROOT/assets/admin-jogos-vps.html" \
  "$WEB_ROOT/assets/admin-jogos-guard.js" \
  "$WEB_ROOT/assets/admin-jogos-force-vps.js" \
  "$WEB/admin-jogos-vps.html" \
  "$WEB/assets/admin-jogos-guard.js" \
  "$WEB/assets/admin-jogos-force-vps.js" \
  2>/dev/null || true

log "Resolvendo commit mais recente da branch $BRANCH"
COMMIT_SHA="${ARBISHIELD_COMMIT:-}"
if [[ -z "$COMMIT_SHA" ]]; then
  COMMIT_SHA=$(curl -fsSL "https://api.github.com/repos/${REPO}/commits/${BRANCH}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['sha'])" 2>/dev/null || true)
fi
if [[ -z "$COMMIT_SHA" ]]; then
  log "  aviso: não resolveu SHA via API — usando branch (pode estar em cache)"
  RAW="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
else
  log "  commit ${COMMIT_SHA:0:12}"
  RAW="https://raw.githubusercontent.com/${REPO}/${COMMIT_SHA}"
fi

fetch() {
  local rel="$1"
  local dest="$2"
  curl -fsSL "${RAW}/${rel}" -o "$dest"
}

publish_web() {
  local rel="$1"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  fetch "$rel" "$tmp"
  [[ -s "$tmp" ]] || die "download vazio: $rel"
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-saldo-reembolso-$(date +%s)" 2>/dev/null || true
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null || true)
  for f in "$WEB/$name" "$WEB_ROOT/$name"; do
    mkdir -p "$(dirname "$f")" 2>/dev/null || true
    [[ -d "$(dirname "$f")" ]] || continue
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
  done
  rm -f "$tmp"
}

log "1/6 — admin-jogos.html (formulário full-page, NÃO drawer)"
fetch "deploy/vps-supabase/static/v2/admin-jogos.html" "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
verify_html "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
BUILD=$(grep -o 'manualLaunchPanel-v[0-9]*' "$WEB/admin-jogos.html" | head -1 || echo "manualLaunchPanel")
log "  ok $WEB/admin-jogos.html ($(wc -c < "$WEB/admin-jogos.html") bytes, $BUILD)"

log "2/6 — v2.js (ArbiV2.searchFootballTeams + fallback TheSportsDB)"
fetch "deploy/vps-supabase/static/v2/v2.js" "$WEB/v2.js"
chmod 0644 "$WEB/v2.js"
cp -f "$WEB/v2.js" "$WEB_ROOT/v2.js" 2>/dev/null || true
grep -q 'searchFootballTeams' "$WEB/v2.js" || die "v2.js sem searchFootballTeams"

log "3/6 — UI Proteger + Minhas Proteções + Extrato + Carteira (Saldo Reembolso)"
fetch "deploy/vps-supabase/static/v2/app-proteger.html" "$WEB/app-proteger.html"
chmod 0644 "$WEB/app-proteger.html"
fetch "deploy/vps-supabase/static/v2/app-protecoes.html" "$WEB/app-protecoes.html"
chmod 0644 "$WEB/app-protecoes.html"
cp -f "$WEB/app-protecoes.html" "$WEB_ROOT/app-protecoes.html" 2>/dev/null || true
publish_web "deploy/vps-supabase/static/v2/app-carteira.html"
publish_web "deploy/vps-supabase/static/v2/v2-financeiro.js"
publish_web "deploy/vps-supabase/static/v2/v2-shell.js"
fetch "deploy/vps-supabase/static/v2/v2.css" "$WEB/v2.css"
chmod 0644 "$WEB/v2.css"
grep -q 'home_logo' "$WEB/app-proteger.html" || die "proteger sem home_logo"
grep -q 'term-team-logo' "$WEB/v2.css" || die "v2.css sem term-team-logo"
grep -q 'Protocolo de auditoria' "$WEB/app-protecoes.html" || die "protecoes sem Protocolo de auditoria"
grep -q 'Reembolso correto' "$WEB/app-protecoes.html" || die "protecoes sem label Reembolso correto"
grep -q 'Ganhou na exchange' "$WEB/app-protecoes.html" || die "protecoes sem label Ganhou na exchange"
grep -q 'Reembolso correto' "$WEB/v2-financeiro.js" || die "financeiro sem label Reembolso correto"
grep -q 'finBalDeduction' "$WEB/app-carteira.html" || die "carteira sem Saldo Reembolso"
grep -q 'carteira-saldo-reembolso-v15' "$WEB/app-carteira.html" || die "carteira sem marker v15"
grep -q 'finBalDeduction' "$WEB/v2-financeiro.js" || die "financeiro sem finBalDeduction"
grep -q 'TRANSFER_DESAFIO_BLOCKED' "$WEB/v2-financeiro.js" || die "financeiro sem bloqueio Banca→Desafio"
grep -q 'deduction_balance_cents' "$WEB/v2-shell.js" || die "shell sem deduction_balance_cents"

log "4/6 — Prelive API (endpoint /football-teams + settle → Saldo Reembolso)"
fetch "scripts/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
grep -q 'searchFootballTeams' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem searchFootballTeams"
grep -q '/api/arbishield/football-teams' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem rota football-teams"
grep -q 'deduction_balance_cents' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem crédito em deduction_balance_cents"
systemctl restart arbishield-prelive-events.service 2>/dev/null || true

log "5/6 — Shim (transfer Reembolso→Desafio + saque + settle)"
tmp_shim="$(mktemp)"
fetch "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q 'transfer-reembolso-desafio-atomic-v1' "$tmp_shim" || die "shim sem transfer Reembolso→Desafio"
grep -q 'requestDeductionWithdrawal' "$tmp_shim" || die "shim sem requestDeductionWithdrawal"
grep -q 'deduction_balance_cents' "$tmp_shim" || die "shim sem deduction_balance_cents"
for dest in \
  "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" \
  "/opt/arbishield/arbishield-serverfn-shim.mjs" \
  "/opt/arbishield/scripts/arbishield-serverfn-shim.mjs"
do
  mkdir -p "$(dirname "$dest")" 2>/dev/null || true
  [[ -d "$(dirname "$dest")" ]] || continue
  cp -f "$tmp_shim" "$dest"
  chmod 0755 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_shim"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || \
  systemctl restart arbishield-shim.service 2>/dev/null || true

if [[ -f "$NGINX_SITE" ]]; then
  if ! grep -q 'football-teams' "$NGINX_SITE"; then
    log "Nginx: inserindo location football-teams"
    python3 - <<'PY' "$NGINX_SITE"
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
needle = """    location /api/arbishield/prelive-events {
        proxy_pass http://127.0.0.1:3098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 120s;
    }
"""
block = """    location /api/arbishield/prelive-events {
        proxy_pass http://127.0.0.1:3098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 120s;
    }

    location /api/arbishield/football-teams {
        proxy_pass http://127.0.0.1:3098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 30s;
    }
"""
if needle not in text:
    raise SystemExit("bloco prelive-events não encontrado no nginx")
path.write_text(text.replace(needle, block, 1))
print("nginx atualizado")
PY
    nginx -t
    systemctl reload nginx
  else
    log "Nginx já tem football-teams"
  fi
else
  log "Nginx site não encontrado em $NGINX_SITE — aplique o conf do repo manualmente"
fi

log "6/6 — smoke transfer-desafio (Banca bloqueada)"
CODE=$(curl -sS -o /tmp/xfer-block.json -w "%{http_code}" \
  -X POST "http://127.0.0.1:3101/api/arbishield/transfer-desafio" \
  -H "Content-Type: application/json" \
  -d '{"amountCents":100}' || true)
echo "  smoke transfer-desafio (sem source) → HTTP $CODE"
head -c 200 /tmp/xfer-block.json 2>/dev/null; echo

echo
echo "OK — deploy concluído ($BUILD + saldo-reembolso-v15)"
echo "  Arquivo servido: $WEB/admin-jogos.html + $WEB/app-carteira.html"
if command -v curl >/dev/null; then
  if curl -fsS "http://127.0.0.1/admin-jogos.html" 2>/dev/null | grep -q 'manualLaunchPanel'; then
    echo "  Verificação local: OK (formulário full-page ativo)"
  else
    echo "  AVISO: curl local não encontrou manualLaunchPanel — confira root nginx ($WEB)"
  fi
  if curl -fsS "http://127.0.0.1/app-carteira.html" 2>/dev/null | grep -q 'finBalDeduction'; then
    echo "  Carteira: OK (Saldo Reembolso no HTML)"
  else
    echo "  AVISO: app-carteira.html local sem finBalDeduction"
  fi
fi
echo "  Abra https://arbishield.app/app-carteira.html e pressione Ctrl+F5"
echo "  Liquidação Bateu ArbiShield → credita Saldo Reembolso (não Saldo Real)"
echo "  Migration opcional (saque via RPC): supabase/migrations/20260725_request_saldo_reembolso_withdrawal.sql"
