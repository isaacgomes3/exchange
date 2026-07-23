#!/usr/bin/env bash
# Desafio: cancelar entrada (cliente até kickoff) + cancelar individual no admin.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-desafio-cancelar-entrada.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-PLACEHOLDER_SHA}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SHIM_DIR"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/3 UI — jornada (cancelar) + admin (entradas por cliente)"
for f in app-desafio-jornada.html admin-desafios.html; do
  dl "deploy/vps-supabase/static/v2/$f" "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done
grep -q 'desafio-cancel' "$WEB/app-desafio-jornada.html" || die "jornada sem cancelar"
grep -q 'btnCancelEntry' "$WEB/app-desafio-jornada.html" || die "jornada sem botão Cancelar entrada"
grep -q 'data-parts' "$WEB/admin-desafios.html" || die "admin sem Ver entradas"
grep -q 'data-cancel-part' "$WEB/admin-desafios.html" || die "admin sem cancelar individual"

log "2/3 Shim — cancelDesafioParticipation + REST"
dl "scripts/arbishield-serverfn-shim.mjs" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
for u in arbishield-serverfn-shim.service; do
  if systemctl cat "$u" >/dev/null 2>&1; then
    exec="$(systemctl show -p ExecStart --value "$u" 2>/dev/null | head -1 || true)"
    if [[ "$exec" =~ (/[^[:space:]]+arbishield-serverfn-shim\.mjs) ]]; then
      cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" "${BASH_REMATCH[1]}"
      echo "  wrote ${BASH_REMATCH[1]}"
    fi
  fi
done
grep -q 'cancelDesafioParticipation' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem cancelDesafioParticipation"
grep -q 'desafio-cancel' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem rota desafio-cancel"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
sleep 1
curl -sS -o /tmp/dz-cancel.txt -w "%{http_code}" -X POST "http://127.0.0.1:3101/api/arbishield/desafio-cancel" \
  -H "Content-Type: application/json" -d '{}' >/tmp/dz-cancel.code || true
grep -qE 'Não autorizado|Entrada pendente|id obrigatório|Acesso negado|obrigatório' /tmp/dz-cancel.txt \
  || die "shim local não responde desafio-cancel: $(head -c 160 /tmp/dz-cancel.txt)"

log "3/3 Nginx — liberar /api/arbishield/desafio-cancel"
NGINX_DST=""
for cand in \
  /etc/nginx/sites-available/arbishield.app \
  /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-available/arbishield \
  /etc/nginx/sites-enabled/arbishield; do
  if [[ -f "$cand" ]]; then NGINX_DST="$cand"; break; fi
done
if [[ -n "$NGINX_DST" ]]; then
  if ! grep -q 'desafio-cancel' "$NGINX_DST"; then
    if grep -q 'desafio-settle|' "$NGINX_DST"; then
      sed -i 's/desafio-settle|/desafio-settle|desafio-cancel|/g' "$NGINX_DST"
      echo "  nginx regex: desafio-cancel inserido"
      nginx -t && systemctl reload nginx || true
    elif grep -q 'location ^~ /_serverFn/' "$NGINX_DST"; then
      sed -i '/location \^~ \/_serverFn\//i\    location = /api/arbishield/desafio-cancel { proxy_pass http://127.0.0.1:3101; proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header Authorization $http_authorization; proxy_pass_request_headers on; proxy_read_timeout 120s; }' "$NGINX_DST"
      nginx -t && systemctl reload nginx || true
    else
      log "AVISO: não consegui inserir desafio-cancel no nginx automaticamente"
    fi
  fi
else
  log "nginx conf não encontrada — confira proxy desafio-cancel → :3101"
fi

log "OK — cliente: /app-desafio-jornada.html (Cancelar entrada até o kickoff)"
log "OK — admin: /admin-desafios.html → Ver entradas → Cancelar / estornar"
