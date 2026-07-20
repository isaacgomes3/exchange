#!/usr/bin/env bash
# Hotfix VPS: restaura LANÇAR DESAFIO + janela 24h + Ambas Marcam
# Rode NA VPS (Hostinger → Terminal / SSH):
#   curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/jogos-24h-remove-30min-723d/scripts/vps-hotfix-lancar-desafio.sh | bash
set -euo pipefail

BRANCH="${ARBISHIELD_HOTFIX_BRANCH:-cursor/jogos-24h-remove-30min-723d}"
BASE="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}/deploy/vps-supabase/static"
SCRIPT_BASE="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}/scripts"
WWW="${ARBISHIELD_WWW:-/var/www/arbishield}"
OPT="${ARBISHIELD_OPT:-/opt/arbishield}"

echo "==> Hotfix ArbiShield (branch ${BRANCH})"
echo "    WWW=${WWW}"

if [[ ! -d "$WWW" ]]; then
  echo "ERRO: pasta não encontrada: $WWW" >&2
  exit 1
fi

mkdir -p "$WWW/assets" /tmp/arbishield-hotfix
cd /tmp/arbishield-hotfix

echo "==> Baixando arquivos..."
curl -fsSL "$BASE/desafio-sugestoes-inject.js" -o desafio-sugestoes-inject.js
curl -fsSL "$BASE/desafio-sugestoes.html" -o desafio-sugestoes.html
curl -fsSL "$BASE/admin-desafios-vps.html" -o admin-desafios-vps.html
curl -fsSL "$SCRIPT_BASE/arbishield-serverfn-shim.mjs" -o arbishield-serverfn-shim.mjs || true

# Sanity: inject NÃO deve mover o botão
if grep -q 'wrap.appendChild(launch)' desafio-sugestoes-inject.js; then
  echo "ERRO: arquivo baixado ainda move o botão React — abortando" >&2
  exit 1
fi
if ! grep -q 'healBrokenWrap' desafio-sugestoes-inject.js; then
  echo "ERRO: hotfix sem healBrokenWrap — abortando" >&2
  exit 1
fi

TS=$(date +%Y%m%d%H%M%S)
echo "==> Backup + instalação..."
for f in \
  "$WWW/assets/desafio-sugestoes-inject.js" \
  "$WWW/desafio-sugestoes.html" \
  "$WWW/admin-desafios-vps.html"
do
  [[ -f "$f" ]] && cp -a "$f" "$f.bak.$TS" || true
done

cp -f desafio-sugestoes-inject.js "$WWW/assets/desafio-sugestoes-inject.js"
cp -f desafio-sugestoes.html "$WWW/desafio-sugestoes.html"
cp -f admin-desafios-vps.html "$WWW/admin-desafios-vps.html"
chmod 644 "$WWW/assets/desafio-sugestoes-inject.js" "$WWW/desafio-sugestoes.html" "$WWW/admin-desafios-vps.html"

# Cache-bust no index.html
INDEX="$WWW/index.html"
if [[ -f "$INDEX" ]]; then
  cp -a "$INDEX" "$INDEX.bak.$TS"
  VER=$(date +%s)
  if grep -q 'desafio-sugestoes-inject\.js' "$INDEX"; then
    sed -i -E "s#<script[^>]*desafio-sugestoes-inject\\.js[^>]*></script>#<script src=\"/assets/desafio-sugestoes-inject.js?v=${VER}\" defer></script>#g" "$INDEX"
  else
    sed -i "s#</body>#<script src=\"/assets/desafio-sugestoes-inject.js?v=${VER}\" defer></script>\n</body>#" "$INDEX"
  fi
  echo "    index.html cache-bust v=${VER}"
fi

# Espelho opcional
if [[ -d "$OPT/arbishield-local" ]]; then
  mkdir -p "$OPT/arbishield-local/assets"
  cp -f desafio-sugestoes-inject.js "$OPT/arbishield-local/assets/"
  cp -f desafio-sugestoes.html "$OPT/arbishield-local/"
  cp -f admin-desafios-vps.html "$OPT/arbishield-local/"
fi

# Atualiza shim (cria desafio via POST) se o arquivo existir no servidor
SHIM_DEST=""
for cand in \
  "$OPT/scripts/arbishield-serverfn-shim.mjs" \
  "$OPT/arbishield-serverfn-shim.mjs" \
  /opt/arbishield/scripts/arbishield-serverfn-shim.mjs
do
  if [[ -f "$cand" ]]; then SHIM_DEST="$cand"; break; fi
done
if [[ -n "$SHIM_DEST" && -f arbishield-serverfn-shim.mjs ]]; then
  cp -a "$SHIM_DEST" "$SHIM_DEST.bak.$TS"
  cp -f arbishield-serverfn-shim.mjs "$SHIM_DEST"
  echo "    shim atualizado: $SHIM_DEST"
  if systemctl list-unit-files 2>/dev/null | grep -q arbishield-serverfn; then
    systemctl restart arbishield-serverfn.service || true
  elif systemctl list-unit-files 2>/dev/null | grep -q serverfn-shim; then
    systemctl restart serverfn-shim.service || true
  fi
fi

echo "==> Verificando..."
curl -fsS -o /dev/null -w "inject HTTP %{http_code}\n" "http://127.0.0.1/assets/desafio-sugestoes-inject.js" || true
head -5 "$WWW/assets/desafio-sugestoes-inject.js"
echo
echo "OK. Agora no navegador: Ctrl+Shift+R em https://arbishield.app/admin/desafios"
echo "O botão LANÇAR DESAFIO deve voltar a abrir o formulário."
