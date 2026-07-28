#!/usr/bin/env bash
# FLUXO_PROTECAO_V1 — deploy create/settle oficiais na VPS.
#
# Fluxo (um PATCH: Congelado → Apostador — sem crédito em dobro):
#   Proteger         → Apostador −R · Congelado +R
#   Reembolso        → Destrava (Congelado → Apostador) e Devolve 100% (API: arbishield)
#   Venceu Exchange  → Destrava (Congelado → Apostador) o stake menos a taxa (API: exchange)
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-do-zero-47c1/scripts/vps-hotfix-protecao-do-zero.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-do-zero-47c1}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
BACKUP_DIR="${BACKUP_DIR:-/opt/arbishield/backups/fluxo-protecao-v1-$(date +%Y%m%d-%H%M%S)}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$SCRIPTS_DIR" "$SHIM_DIR" "$BACKUP_DIR" "$SCRIPTS_DIR/lib"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

echo
echo "=============================================================="
echo "  FLUXO_PROTECAO_V1 — Apostador ↔ Congelado (+ fix Exchange UI)"
echo "=============================================================="
echo

log "0/5 Backup"
PRELIVE="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
[[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]] && \
  PRELIVE="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
SHIM="$SHIM_DIR/arbishield-serverfn-shim.mjs"
[[ -f /opt/arbishield/scripts/arbishield-serverfn-shim.mjs ]] && \
  SHIM="/opt/arbishield/scripts/arbishield-serverfn-shim.mjs"

[[ -f "$PRELIVE" ]] && cp -a "$PRELIVE" "$BACKUP_DIR/arbishield-prelive-events.mjs.bak"
[[ -f "$SHIM" ]] && cp -a "$SHIM" "$BACKUP_DIR/arbishield-serverfn-shim.mjs.bak"
echo "  backup: $BACKUP_DIR"

log "1/5 Prelive :3098 (create/settle V1)"
dl "scripts/arbishield-prelive-events.mjs" "$PRELIVE"
chmod 0755 "$PRELIVE"
cp -f "$PRELIVE" /opt/arbishield/scripts/arbishield-prelive-events.mjs 2>/dev/null || true
grep -q 'FLUXO_PROTECAO_V1' "$PRELIVE" || die "prelive sem FLUXO_PROTECAO_V1"
grep -q 'missingCredit' "$PRELIVE" || die "prelive sem reparo de crédito Exchange"
grep -q 'fluxo-protecao-v1-recredit\|creditedSettlementCents' "$PRELIVE" \
  || die "prelive sem reparo de Reembolso (crédito stake)"
# Anti-regressão: create/settle NÃO devem ser stub 501
python3 - "$PRELIVE" <<'PY' || die "createProtection ainda é stub"
import sys
text=open(sys.argv[1],encoding='utf-8',errors='ignore').read()
i=text.find('async function createProtection')
j=text.find('const CONTESTATION_LOCK_MS', i)
chunk=text[i:j if j>i else i+2000]
if 'protection_lock' not in chunk or 'locked_balance_cents' not in chunk:
    raise SystemExit('create sem lock de carteira')
if 'status = 501' in chunk and 'platform_deduction' not in chunk:
    raise SystemExit('create parece stub 501')
print('  createProtection ok')
i=text.find('async function settleMatchFromBody')
j=text.find('function decodeJwtPayload', i)
chunk=text[i:j if j>i else i+2000]
if 'settleOneProtectionRow' not in chunk:
    raise SystemExit('settle sem settleOneProtectionRow')
if chunk.count('err.status = 501') and 'settleOneProtectionRow' not in chunk:
    raise SystemExit('settle parece stub 501')
print('  settleMatchFromBody ok')
PY
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true

log "2/5 Shim :3101 (settle V1)"
dl "scripts/arbishield-serverfn-shim.mjs" "$SHIM"
chmod 0644 "$SHIM"
cp -f "$SHIM" /opt/arbishield/arbishield-serverfn-shim.mjs 2>/dev/null || true
cp -f "$SHIM" /opt/arbishield/scripts/arbishield-serverfn-shim.mjs 2>/dev/null || true
grep -q 'FLUXO_PROTECAO_V1' "$SHIM" || die "shim sem FLUXO_PROTECAO_V1"
grep -q 'missingCredit' "$SHIM" || die "shim sem reparo de crédito Exchange"
grep -q 'creditedSettlementCents\|fluxo-protecao-v1-recredit' "$SHIM" \
  || die "shim sem reparo de Reembolso (crédito stake)"
