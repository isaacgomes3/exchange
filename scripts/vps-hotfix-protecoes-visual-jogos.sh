#!/usr/bin/env bash
# Atualiza Minhas Proteções com o visual dos jogos (Proteger Aposta)
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/protecoes-visual-jogos-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
mkdir -p "$WEB"

echo "==> app-protecoes.html (visual term-row)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/app-protecoes.html" \
  -o "$WEB/app-protecoes.html"
chmod 0644 "$WEB/app-protecoes.html"
grep -q 'prot-term-panel' "$WEB/app-protecoes.html" || { echo "ERRO: HTML sem prot-term-panel"; exit 1; }
grep -q 'term-col-match' "$WEB/app-protecoes.html" || { echo "ERRO: HTML sem term-col-match"; exit 1; }
cp -f "$WEB/app-protecoes.html" "$WEB_ROOT/app-protecoes.html" 2>/dev/null || true

# cache-bust leve se existir referência versionada
echo "OK — Ctrl+F5 em /v2/app-protecoes.html (ou /app/protecoes)"
