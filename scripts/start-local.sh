#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node scripts/ensure-local-env.mjs

if [ ! -d node_modules ]; then
  echo "Instalando dependências..."
  npm install
fi

echo ""
echo "  Exchange Live — Conexão Local"
echo "  1) Proxy BetBra (seu IP) → porta 8787"
echo "  2) Next.js painel        → porta 3000"
echo ""

node scripts/betbra-local-proxy.mjs &
PROXY_PID=$!

cleanup() {
  kill "$PROXY_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 1

if curl -sf http://127.0.0.1:8787/health > /dev/null 2>&1; then
  echo "✓ Proxy local ativo"
else
  echo "⚠ Proxy ainda iniciando..."
fi

echo "✓ Painel em http://localhost:3000"
echo "✓ Supabase health: http://localhost:3000/api/supabase/health"
echo ""

npm run dev -- --hostname 0.0.0.0 --port 3000
