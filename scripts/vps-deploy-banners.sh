#!/usr/bin/env bash
# Cria tabela/storage banners + UI admin + shim serverFn
#
# Uso (root na VPS):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-deploy-banners.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/arbishield-v2-backup-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB_V2="${WEB_ROOT}/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
COMPOSE_DIR="${SUPABASE_COMPOSE_DIR:-/opt/arbishield/deploy/vps-supabase}"
SQL_TMP="$(mktemp)"

log() { echo "==> $*"; }
warn() { echo "AVISO: $*" >&2; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need systemctl

mkdir -p "$WEB_V2" "$SCRIPTS_DIR"

cleanup() { rm -f "$SQL_TMP"; }
trap cleanup EXIT

log "1/4 — migration SQL banners"
curl -fsSL "$RAW/supabase/migrations/20260720_banners.sql" -o "$SQL_TMP"

applied=0
if command -v docker >/dev/null 2>&1; then
  for c in supabase-db db arbishield-db; do
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$c"; then
      log "aplicando SQL via docker exec $c"
      docker exec -i "$c" psql -U postgres -d postgres < "$SQL_TMP"
      applied=1
      break
    fi
  done
  if [[ "$applied" -eq 0 ]] && [[ -d "$COMPOSE_DIR" ]]; then
    if (cd "$COMPOSE_DIR" && docker compose ps --status running 2>/dev/null | grep -qE '\bdb\b'); then
      log "aplicando SQL via docker compose db"
      (cd "$COMPOSE_DIR" && docker compose exec -T db psql -U postgres -d postgres < "$SQL_TMP")
      applied=1
    fi
  fi
fi

if [[ "$applied" -eq 0 ]]; then
  warn "não foi possível aplicar SQL automaticamente — rode manualmente:"
  echo "  docker exec -i <container-db> psql -U postgres -d postgres < $SQL_TMP"
else
  echo "  migration ok"
fi

log "2/4 — UI admin-banners"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-banners.html" -o "$WEB_V2/admin-banners.html"
chmod 0644 "$WEB_V2/admin-banners.html"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-banners.html" -o "$WEB_ROOT/admin-banners.html"
chmod 0644 "$WEB_ROOT/admin-banners.html"
echo "  ok admin-banners.html"

log "3/4 — shim serverFn (CRUD banners SPA + suporte)"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
if systemctl is-active --quiet arbishield-serverfn-shim.service 2>/dev/null; then
  systemctl restart arbishield-serverfn-shim.service
  echo "  shim :3101 reiniciado"
else
  warn "arbishield-serverfn-shim inativo — banners SPA podem falhar até subir o serviço"
fi

log "4/4 — smoke REST"
code="$(curl -sS -o /tmp/banners-smoke.json -w '%{http_code}' \
  -H "apikey: ${ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg0NDc5OTk4LCJleHAiOjE5NDIxNTk5OTh9.mxLqs20sCUNn58jWlsD0sznclCOr8rbksjTEAuQee3s}" \
  -H "Authorization: Bearer ${ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg0NDc5OTk4LCJleHAiOjE5NDIxNTk5OTh9.mxLqs20sCUNn58jWlsD0sznclCOr8rbksjTEAuQee3s}" \
  "http://127.0.0.1:8000/rest/v1/banners?select=id&limit=1" 2>/dev/null || true)"
if [[ "$code" == "200" ]]; then
  echo "  REST banners ok (HTTP 200)"
else
  warn "REST banners respondeu HTTP ${code:-?} — confira migration / schema cache"
  [[ -f /tmp/banners-smoke.json ]] && head -c 200 /tmp/banners-smoke.json && echo
fi

echo
echo "OK — Gestão de Banners pronta"
echo "  https://arbishield.app/admin-banners.html (hard refresh)"
echo "  Campos: título, subtítulo, descrição, CTA, imagem, badge, variante, ativo"
