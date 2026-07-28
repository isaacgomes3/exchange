#!/usr/bin/env bash
# OBSOLETO — proteção do zero. Não reinstala lógica antiga.
echo "ABORTADO: logica de protecao antiga excluida (protecao-do-zero)." >&2
echo "Use: scripts/vps-hotfix-protecao-do-zero.sh  (stub 501)" >&2
echo "Depois implemente a nova logica em scripts/lib/protection-flow-scaffold.mjs" >&2
exit 1

# --- abaixo: legado (nao executa) ---
# Hotfix v5: Encerrar partida de verdade (proteção + saldo)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-hotfix-jogos-liquidar.sh?v=5")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/arbishield-v2-backup-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$SHIM_DIR"

log "UI Admin Jogos"
for f in admin-jogos.html v2.css v2-shell.js; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  ok $f"
done

log "Shim :3101 (match-settle)"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "Prelive :3098 (matches mode=settle — rota já existe no nginx)"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
systemctl restart arbishield-prelive-events.service 2>/dev/null || true

log "Nginx match-settle"
for conf in \
  /etc/nginx/conf.d/arbishield-cutover.conf \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/sites-enabled/arbishield \
  /etc/nginx/sites-available/arbishield.app
do
  [[ -f "$conf" ]] || continue
  if ! grep -q 'match-settle' "$conf"; then
    if grep -q 'protection-cancel)' "$conf"; then
      sed -i 's/protection-cancel)/protection-cancel|match-settle)/g' "$conf" || true
      echo "  patched regex $conf"
    fi
  else
    echo "  ok $conf"
  fi
done
if command -v nginx >/dev/null 2>&1; then
  nginx -t && systemctl reload nginx || true
fi

grep -q 'mode: "settle"\|mode: \"settle\"' "$WEB/admin-jogos.html" || \
  grep -q 'mode: "settle"' "$WEB/admin-jogos.html" || \
  grep -q "mode: \"settle\"" "$WEB/admin-jogos.html" || \
  grep -q 'mode.*settle' "$WEB/admin-jogos.html" || die "HTML sem fallback settle"
grep -q 'settleMatchFromBody\|mode === "settle"' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem settle"

sleep 1
CODE=$(curl -sS -o /tmp/settle-smoke.json -w "%{http_code}" -X POST http://127.0.0.1:3098/api/arbishield/matches \
  -H 'Content-Type: application/json' -d '{"mode":"settle"}' || echo 000)
echo "  smoke :3098 settle HTTP $CODE (espera 400/401, não 404)"
grep -q 'not_found' /tmp/settle-smoke.json 2>/dev/null && die "prelive ainda responde not_found para settle" || true

echo
echo "OK — liquidação real"
echo "  https://arbishield.app/admin-jogos.html  (Ctrl+F5)"
echo "  Usa POST /api/arbishield/matches mode=settle (porta 3098)"
echo "  Proteções devem sair de ATIVA e o jogo some de A liquidar"
