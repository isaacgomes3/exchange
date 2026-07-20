#!/usr/bin/env bash
# ONE-SHOT: resolve travamento + LANÇAR DESAFIO
# Cole no Terminal da VPS (Hostinger):
#   bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/jogos-24h-remove-30min-723d/scripts/vps-fix-agora.sh)
set -euo pipefail

BRANCH="cursor/jogos-24h-remove-30min-723d"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WWW="/var/www/arbishield"
OPT="/opt/arbishield"
VER=$(date +%s)
TS=$(date +%Y%m%d%H%M%S)
TMP=$(mktemp -d)
cd "$TMP"

echo "=========================================="
echo " ArbiShield FIX AGORA (travamento+botão)"
echo "=========================================="

[[ -d "$WWW" ]] || { echo "ERRO: $WWW não existe"; exit 1; }

echo "[1/5] Baixando arquivos..."
curl -fsSL "$RAW/deploy/vps-supabase/static/desafio-sugestoes-inject.js" -o inject.js
curl -fsSL "$RAW/deploy/vps-supabase/static/admin-desafios-vps.html" -o admin.html
curl -fsSL "$RAW/deploy/vps-supabase/static/desafio-sugestoes.html" -o sugestoes.html
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o shim.mjs

grep -q 'Anti-freeze ArbiShield — v4' inject.js || { echo "ERRO: inject não é v4"; exit 1; }
grep -qE 'new MutationObserver|MutationObserver\s*\(' inject.js && { echo "ERRO: observer ativo"; exit 1; }
grep -q 'btnLaunch' admin.html || { echo "ERRO: admin sem botão"; exit 1; }
grep -q 'createDesafio' shim.mjs || { echo "ERRO: shim sem createDesafio"; exit 1; }

echo "[2/5] Backup + instalando frontend..."
mkdir -p "$WWW/assets"
for f in "$WWW/assets/desafio-sugestoes-inject.js" "$WWW/admin-desafios-vps.html" "$WWW/desafio-sugestoes.html" "$WWW/index.html"; do
  [[ -f "$f" ]] && cp -a "$f" "$f.bak.$TS" || true
done
cp -f inject.js "$WWW/assets/desafio-sugestoes-inject.js"
cp -f admin.html "$WWW/admin-desafios-vps.html"
cp -f sugestoes.html "$WWW/desafio-sugestoes.html"
chmod 644 "$WWW/assets/desafio-sugestoes-inject.js" "$WWW/admin-desafios-vps.html" "$WWW/desafio-sugestoes.html"

# index: uma única tag com cache-bust
if [[ -f "$WWW/index.html" ]]; then
  sed -i -E '/desafio-sugestoes-inject\.js/d' "$WWW/index.html"
  sed -i "s#</body>#<script src=\"/assets/desafio-sugestoes-inject.js?v=${VER}\" defer></script>\n</body>#" "$WWW/index.html"
fi

echo "[3/5] Atualizando shim (POST criar desafio)..."
FOUND=0
while IFS= read -r cand; do
  [[ -f "$cand" ]] || continue
  cp -a "$cand" "$cand.bak.$TS"
  cp -f shim.mjs "$cand"
  echo "  → $cand"
  FOUND=1
done < <(find /opt /root /home /var/www -name 'arbishield-serverfn-shim.mjs' 2>/dev/null | head -30)

mkdir -p "$OPT/scripts"
cp -f shim.mjs "$OPT/scripts/arbishield-serverfn-shim.mjs"
echo "  → $OPT/scripts/arbishield-serverfn-shim.mjs"

echo "[4/5] Reiniciando serviços..."
for u in arbishield-serverfn serverfn-shim arbishield-desafio-suggestions; do
  systemctl restart "$u.service" 2>/dev/null && echo "  restarted $u" || true
done

# Garante processo na 3101
if ! ss -ltnp 2>/dev/null | grep -q ':3101'; then
  echo "  subindo shim na :3101"
  # carrega env se existir
  set +e
  [[ -f /opt/arbishield/deploy/vps-supabase/.env ]] && set -a && . /opt/arbishield/deploy/vps-supabase/.env && set +a
  set -e
  nohup node "$OPT/scripts/arbishield-serverfn-shim.mjs" >>/var/log/arbishield-serverfn.log 2>&1 &
  sleep 1
fi

nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true

echo "[5/5] Testes..."
INJ=$(curl -fsS "http://127.0.0.1/assets/desafio-sugestoes-inject.js" | head -2 || true)
echo "  inject: $INJ"
ADM=$(curl -fsS "http://127.0.0.1/admin/desafios" | grep -c btnLaunch || true)
echo "  admin btnLaunch count: $ADM"
POST=$(curl -sS -o /tmp/post.json -w "%{http_code}" -X POST "http://127.0.0.1:3101/api/arbishield/desafios" \
  -H "Content-Type: application/json" \
  -d '{"title":"FIX AGORA","is_active":false,"status":"draft","target_profit_pct":5,"initial_balance_cents":1000,"step":{"home_team":"A","away_team":"B","casa_odd":1.7,"arbi_odd":2.2,"casa_stake_cents":1000,"liquidity_cents":200000,"starts_at":"2026-12-01T12:00:00.000Z"}}' || echo 000)
echo "  POST create: HTTP $POST"
head -c 180 /tmp/post.json 2>/dev/null; echo

echo
echo "=========================================="
echo " PRONTO. Faça isto no navegador:"
echo " 1) Feche TODAS as abas do arbishield.app"
echo " 2) Abra ABA ANÔNIMA"
echo " 3) https://arbishield.app/admin/desafios"
echo " 4) Clique LANÇAR DESAFIO → deve abrir modal"
echo "=========================================="
