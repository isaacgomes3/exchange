#!/usr/bin/env bash
# Deploy só do Desafio na VPS (sem Supabase / sem Lovable).
# Uso na VPS:
#   git pull
#   export OPENAI_API_KEY=...
#   ./deploy/vps-deploy.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE="${IMAGE:-arbishield-desafio:latest}"
NAME="${NAME:-arbishield-desafio}"
PORT="${PORT:-3000}"

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "Aviso: OPENAI_API_KEY vazia — vai usar análise heurística local."
fi

docker build -t "$IMAGE" .
docker rm -f "$NAME" 2>/dev/null || true
docker run -d \
  --name "$NAME" \
  --restart unless-stopped \
  -p "127.0.0.1:${PORT}:3000" \
  -e "OPENAI_API_KEY=${OPENAI_API_KEY:-}" \
  -e "OPENAI_MODEL=${OPENAI_MODEL:-gpt-4.1-mini}" \
  "$IMAGE"

echo "OK → http://127.0.0.1:${PORT}/desafio-sugestoes"
echo "Nginx: use deploy/nginx-arbishield-desafio.conf (só /desafio-sugestoes e /api/desafio/puxar)"
