#!/usr/bin/env bash
# Deploy: odds pré-live + fila de jogos (worker :3098 + admin-jogos v2/VPS)
#
# Uso (root na VPS):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-deploy-prelive-odds.sh?v=7")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/arbishield-v2-backup-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB_V2="${WEB_ROOT}/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need systemctl
mkdir -p "$WEB_ROOT" "$WEB_V2" "$SCRIPTS_DIR"

log "1/3 — UI admin-jogos + financeiro (v2 + raiz + VPS)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB_V2/admin-jogos.html"
chmod 0644 "$WEB_V2/admin-jogos.html"
echo "  ok $WEB_V2/admin-jogos.html"

# nginx-arbishield.app.conf: /admin/matches → /admin-jogos.html (raiz do site)
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB_ROOT/admin-jogos.html"
chmod 0644 "$WEB_ROOT/admin-jogos.html"
echo "  ok $WEB_ROOT/admin-jogos.html"

curl -fsSL "$RAW/deploy/vps-supabase/static/admin-jogos-vps.html" -o "$WEB_ROOT/admin-jogos-vps.html"
chmod 0644 "$WEB_ROOT/admin-jogos-vps.html"
echo "  ok $WEB_ROOT/admin-jogos-vps.html"
if [[ -d "$WEB_ROOT/assets" ]]; then
  cp -f "$WEB_ROOT/admin-jogos-vps.html" "$WEB_ROOT/assets/admin-jogos-vps.html" 2>/dev/null || true
fi

curl -fsSL "$RAW/deploy/vps-supabase/static/v2/app-carteira.html" -o "$WEB_V2/app-carteira.html"
chmod 0644 "$WEB_V2/app-carteira.html"
# Espelho na raiz se o shell v2 servir /app-carteira.html fora de /v2/
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/app-carteira.html" -o "$WEB_ROOT/app-carteira.html"
chmod 0644 "$WEB_ROOT/app-carteira.html"
echo "  ok app-carteira.html"

log "2/3 — worker :3098 (várias entradas + odds BetBra)"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
if systemctl is-active --quiet arbishield-prelive-events.service 2>/dev/null; then
  systemctl restart arbishield-prelive-events.service
  echo "  prelive :3098 reiniciado"
else
  echo "  AVISO: serviço arbishield-prelive-events inativo"
fi

# Aguardar worker subir (restart pode demorar 1–3s)
for i in 1 2 3 4 5 6; do
  if curl -fsS -o /dev/null http://127.0.0.1:3098/health 2>/dev/null; then
    break
  fi
  sleep 1
done

log "3/3 — Smoke test"
tmp_list="$(mktemp)"
tmp_detail="$(mktemp)"
cleanup() { rm -f "$tmp_list" "$tmp_detail"; }
trap cleanup EXIT

if ! curl -fsS -o "$tmp_list" --max-time 45 http://127.0.0.1:3098/api/arbishield/prelive-events; then
  echo "  AVISO: catálogo pré-live ainda não respondeu (deploy UI/worker ok)"
else
  eid="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print((d.get("events") or [{}])[0].get("eventId",""))' "$tmp_list" 2>/dev/null || true)"
  echo "  catálogo ok · eventId=${eid:-—}"
  if [[ -n "${eid}" ]]; then
    if curl -fsS -o "$tmp_detail" --max-time 60 \
      "http://127.0.0.1:3098/api/arbishield/prelive-events?eventId=${eid}"; then
      python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
meta=d.get("oddsMeta") or {}
markets=d.get("markets") or []
with_o=sum(1 for m in markets for r in (m.get("runners") or []) if r.get("odd") is not None)
print("  oddsMeta:", meta)
print("  markets=%d runners_with_odd=%d" % (len(markets), with_o))
' "$tmp_detail" || echo "  AVISO: não foi possível ler oddsMeta"
    else
      echo "  AVISO: detalhe do evento falhou (BetBra pode estar lento)"
    fi
  fi
fi

echo
echo "OK — deploy concluído"
echo "  https://arbishield.app/admin-jogos.html (hard refresh / Ctrl+Shift+R)"
echo "  https://arbishield.app/admin/matches → redireciona para a mesma UI"
echo "  https://arbishield.app/v2/admin-jogos.html"
echo "  Agora dá para lançar várias entradas (ex. placares) no mesmo jogo."
echo "  Fila = atuais/ao vivo; rascunhos e finalizados ficam nas outras abas."
