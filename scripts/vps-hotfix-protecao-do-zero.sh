#!/usr/bin/env bash
# PROTECAO DO ZERO — desativa create/settle antigos na VPS.
#
# Remove da produção as lógicas:
#   1) legado/simples
#   2) fee_upfront
#   3) lock_fee_after
#
# Após este hotfix, criar/liquidar proteção retorna HTTP 501 até
# a nova lógica ser implementada.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-do-zero-47c1/scripts/vps-hotfix-protecao-do-zero.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-do-zero-47c1}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
BACKUP_DIR="${BACKUP_DIR:-/opt/arbishield/backups/protecao-do-zero-$(date +%Y%m%d-%H%M%S)}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$SCRIPTS_DIR" "$SHIM_DIR" "$WEB" "$BACKUP_DIR" "$SCRIPTS_DIR/lib"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

echo
echo "=============================================================="
echo "  PROTECAO DO ZERO — desativar logicas antigas"
echo "=============================================================="
echo

log "0/4 Backup"
PRELIVE="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
[[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]] && \
  PRELIVE="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
SHIM="$SHIM_DIR/arbishield-serverfn-shim.mjs"
[[ -f /opt/arbishield/scripts/arbishield-serverfn-shim.mjs ]] && \
  SHIM="/opt/arbishield/scripts/arbishield-serverfn-shim.mjs"

[[ -f "$PRELIVE" ]] && cp -a "$PRELIVE" "$BACKUP_DIR/arbishield-prelive-events.mjs.bak"
[[ -f "$SHIM" ]] && cp -a "$SHIM" "$BACKUP_DIR/arbishield-serverfn-shim.mjs.bak"
echo "  backup: $BACKUP_DIR"

log "1/4 Prelive :3098 (create/settle stub)"
dl "scripts/arbishield-prelive-events.mjs" "$PRELIVE"
chmod 0755 "$PRELIVE"
cp -f "$PRELIVE" /opt/arbishield/scripts/arbishield-prelive-events.mjs 2>/dev/null || true
grep -q 'PROTECAO_DO_ZERO' "$PRELIVE" || die "prelive sem PROTECAO_DO_ZERO"
grep -q 'protecao-do-zero-v1\|reconstrução (do zero)\|reconstrucao (do zero)\|em reconstrução' "$PRELIVE" \
  || grep -q 'do zero' "$PRELIVE" || die "prelive sem mensagem do zero"
# Anti-regressão: não deve mais liquidar de verdade
grep -q 'async function settleMatchFromBody' "$PRELIVE" || die "settleMatchFromBody ausente"
# O corpo do settle deve ser stub (501)
python3 - "$PRELIVE" <<'PY' || die "settleMatchFromBody ainda parece completo"
import sys
text=open(sys.argv[1],encoding='utf-8',errors='ignore').read()
i=text.find('async function settleMatchFromBody')
j=text.find('async function', i+10)
chunk=text[i:j if j>i else i+800]
if '501' not in chunk and 'do zero' not in chunk.lower():
  raise SystemExit(1)
print('  settle stub ok')
PY
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true

log "2/4 Shim :3101 (settle stub)"
dl "scripts/arbishield-serverfn-shim.mjs" "$SHIM"
chmod 0644 "$SHIM"
cp -f "$SHIM" /opt/arbishield/arbishield-serverfn-shim.mjs 2>/dev/null || true
cp -f "$SHIM" /opt/arbishield/scripts/arbishield-serverfn-shim.mjs 2>/dev/null || true
grep -q 'PROTECAO_DO_ZERO' "$SHIM" || die "shim sem PROTECAO_DO_ZERO"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "3/4 Scaffold + create-protection.ts (se houver app Next)"
mkdir -p "$SCRIPTS_DIR/lib"
dl "scripts/lib/protection-flow-scaffold.mjs" "$SCRIPTS_DIR/lib/protection-flow-scaffold.mjs"
# remove contrato antigo se existir (evita confusão)
if [[ -f "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" ]]; then
  mv "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" \
     "$BACKUP_DIR/protection-flow-contract.mjs.bak"
  echo "  contrato v4 arquivado no backup"
fi

log "4/4 Bloquear hotfixes antigos de proteção (stubs locais)"
mkdir -p "$SCRIPTS_DIR/obsolete-hotfixes"
cat > "$SCRIPTS_DIR/obsolete-hotfixes/ABORT-PROTECAO-ANTIGA.sh" <<'EOF'
#!/usr/bin/env bash
echo "ABORTADO: logica de protecao antiga foi excluida (protecao-do-zero)." >&2
echo "Nao rode hotfixes de settle/fee_upfront/lock_fee/proteger-liquidez." >&2
echo "Implemente a nova logica e use um hotfix novo." >&2
exit 1
EOF
chmod +x "$SCRIPTS_DIR/obsolete-hotfixes/ABORT-PROTECAO-ANTIGA.sh"

# Atalhos que abortam se alguém rodar paths locais antigos
for name in \
  vps-hotfix-proteger-so-com-liquidez.sh \
  vps-hotfix-proteger-sem-liquidez.sh \
  vps-hotfix-settle-arbishield-saldo-real.sh \
  vps-hotfix-settle-credito-carteira.sh \
  vps-hotfix-saldo-protecao-refresh.sh \
  vps-hotfix-consolidado-proteger-settle.sh \
  vps-hotfix-encerrar-protecoes-primeiro.sh \
  vps-hotfix-jogos-liquidar.sh \
  vps-hotfix-salvar-protecao.sh
do
  ln -sfn "$SCRIPTS_DIR/obsolete-hotfixes/ABORT-PROTECAO-ANTIGA.sh" \
    "$SCRIPTS_DIR/$name" 2>/dev/null || true
done

echo
echo "OK — protecao antiga desativada (HTTP 501)."
echo "  Backup: $BACKUP_DIR"
echo "  Scaffold: $SCRIPTS_DIR/lib/protection-flow-scaffold.mjs"
echo "  Teste criar protecao: deve falhar com 'reconstrucao (do zero)'"
echo "  curl -s http://127.0.0.1:3098/health"
echo
