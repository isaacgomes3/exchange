#!/usr/bin/env bash
# Deploy: odds pré-live (worker :3098 + admin-jogos)
#
# Uso (root na VPS):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-deploy-prelive-odds.sh?v=1")
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

log "1/2 — UI admin-jogos"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
echo "  ok admin-jogos.html"

log "2/2 — worker :3098 (extração de odds BetBra)"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
if systemctl is-active --quiet arbishield-prelive-events.service 2>/dev/null; then
  systemctl restart arbishield-prelive-events.service
  echo "  prelive :3098 reiniciado"
else
  echo "  AVISO: serviço arbishield-prelive-events inativo"
fi

sleep 1
# smoke: primeiro evento do catálogo
eid="$(curl -fsS http://127.0.0.1:3098/api/arbishield/prelive-events | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("events") or [{}])[0].get("eventId",""))' || true)"
if [[ -n "$eid" ]]; then
  curl -fsS "http://127.0.0.1:3098/api/arbishield/prelive-events?eventId=${eid}" | python3 - <<'PY'
import json,sys
d=json.load(sys.stdin)
meta=d.get("oddsMeta") or {}
print("  oddsMeta:", meta)
markets=d.get("markets") or []
with_o=sum(1 for m in markets for r in m.get("runners") or [] if r.get("odd") is not None)
print(f"  markets={len(markets)} runners_with_odd={with_o}")
PY
fi

echo
echo "OK — abra https://arbishield.app/admin-jogos.html (hard refresh)"
echo "  Mercados sem liquidez BetBra aparecem como “sem liquidez”."