grep -q 'creditWalletForSettlement' "$SHIM" || die "shim sem creditWalletForSettlement"
# shim settle não deve ser só throw 501
python3 - "$SHIM" <<'PY' || die "shim settle ainda é stub"
import sys
text=open(sys.argv[1],encoding='utf-8',errors='ignore').read()
i=text.find('async function settleMatch')
# first settleMatch after credit helpers — find the real one near FLUXO
# take the last occurrence of "async function settleMatch(token"
idx=text.rfind('async function settleMatch(token')
if idx<0: raise SystemExit('settleMatch ausente')
chunk=text[idx:idx+2500]
if 'fetchOpenProtections' not in chunk and 'protections' not in chunk and 'outcome' not in chunk:
    raise SystemExit('settleMatch incompleto')
# stub was ~10 lines with only throw 501
if 'Liquidação em reconstrução' in chunk:
    raise SystemExit('settleMatch ainda stub do zero')
print('  settleMatch ok')
PY
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "3/5 Front admin + cliente (Exchange com reembolso)"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
mkdir -p "$WEB"
for f in admin-jogos.html v2-financeiro.js app-protecoes.html app-proteger.html; do
  dl "deploy/vps-supabase/static/v2/$f" "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  updated $WEB/$f"
done
# anti-regressão: admin usa nomenclatura Reembolso / Venceu Exchange
grep -qi 'BATEU ARBISHIELD' "$WEB/admin-jogos.html" \
  && die "admin-jogos ainda diz BATEU ARBISHIELD"
grep -qi 'sem reembolso ao usuário' "$WEB/admin-jogos.html" \
  && die "admin-jogos ainda diz sem reembolso (Exchange)"
grep -q 'REEMBOLSO' "$WEB/admin-jogos.html" || die "admin-jogos sem botão REEMBOLSO"
grep -qi 'VENCEU EXCHANGE' "$WEB/admin-jogos.html" || die "admin-jogos sem botão VENCEU EXCHANGE"
grep -q 'Destrava (Congelado → Apostador) e Devolve 100% do stake' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem texto oficial do Reembolso"
grep -q 'Destrava (Congelado → Apostador) o stake menos a taxa' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem texto oficial do Venceu Exchange"
# sem conceito de fila
grep -qi 'Fila (atuais)' "$WEB/admin-jogos.html" && die "admin-jogos ainda tem Fila (atuais)"
grep -qi 'Tirar da fila' "$WEB/admin-jogos.html" && die "admin-jogos ainda tem Tirar da fila"
# browser: window.ArbiV2Shell (Node `global` quebra com "global is not defined")
grep -q 'window.ArbiV2Shell' "$WEB/app-proteger.html" \
  || die "app-proteger sem window.ArbiV2Shell"
grep -E '\bglobal\.ArbiV2Shell' "$WEB/app-proteger.html" \
  && die "app-proteger ainda usa global.ArbiV2Shell (Node)"
# bust cache leve
touch "$WEB/.fluxo-protecao-v1" 2>/dev/null || true

log "4/5 Scaffold + docs math"
mkdir -p "$SCRIPTS_DIR/lib"
dl "scripts/lib/protection-flow-scaffold.mjs" "$SCRIPTS_DIR/lib/protection-flow-scaffold.mjs"
dl "scripts/protection-flow-v1.test.mjs" "$SCRIPTS_DIR/protection-flow-v1.test.mjs" || true
# arquivar contrato antigo se existir
if [[ -f "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" ]]; then
  mv "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" \
     "$BACKUP_DIR/protection-flow-contract.mjs.bak"
  echo "  contrato antigo arquivado (fee_upfront/lock_fee_after)"
fi

log "5/5 Manter hotfixes antigos bloqueados"
mkdir -p "$SCRIPTS_DIR/obsolete-hotfixes"
cat > "$SCRIPTS_DIR/obsolete-hotfixes/ABORT-PROTECAO-ANTIGA.sh" <<'EOF'
#!/usr/bin/env bash
echo "ABORTADO: use o FLUXO_PROTECAO_V1 (vps-hotfix-protecao-do-zero.sh)." >&2
echo "Nao reinstale fee_upfront / lock_fee_after / settle fragmentados." >&2
exit 1
EOF
chmod +x "$SCRIPTS_DIR/obsolete-hotfixes/ABORT-PROTECAO-ANTIGA.sh"

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
echo "OK — FLUXO_PROTECAO_V1 ativo."
echo "  Backup: $BACKUP_DIR"
echo "  curl -s http://127.0.0.1:3098/health   # fix: fluxo-protecao-v1"
echo "  Teste: proteger R\$500 → Apostador −500 · Congelado +500"
echo "  Reembolso → Destrava + Devolve 100%; Venceu Exchange → Destrava stake−taxa"
echo
