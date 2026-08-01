#!/usr/bin/env bash
# Diagnóstico + correção do ambiente de teste em :8090
# Rode na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/ambiente-teste-3cf9/scripts/vps-fix-teste-localhost.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/ambiente-teste-3cf9}"
REF="${ARBISHIELD_REF:-main}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
PORT="${ARBISHIELD_TESTE_PORT:-8090}"
WEB_ROOT="${ARBISHIELD_TESTE_WEB:-/var/www/arbishield-teste}"
CODE_DIR="${ARBISHIELD_TESTE_DIR:-/opt/arbishield-teste}"

log() { echo "==> $*"; }
warn() { echo "AVISO: $*" >&2; }
ok() { echo "  OK  $*"; }
bad() { echo "  FAIL $*"; }

[[ "$(id -u)" -eq 0 ]] || { echo "ERRO: rode como root" >&2; exit 1; }

log "1) Reaplicar enable (conf :$PORT + workers)"
bash <(curl -fsSL "$RAW/scripts/vps-enable-teste.sh?v=3")

log "2) Conferir se a porta $PORT está ouvindo"
if ss -lntp 2>/dev/null | grep -q ":${PORT} "; then
  ok "nginx ouvindo :$PORT"
  ss -lntp | grep ":${PORT} " || true
else
  bad "nada ouvindo :$PORT"
  nginx -t || true
  systemctl status nginx --no-pager -l | head -30 || true
fi

log "3) Smoke local (na própria VPS)"
for u in \
  "http://127.0.0.1:${PORT}/admin-jogos.html" \
  "http://127.0.0.1:3198/health" \
  "http://127.0.0.1:3201/health"
do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$u" || echo 000)"
  if [[ "$code" =~ ^(200|304)$ ]]; then ok "$u → $code"; else bad "$u → $code"; fi
done

log "4) Abrir firewall do SO"
if command -v ufw >/dev/null 2>&1; then
  ufw allow "${PORT}/tcp" comment 'ArbiShield teste' || true
  ufw status | head -20 || true
fi
if command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port="${PORT}/tcp" || true
  firewall-cmd --reload || true
fi
# iptables fallback comum em VPS
if command -v iptables >/dev/null 2>&1; then
  iptables -C INPUT -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null \
    || iptables -I INPUT -p tcp --dport "$PORT" -j ACCEPT || true
fi

PUB_IP="$(curl -4 -fsS --max-time 5 ifconfig.me 2>/dev/null || true)"
[[ -z "$PUB_IP" ]] && PUB_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

echo
echo "=============================================="
echo " COMO ACESSAR (leia com atenção)"
echo "=============================================="
echo
echo "A) Do seu PC pelo IP da VPS (porta precisa estar aberta na Hostinger):"
echo "   http://${PUB_IP:-IP_DA_VPS}:${PORT}/admin-jogos.html"
echo
echo "B) Localhost DE VERDADE no seu PC (recomendado) — túnel SSH:"
echo "   No PowerShell/Terminal do SEU computador:"
echo "   ssh -L ${PORT}:127.0.0.1:${PORT} root@${PUB_IP:-IP_DA_VPS}"
echo "   Depois abra: http://127.0.0.1:${PORT}/admin-jogos.html"
echo
echo "C) Painel Hostinger → VPS → Firewall → liberar TCP ${PORT}"
echo "   (se o painel bloquear, o IP:8090 nunca abre no Chrome)"
echo
echo "NÃO use 127.0.0.1 no Chrome sem o túnel SSH — isso é o seu PC, não a VPS."
echo "=============================================="

# Teste externo rápido a partir da própria VPS (loopback público às vezes falha)
if [[ -n "$PUB_IP" ]]; then
  log "5) Tentativa via IP público (pode falhar se firewall Hostinger bloquear)"
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://${PUB_IP}:${PORT}/admin-jogos.html" || echo 000)"
  if [[ "$code" =~ ^(200|304)$ ]]; then
    ok "http://${PUB_IP}:${PORT}/ → $code (externo OK)"
  else
    bad "http://${PUB_IP}:${PORT}/ → $code"
    warn "Provável bloqueio no Firewall da Hostinger. Use o túnel SSH (opção B) ou libere a porta ${PORT}."
  fi
fi

[[ -f "$WEB_ROOT/v2/TESTE_BUILD.json" ]] && cat "$WEB_ROOT/v2/TESTE_BUILD.json" || true
