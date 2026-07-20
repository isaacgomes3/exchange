#!/usr/bin/env bash
# Anti-freeze definitivo ArbiShield
# Rode NA VPS:
#   curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/jogos-24h-remove-30min-723d/scripts/vps-hotfix-anti-freeze.sh | bash
set -euo pipefail

BRANCH="${ARBISHIELD_HOTFIX_BRANCH:-cursor/jogos-24h-remove-30min-723d}"
BASE="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}/deploy/vps-supabase/static"
SCRIPT_BASE="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}/scripts"
WWW="${ARBISHIELD_WWW:-/var/www/arbishield}"
OPT="${ARBISHIELD_OPT:-/opt/arbishield}"
TS=$(date +%Y%m%d%H%M%S)
VER=$(date +%s)

echo "==> Anti-freeze ArbiShield (${BRANCH})"
[[ -d "$WWW" ]] || { echo "ERRO: $WWW não existe" >&2; exit 1; }

mkdir -p "$WWW/assets" /tmp/arbishield-antifreeze
cd /tmp/arbishield-antifreeze

curl -fsSL "$BASE/desafio-sugestoes-inject.js" -o desafio-sugestoes-inject.js
curl -fsSL "$BASE/desafio-sugestoes.html" -o desafio-sugestoes.html
curl -fsSL "$BASE/admin-desafios-vps.html" -o admin-desafios-vps.html
curl -fsSL "$SCRIPT_BASE/arbishield-serverfn-shim.mjs" -o arbishield-serverfn-shim.mjs || true

# Guardrails
if grep -q 'MutationObserver' desafio-sugestoes-inject.js; then
  echo "ERRO: inject ainda tem MutationObserver" >&2; exit 1
fi
if grep -q 'appendChild(launch)' desafio-sugestoes-inject.js; then
  echo "ERRO: inject ainda move o botão React" >&2; exit 1
fi
if grep -q 'history.pushState' desafio-sugestoes-inject.js; then
  echo "ERRO: inject ainda patcha history (trava SPA)" >&2; exit 1
fi
if ! grep -q 'forceStableDesafiosPage\|Anti-freeze' desafio-sugestoes-inject.js; then
  echo "ERRO: inject sem anti-freeze" >&2; exit 1
fi
if ! grep -q 'btnLaunch' admin-desafios-vps.html; then
  echo "ERRO: admin-desafios sem LANÇAR nativo" >&2; exit 1
fi

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

# index.html: garante script com cache-bust; remove duplicatas
INDEX="$WWW/index.html"
if [[ -f "$INDEX" ]]; then
  # remove qualquer tag antiga do inject
  sed -i -E '/desafio-sugestoes-inject\.js/d' "$INDEX"
  # insere uma única tag limpa antes de </body>
  if grep -q '</body>' "$INDEX"; then
    sed -i "s#</body>#<script src=\"/assets/desafio-sugestoes-inject.js?v=${VER}\" defer></script>\n</body>#" "$INDEX"
  else
    echo "<script src=\"/assets/desafio-sugestoes-inject.js?v=${VER}\" defer></script>" >> "$INDEX"
  fi
fi

# Nginx: /admin/desafios deve ser a página VPS (não SPA)
NGX=""
for cand in \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-enabled/arbishield.app.conf \
  /etc/nginx/conf.d/arbishield.conf \
  /etc/nginx/sites-enabled/arbishield.conf
do
  [[ -f "$cand" ]] && NGX="$cand" && break
done

if [[ -n "$NGX" ]]; then
  if ! grep -q 'location = /admin/desafios' "$NGX"; then
    echo "AVISO: $NGX sem location /admin/desafios — confira nginx-arbishield.app.conf do repo"
  else
    echo "    nginx OK: location /admin/desafios presente ($NGX)"
  fi
  nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
fi

# Shim POST criar desafio
SHIM_DEST=""
for cand in \
  "$OPT/scripts/arbishield-serverfn-shim.mjs" \
  "$OPT/arbishield-serverfn-shim.mjs" \
  /opt/arbishield/scripts/arbishield-serverfn-shim.mjs \
  /root/arbishield/scripts/arbishield-serverfn-shim.mjs
do
  [[ -f "$cand" ]] && SHIM_DEST="$cand" && break
done
if [[ -n "$SHIM_DEST" && -f arbishield-serverfn-shim.mjs ]]; then
  cp -a "$SHIM_DEST" "$SHIM_DEST.bak.$TS"
  cp -f arbishield-serverfn-shim.mjs "$SHIM_DEST"
  echo "    shim: $SHIM_DEST"
  systemctl restart arbishield-serverfn.service 2>/dev/null || \
    systemctl restart serverfn-shim.service 2>/dev/null || \
    systemctl restart arbishield-desafio-suggestions.service 2>/dev/null || true
fi

# Limpa caches de SW no disco do site se existirem referências
echo "==> Verificação local"
rg -n 'MutationObserver|appendChild\(launch\)|history\.pushState' \
  "$WWW/assets/desafio-sugestoes-inject.js" && {
  echo "ERRO: verificação falhou" >&2; exit 1
} || echo "    inject limpo (sem MutationObserver / sem mover botão / sem patch history)"

echo
echo "OK anti-freeze aplicado (v=${VER})."
echo "No navegador: Ctrl+Shift+R em https://arbishield.app/admin e https://arbishield.app/admin/desafios"
echo "Se ainda travar: aba anônima (limpa SW antigo)."
