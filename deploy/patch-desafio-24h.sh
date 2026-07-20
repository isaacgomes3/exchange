#!/usr/bin/env bash
# Atualiza na VPS a página Sugestão de Desafio com janela padrão 24h (1440 min).
# Uso (na VPS, como root ou com sudo):
#   ./deploy/patch-desafio-24h.sh /var/www/arbishield

set -euo pipefail

ROOT_WEB="${1:-/var/www/arbishield}"
SRC="$(cd "$(dirname "$0")" && pwd)/desafio-sugestoes.html"

if [[ ! -f "$SRC" ]]; then
  echo "Arquivo não encontrado: $SRC" >&2
  exit 1
fi

if [[ ! -d "$ROOT_WEB" ]]; then
  echo "Pasta web não encontrada: $ROOT_WEB" >&2
  echo "Passe o caminho do site, ex: ./deploy/patch-desafio-24h.sh /var/www/html" >&2
  exit 1
fi

DEST="$ROOT_WEB/desafio-sugestoes.html"
cp -a "$DEST" "$DEST.bak.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
cp "$SRC" "$DEST"
chmod 644 "$DEST"
echo "OK → $DEST (padrão Janela=1440 min / 24h)"
echo "Abra https://arbishield.app/desafio-sugestoes.html e clique em Atualizar sugestões"
