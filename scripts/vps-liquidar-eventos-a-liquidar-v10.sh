#!/usr/bin/env bash
# Liquida eventos A LIQUIDAR (29/07) com placar real + regra v10
# WRAPPER_VER=5 — multi-fonte + reverte ArbiShield→Exchange (Barracas/Lech)
#
# Dry-run:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-v10-fonte-verdade-501d/scripts/vps-liquidar-eventos-a-liquidar-v10.sh?$(date +%s)")
# Aplicar:
#   FIX=1 bash <(curl ...)
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-v10-fonte-verdade-501d}"
BUST="${ARBISHIELD_BUST:-$(date +%s%N)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
JSDELIVR="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
FIX="${FIX:-0}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node
[[ "$(id -u)" -eq 0 ]] || die "rode como root na VPS"
mkdir -p "$SCRIPTS_DIR/lib"

log "wrapper v5 FIX=$FIX ref=$REF"

# Conteúdo válido = código-fonte real (nunca metadata JSON do GitHub API).
is_valid_contract() {
  local f="$1"
  [[ -s "$f" ]] || return 1
  grep -q "protection-flow-contract-v10" "$f" || return 1
  grep -q "stake_lock_v1" "$f" || return 1
  # JSON metadata do API tem "name"/"content" e NÃO tem estas regras
  grep -q "export " "$f" || return 1
  return 0
}

is_valid_liquidar() {
  local f="$1"
  [[ -s "$f" ]] || return 1
  # rejeita metadata JSON (nome do arquivo no JSON passaria em grep frouxo)
  head -c 80 "$f" | grep -q '^{' && return 1
  grep -q 'const TAG = "liquidar-eventos-a-liquidar-v10"' "$f" || return 1
  grep -q 'const EVENTS = \[' "$f" || return 1
  grep -q 'protection-flow-contract' "$f" || return 1
  return 0
}

# Tenta gravar em $out; retorna 0 só se o validador passar.
try_fetch() {
  local url="$1" out="$2" validator="$3"
  local tmp
  tmp="$(mktemp)"
  if curl -fsSL --retry 3 --retry-delay 1 \
    -H "Cache-Control: no-cache" -H "Pragma: no-cache" \
    -H "User-Agent: arbishield-hotfix-v4" \
    "$url" -o "$tmp" 2>/dev/null && "$validator" "$tmp"; then
    mv -f "$tmp" "$out"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

# API raw (Accept) — só aceita se validador passar (evita JSON metadata).
try_fetch_api_raw() {
  local rel="$1" out="$2" validator="$3"
  local tmp
  tmp="$(mktemp)"
  if curl -fsSL --retry 3 --retry-delay 1 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix-v4" \
    "$API/$rel?ref=${REF}&t=${BUST}" -o "$tmp" 2>/dev/null && "$validator" "$tmp"; then
    mv -f "$tmp" "$out"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

# API JSON + base64 (fallback quando raw/CDN atrasados).
try_fetch_api_b64() {
  local rel="$1" out="$2" validator="$3"
  local tmp json
  tmp="$(mktemp)"
  json="$(mktemp)"
  if curl -fsSL --retry 3 --retry-delay 1 \
    -H "Accept: application/json" \
    -H "User-Agent: arbishield-hotfix-v4" \
    "$API/$rel?ref=${REF}&t=${BUST}" -o "$json" 2>/dev/null \
    && node -e '
      const fs=require("fs");
      const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      if(!j.content||j.encoding!=="base64") process.exit(2);
      fs.writeFileSync(process.argv[2], Buffer.from(j.content.replace(/\n/g,""),"base64"));
    ' "$json" "$tmp" 2>/dev/null && "$validator" "$tmp"; then
    mv -f "$tmp" "$out"
    rm -f "$json"
    return 0
  fi
  rm -f "$tmp" "$json"
  return 1
}

download_repo_file() {
  local rel="$1" out="$2" validator="$3"
  local t
  t="$(date +%s%N)"
  log "baixando $rel"
  try_fetch_api_raw "$rel" "$out" "$validator" && return 0
  try_fetch "$RAW/$rel?v=$BUST&t=$t" "$out" "$validator" && return 0
  try_fetch "$JSDELIVR/$rel?t=$t" "$out" "$validator" && return 0
  try_fetch_api_b64 "$rel" "$out" "$validator" && return 0
  die "nao foi possivel baixar/validar: $rel (API/CDN/jsDelivr)"
}

log "1/3 contrato v10"
tmp="$(mktemp)"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$tmp" is_valid_contract
cp -f "$tmp" "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
chmod 0644 "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
rm -f "$tmp"

log "2/3 script liquidação"
tmp="$(mktemp)"
download_repo_file "scripts/vps-liquidar-eventos-a-liquidar-v10.mjs" "$tmp" is_valid_liquidar
cp -f "$tmp" "$SCRIPTS_DIR/vps-liquidar-eventos-a-liquidar-v10.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-liquidar-eventos-a-liquidar-v10.mjs"
rm -f "$tmp"

log "3/3 executar FIX=$FIX"
cd "$SCRIPTS_DIR"
FIX="$FIX" node ./vps-liquidar-eventos-a-liquidar-v10.mjs
