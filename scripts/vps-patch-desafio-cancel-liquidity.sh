#!/usr/bin/env bash
# Patch DIRETO no shim :3101 — remove used_liquidity_cents do cancel Desafio.
# Use se o hotfix completo nao pegou o processo certo.
#
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-cancelar-entrada-9c21/scripts/vps-patch-desafio-cancel-liquidity.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/desafio-cancelar-entrada-9c21}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need python3
# ss/lsof opcionais
HAS_SS=0; command -v ss >/dev/null 2>&1 && HAS_SS=1
HAS_LSOF=0; command -v lsof >/dev/null 2>&1 && HAS_LSOF=1

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

log "1) localizar processo na porta 3101 (desafio-cancel)"
PIDS=""
if [[ "$HAS_SS" == "1" ]]; then
  PIDS="$(ss -ltnp 2>/dev/null | awk '/:3101 /{print}' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
fi
if [[ -z "$PIDS" && "$HAS_LSOF" == "1" ]]; then
  PIDS="$(lsof -tiTCP:3101 -sTCP:LISTEN 2>/dev/null || true)"
fi
echo "  pids: ${PIDS:-<nenhum>}"

TARGET_FILES=()
for pid in $PIDS; do
  if [[ -r "/proc/$pid/cmdline" ]]; then
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline")"
    echo "  pid $pid: $cmd"
    for part in $cmd; do
      if [[ "$part" == *.mjs && -f "$part" ]]; then
        TARGET_FILES+=("$part")
      fi
    done
    if [[ -r "/proc/$pid/cwd" ]]; then
      cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
      for part in $cmd; do
        if [[ "$part" == *.mjs && -n "$cwd" && -f "$cwd/$part" ]]; then
          TARGET_FILES+=("$cwd/$part")
        fi
      done
    fi
  fi
done

for f in \
  "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" \
  /opt/arbishield/arbishield-serverfn-shim.mjs \
  /opt/arbishield/scripts/arbishield-serverfn-shim.mjs \
  /root/arbishield/scripts/arbishield-serverfn-shim.mjs
do
  [[ -f "$f" ]] && TARGET_FILES+=("$f")
done

for u in arbishield-serverfn-shim.service arbishield-shim.service arbishield-api.service; do
  exec="$(systemctl show -p ExecStart --value "$u" 2>/dev/null || true)"
  if [[ "$exec" =~ (/[^[:space:]]+arbishield-serverfn-shim\.mjs) ]]; then
    TARGET_FILES+=("${BASH_REMATCH[1]}")
  elif [[ "$exec" =~ (/[^[:space:]]+\.mjs) ]]; then
    TARGET_FILES+=("${BASH_REMATCH[1]}")
  fi
done

# unique sem mapfile (bash antigo)
UNIQ_FILES=()
for f in "${TARGET_FILES[@]}"; do
  [[ -z "$f" || ! -f "$f" ]] && continue
  skip=0
  for u in "${UNIQ_FILES[@]:-}"; do
    [[ "$u" == "$f" ]] && skip=1 && break
  done
  [[ "$skip" == "1" ]] || UNIQ_FILES+=("$f")
done
TARGET_FILES=("${UNIQ_FILES[@]}")
[[ ${#TARGET_FILES[@]} -gt 0 ]] || die "nenhum shim .mjs encontrado"
echo "  arquivos:"
printf '    %s\n' "${TARGET_FILES[@]}"

log "2) baixar shim novo (v2)"
tmp="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp"
grep -q 'desafio-cancel-sem-used-liquidity-v2' "$tmp" || die "download sem marker v2"
! grep -q 'select=id,status,starts_at,desafio_id,used_liquidity_cents' "$tmp" \
  || die "download ainda seleciona used_liquidity no cancel"

log "3) instalar em todos os caminhos + patch de seguranca"
for f in "${TARGET_FILES[@]}"; do
  [[ -f "$f" ]] || continue
  cp -a "$f" "${f}.bak-cancel-liq-$(date +%s)" 2>/dev/null || true
  cp -f "$tmp" "$f"
  chmod 0644 "$f"
  python3 - "$f" <<'PY'
import sys
path = sys.argv[1]
src = open(path, "r", encoding="utf-8", errors="ignore").read()
orig = src
src = src.replace(
    "select=id,status,starts_at,desafio_id,used_liquidity_cents",
    "select=id,status,starts_at,desafio_id",
)
src = src.replace(
    "select=id,status,starts_at,used_liquidity_cents,desafio_id",
    "select=id,status,starts_at,desafio_id",
)
if src != orig:
    open(path, "w", encoding="utf-8").write(src)
    print("  patched in-place", path)
else:
    print("  OK", path)
PY
  grep -q 'desafio-cancel-sem-used-liquidity-v2' "$f" || die "falha marker em $f"
done
rm -f "$tmp"

log "4) reiniciar servicos"
for u in arbishield-serverfn-shim.service arbishield-shim.service arbishield-api.service; do
  if systemctl cat "$u" >/dev/null 2>&1; then
    systemctl restart "$u" && echo "  restarted $u" || echo "  AVISO: restart $u falhou"
  fi
done

sleep 1
NEW_PIDS=""
if [[ "$HAS_SS" == "1" ]]; then
  NEW_PIDS="$(ss -ltnp 2>/dev/null | awk '/:3101 /{print}' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
fi
echo "  3101 pids apos restart: ${NEW_PIDS:-<nenhum>}"
CONFIRMED=0
for pid in $NEW_PIDS; do
  if [[ -r "/proc/$pid/cmdline" ]]; then
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline")"
    echo "  running: $cmd"
    for part in $cmd; do
      if [[ "$part" == *.mjs && -f "$part" ]]; then
        if grep -q 'desafio-cancel-sem-used-liquidity-v2' "$part"; then
          echo "  CONFIRMADO v2 em $part"
          CONFIRMED=1
        else
          echo "  AVISO: $part SEM marker v2"
        fi
      fi
    done
  fi
done
[[ "$CONFIRMED" == "1" ]] || echo "  AVISO: nao confirmei marker no pid :3101 — confira systemctl status"

log "OK — teste Cancelar entrada de novo (Ctrl+Shift+R antes)."
echo "  marker: desafio-cancel-sem-used-liquidity-v2"
echo "  endpoint: POST /api/arbishield/desafio-cancel → :3101"
