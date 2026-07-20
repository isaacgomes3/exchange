#!/usr/bin/env bash
# Deploy: criar desafios no v2 (UI sugestões + POST /api/arbishield/desafios no :3098)
#
# Uso (root na VPS):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-deploy-desafios-create.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/arbishield-v2-backup-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need systemctl
mkdir -p "$WEB" "$SCRIPTS_DIR"

log "1/3 — UI sugestão + gestão de desafios"
for f in admin-desafio-sugestoes.html admin-desafios.html; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  echo "  ok $f"
done

log "2/3 — worker :3098 (POST /api/arbishield/desafios)"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
if systemctl is-active --quiet arbishield-prelive-events.service 2>/dev/null; then
  systemctl restart arbishield-prelive-events.service
  echo "  prelive :3098 reiniciado"
else
  echo "  AVISO: serviço arbishield-prelive-events inativo"
fi

log "3/3 — smoke local"
sleep 1
code="$(curl -sS -o /tmp/desafios-post-smoke.json -w '%{http_code}' \
  -X POST -H 'Content-Type: application/json' \
  -d '{"title":"smoke-deploy","is_active":false,"total_steps":0}' \
  http://127.0.0.1:3098/api/arbishield/desafios || true)"
echo "  POST /api/arbishield/desafios -> HTTP $code"
head -c 240 /tmp/desafios-post-smoke.json 2>/dev/null || true
echo

if [[ "$code" == "201" || "$code" == "200" ]]; then
  echo "OK — criar desafio disponível"
elif [[ "$code" == "500" ]]; then
  echo "OK parcial — rota existe (erro de negócio/DB). Ver /tmp/desafios-post-smoke.json"
else
  echo "AVISO — esperado 201; confira journalctl -u arbishield-prelive-events -n 40"
fi

echo
echo "Abra https://arbishield.app/admin-desafio-sugestoes.html (hard refresh)"
echo "  → Gerar sugestões → Criar desafio agora"
