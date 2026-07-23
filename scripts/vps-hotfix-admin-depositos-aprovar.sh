#!/usr/bin/env bash
# Admin: Confirmar e Creditar depósitos (incl. Desafio) via API REST no shim.
# Corrige falso sucesso do /_serverFn stub (status ficava PENDENTE sem crédito).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-admin-depositos-aprovar.sh")
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

log "1/3 UI — Confirmar/Rejeitar + API REST"
for f in admin-manual-deposits.html admin-depositos-desafio.html v2-shell.js; do
  dl "deploy/vps-supabase/static/v2/$f" "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done

grep -q 'Confirmar e Creditar' "$WEB/admin-manual-deposits.html" \
  || die "admin-manual-deposits ainda sem botão Confirmar e Creditar"
grep -q 'manual-deposit-approve' "$WEB/admin-manual-deposits.html" \
  || die "admin-manual-deposits sem rota REST approve"
grep -q 'Resposta sem confirmação' "$WEB/admin-manual-deposits.html" \
  || die "admin-manual-deposits sem guarda anti falso-sucesso"
! grep -q 'ArbiV2Page.mountAdmin' "$WEB/admin-manual-deposits.html" \
  || die "admin-manual-deposits ainda é stub mountAdmin"
grep -q 'manual-deposit-approve' "$WEB/admin-depositos-desafio.html" \
  || die "admin-depositos-desafio sem rota REST approve"

log "2/3 Shim — REST manual-deposit-approve (+ crédito desafio_balance)"
dl "scripts/arbishield-serverfn-shim.mjs" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" /opt/arbishield/scripts/arbishield-serverfn-shim.mjs 2>/dev/null || true
for u in arbishield-serverfn-shim.service; do
  if systemctl cat "$u" >/dev/null 2>&1; then
    exec="$(systemctl show -p ExecStart --value "$u" 2>/dev/null | head -1 || true)"
    if [[ "$exec" =~ (/[^[:space:]]+arbishield-serverfn-shim\.mjs) ]]; then
      cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" "${BASH_REMATCH[1]}"
      echo "  wrote ${BASH_REMATCH[1]}"
    fi
  fi
done
grep -q 'manual-deposit-approve' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem rota manual-deposit-approve"
grep -q 'approveManualDeposit' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem approveManualDeposit"
grep -q 'desafio_balance_cents' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem desafio_balance_cents"
grep -q 'serverFn não implementado no shim' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim ainda devolve stub vazio em POST plain"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
sleep 1
curl -sS -o /tmp/dep-api.txt -w "%{http_code}" -X POST "http://127.0.0.1:3101/api/arbishield/manual-deposit-approve" \
  -H "Content-Type: application/json" -d '{}' | tee /tmp/dep-api.code >/dev/null || true
code="$(cat /tmp/dep-api.code 2>/dev/null || echo 000)"
grep -q 'Não autorizado\|id obrigatório\|Acesso negado' /tmp/dep-api.txt \
  || die "shim local não responde em manual-deposit-approve (HTTP $code): $(head -c 160 /tmp/dep-api.txt)"

log "3/3 Nginx — liberar rotas manual-deposit-*"
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
  if ! grep -q 'manual-deposit-approve' "$NGINX_DST"; then
    if grep -q 'desafio-register' "$NGINX_DST"; then
      python3 - "$NGINX_DST" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
old = "match-settle|"
new = "match-settle|manual-deposit-approve|manual-deposit-reject|manual-deposit-mark-credited|"
if "manual-deposit-approve" in t:
    print("já tem rota")
elif old in t:
    p.write_text(t.replace(old, new, 1))
    print("nginx regex atualizado")
else:
    needle = "location ^~ /_serverFn/"
    block = (
        "    location = /api/arbishield/manual-deposit-approve { proxy_pass http://127.0.0.1:3101; "
        "proxy_http_version 1.1; proxy_set_header Host $host; "
        "proxy_set_header Authorization $http_authorization; "
        "proxy_pass_request_headers on; proxy_read_timeout 120s; }\n"
        "    location = /api/arbishield/manual-deposit-reject { proxy_pass http://127.0.0.1:3101; "
        "proxy_http_version 1.1; proxy_set_header Host $host; "
        "proxy_set_header Authorization $http_authorization; "
        "proxy_pass_request_headers on; proxy_read_timeout 120s; }\n"
        "    location = /api/arbishield/manual-deposit-mark-credited { proxy_pass http://127.0.0.1:3101; "
        "proxy_http_version 1.1; proxy_set_header Host $host; "
        "proxy_set_header Authorization $http_authorization; "
        "proxy_pass_request_headers on; proxy_read_timeout 120s; }\n\n"
    )
    if needle in t:
        p.write_text(t.replace(needle, block + "    " + needle, 1))
        print("nginx locations dedicadas inseridas")
    else:
        raise SystemExit("não achei ponto de inserção no nginx")
PY
      nginx -t && systemctl reload nginx || true
    fi
  fi
  if ! grep -q 'location = /admin/depositos-desafio' "$NGINX_DST"; then
    if grep -q 'location = /admin/manual-deposits' "$NGINX_DST"; then
      sed -i '/location = \/admin\/manual-deposits/a\    location = /admin/depositos-desafio { return 302 /admin-depositos-desafio.html; }' "$NGINX_DST"
      nginx -t && systemctl reload nginx || true
    fi
  fi
else
  log "nginx conf não encontrada — confira proxy manual-deposit-* → :3101"
fi

log "OK — hard refresh em /admin-manual-deposits.html e clique Confirmar e Creditar de novo"
log "Depósitos Desafio: /admin-depositos-desafio.html"
log "O PIX pendente (R$ 20) NÃO foi creditado antes — confirme outra vez após o hotfix."
