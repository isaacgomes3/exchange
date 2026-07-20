#!/usr/bin/env bash
# Anti-freeze v3 + LANÇAR DESAFIO estável
# curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/jogos-24h-remove-30min-723d/scripts/vps-hotfix-anti-freeze.sh | bash
set -euo pipefail

BRANCH="${ARBISHIELD_HOTFIX_BRANCH:-cursor/jogos-24h-remove-30min-723d}"
BASE="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}/deploy/vps-supabase/static"
SCRIPT_BASE="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}/scripts"
WWW="${ARBISHIELD_WWW:-/var/www/arbishield}"
OPT="${ARBISHIELD_OPT:-/opt/arbishield}"
TS=$(date +%Y%m%d%H%M%S)
VER=$(date +%s)

echo "==> Anti-freeze v3 ArbiShield (${BRANCH})"
[[ -d "$WWW" ]] || { echo "ERRO: $WWW não existe" >&2; exit 1; }

mkdir -p "$WWW/assets" /tmp/arbishield-antifreeze
cd /tmp/arbishield-antifreeze

curl -fsSL "$BASE/desafio-sugestoes-inject.js" -o desafio-sugestoes-inject.js
curl -fsSL "$BASE/desafio-sugestoes.html" -o desafio-sugestoes.html
curl -fsSL "$BASE/admin-desafios-vps.html" -o admin-desafios-vps.html
curl -fsSL "$SCRIPT_BASE/arbishield-serverfn-shim.mjs" -o arbishield-serverfn-shim.mjs

grep -q 'Anti-freeze ArbiShield — v3' desafio-sugestoes-inject.js || {
  echo "ERRO: inject não é v3" >&2; exit 1
}
grep -qE 'new MutationObserver|MutationObserver\s*\(' desafio-sugestoes-inject.js && {
  echo "ERRO: MutationObserver ativo no inject" >&2; exit 1
}
grep -q 'appendChild(launch)' desafio-sugestoes-inject.js && {
  echo "ERRO: inject move botão React" >&2; exit 1
}
grep -q 'btnLaunch' admin-desafios-vps.html || {
  echo "ERRO: admin sem btnLaunch" >&2; exit 1
}
grep -q 'createDesafio' arbishield-serverfn-shim.mjs || {
  echo "ERRO: shim sem createDesafio" >&2; exit 1
}

for f in \
  "$WWW/assets/desafio-sugestoes-inject.js" \
  "$WWW/desafio-sugestoes.html" \
  "$WWW/admin-desafios-vps.html" \
  "$WWW/index.html"
do
  [[ -f "$f" ]] && cp -a "$f" "$f.bak.$TS" || true
done

cp -f desafio-sugestoes-inject.js "$WWW/assets/desafio-sugestoes-inject.js"
cp -f desafio-sugestoes.html "$WWW/desafio-sugestoes.html"
cp -f admin-desafios-vps.html "$WWW/admin-desafios-vps.html"
chmod 644 "$WWW/assets/desafio-sugestoes-inject.js" \
  "$WWW/desafio-sugestoes.html" "$WWW/admin-desafios-vps.html"

INDEX="$WWW/index.html"
if [[ -f "$INDEX" ]]; then
  sed -i -E '/desafio-sugestoes-inject\.js/d' "$INDEX"
  if grep -q '</body>' "$INDEX"; then
    sed -i "s#</body>#<script src=\"/assets/desafio-sugestoes-inject.js?v=${VER}\" defer></script>\n</body>#" "$INDEX"
  else
    echo "<script src=\"/assets/desafio-sugestoes-inject.js?v=${VER}\" defer></script>" >> "$INDEX"
  fi
fi

# Localiza e atualiza o shim (POST criar desafio)
mapfile -t SHIM_CANDS < <(find /opt /root /home /var/www "$OPT" \
  -name 'arbishield-serverfn-shim.mjs' 2>/dev/null | head -20 || true)
# Também pelo systemd
if command -v systemctl >/dev/null; then
  for unit in arbishield-serverfn serverfn-shim arbishield-desafio-suggestions; do
    if systemctl cat "${unit}.service" >/dev/null 2>&1; then
      exec_line=$(systemctl cat "${unit}.service" 2>/dev/null | grep -E '^ExecStart=' | head -1 || true)
      echo "    unit ${unit}: $exec_line"
      # extrai path .mjs se houver
      if [[ "$exec_line" =~ ([^ =]+\.mjs) ]]; then
        SHIM_CANDS+=("${BASH_REMATCH[1]}")
      fi
    fi
  done
fi

UPDATED_SHIM=0
for cand in "${SHIM_CANDS[@]:-}"; do
  [[ -z "${cand:-}" || ! -f "$cand" ]] && continue
  cp -a "$cand" "$cand.bak.$TS"
  cp -f arbishield-serverfn-shim.mjs "$cand"
  echo "    shim atualizado: $cand"
  UPDATED_SHIM=1
done

# Fallback: grava em local padrão
if [[ "$UPDATED_SHIM" -eq 0 ]]; then
  mkdir -p "$OPT/scripts"
  cp -f arbishield-serverfn-shim.mjs "$OPT/scripts/arbishield-serverfn-shim.mjs"
  echo "    shim gravado em $OPT/scripts/arbishield-serverfn-shim.mjs"
  UPDATED_SHIM=1
fi

# Reinicia serviços relacionados
for unit in arbishield-serverfn serverfn-shim arbishield-desafio-suggestions; do
  systemctl restart "${unit}.service" 2>/dev/null && echo "    restarted ${unit}" || true
done

# Mata processo antigo na 3101 e sobe de novo se necessário
if command -v ss >/dev/null && ss -ltnp 2>/dev/null | grep -q ':3101'; then
  echo "    porta 3101 em uso — tentando restart via systemd já feito"
fi

# Se nada escuta 3101, sobe o shim agora
if command -v ss >/dev/null && ! ss -ltnp 2>/dev/null | grep -q ':3101'; then
  SHIM_RUN="$OPT/scripts/arbishield-serverfn-shim.mjs"
  if [[ -f "$SHIM_RUN" ]]; then
    nohup node "$SHIM_RUN" >/var/log/arbishield-serverfn.log 2>&1 &
    echo "    shim iniciado em background (pid $!)"
    sleep 1
  fi
fi

nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true

echo "==> Teste POST criar desafio"
POST_CODE=$(curl -sS -o /tmp/desafio-post-test.json -w "%{http_code}" -X POST \
  "http://127.0.0.1:3101/api/arbishield/desafios" \
  -H "Content-Type: application/json" \
  -d '{"title":"HOTFIX TEST","is_active":false,"status":"draft","target_profit_pct":5,"initial_balance_cents":1000,"step":{"home_team":"A","away_team":"B","casa_odd":1.7,"arbi_odd":2.2,"casa_stake_cents":1000,"liquidity_cents":200000,"starts_at":"2026-12-01T12:00:00.000Z"}}' \
  || echo "000")
echo "    POST :3101 → HTTP $POST_CODE"
head -c 200 /tmp/desafio-post-test.json 2>/dev/null; echo

echo
echo "OK anti-freeze v3 (v=${VER})."
echo "Abra aba ANÔNIMA → https://arbishield.app/admin/desafios"
echo "LANÇAR DESAFIO deve abrir o modal sem travar."
