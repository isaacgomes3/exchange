#!/usr/bin/env bash
# Diagnóstico + FORCE descongelar Carlos (com VERIFY locked=0).
#
# Na VPS (root) — cole a saída se ainda falhar:
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-diag-descongelar-carlos.sh?$(date +%s)" -o /tmp/diag-carlos.sh
#   bash /tmp/diag-carlos.sh
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$SCRIPTS_DIR"

log "Checando .env na VPS"
for f in \
  /opt/arbishield/deploy/vps-supabase/.env \
  /opt/arbishield/.env \
  /opt/arbishield/scripts/.env \
  /root/.arbishield.env
do
  if [[ -f "$f" ]]; then
    echo "  OK $f ($(wc -c <"$f") bytes)"
    grep -E '^(SERVICE_ROLE_KEY|ARBISHIELD_SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_URL|ARBISHIELD_SUPABASE_URL|API_EXTERNAL_URL)=' "$f" \
      | sed -E 's/=.*/=***/' || true
  else
    echo "  -- $f"
  fi
done

download_repo_file() {
  local rel="$1" out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

log "Baixar script"
tmp="$(mktemp)"
download_repo_file "scripts/vps-diag-descongelar-carlos.mjs" "$tmp"
cp -f "$tmp" "$SCRIPTS_DIR/vps-diag-descongelar-carlos.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-diag-descongelar-carlos.mjs"
rm -f "$tmp"

log "1) DRY-RUN"
set +e
(cd "$SCRIPTS_DIR" && node ./vps-diag-descongelar-carlos.mjs)
dry_rc=$?
set -e
echo "  dry-run exit=$dry_rc"

log "2) FIX=1 (devolve stake + cobra fees)"
set +e
(cd "$SCRIPTS_DIR" && FIX=1 node ./vps-diag-descongelar-carlos.mjs)
fix_rc=$?
set -e
echo "  fix exit=$fix_rc"

if [[ "$fix_rc" -ne 0 ]]; then
  log "3) FALLBACK UNLOCK_ONLY=1 (devolve stake, sem fees)"
  (cd "$SCRIPTS_DIR" && UNLOCK_ONLY=1 FIX=1 node ./vps-diag-descongelar-carlos.mjs)
fi

echo
echo "=========================================="
echo "Se ainda mostrar Congelado R\$ 1.000:"
echo "  1) Cole TODA a saída deste script"
echo "  2) No Financeiro: Ctrl+Shift+R (hard refresh)"
echo "  3) Confirme se está impersonando o Carlos certo"
echo "=========================================="
