#!/usr/bin/env bash
# Publicação versionada do backend (shim :3101) — o que faltava depois do frontend.
#
# Por que existe: o shim era publicado por dezenas de hotfixes que gravavam em
# caminhos diferentes. O systemd executa /opt/arbishield/scripts/, mas havia
# cópia mais nova (e diferente) na raiz — então "atualizar o shim" às vezes não
# mudava nada do que rodava. Aqui há um caminho só, com guarda e rollback.
#
# O que o script garante:
#   - recusa publicar commit anterior/divergente ao que está no ar (guarda);
#   - `node --check` antes de trocar qualquer arquivo;
#   - backup do conjunto atual (shim + lib) antes da troca;
#   - grava .shim-release.json → /health passa a dizer o commit publicado;
#   - depois do restart, valida /health e **volta sozinho** se ficar ruim;
#   - sincroniza as outras cópias no disco para grep não mentir mais.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-publish-shim.sh?ref=main&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "User-Agent: arbishield-publish") -- --ref main
#
# Opções: --ref <branch|sha> · --dry-run · --rollback · --force · --list
set -euo pipefail

REPO="${ARBISHIELD_REPO:-isaacgomes3/exchange}"
API="https://api.github.com/repos/${REPO}"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
RUN_DIR="$SHIM_DIR/scripts"                 # o que o systemd executa
SIDECAR="$RUN_DIR/.shim-release.json"
BACKUPS="$SHIM_DIR/backups"
SERVICE="${ARBISHIELD_SHIM_SERVICE:-arbishield-serverfn-shim}"
HEALTH_URL="${ARBISHIELD_SHIM_HEALTH:-http://127.0.0.1:3101/health}"
HEALTH_TRIES="${ARBISHIELD_HEALTH_TRIES:-20}"

REF="main"
DRY_RUN=0
ROLLBACK=0
LIST=0
FORCE=0

log() { echo "==> $*"; }
warn() { echo "aviso: $*" >&2; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --) shift ;;
    --ref) REF="${2:?--ref exige valor}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --rollback) ROLLBACK=1; shift ;;
    --list) LIST=1; shift ;;
    --force) FORCE=1; shift ;;
    *) die "opcao desconhecida: $1" ;;
  esac
done

need curl
need tar
need node
mkdir -p "$BACKUPS"

gh_api() {
  local auth=()
  [[ -n "${GITHUB_TOKEN:-}" ]] && auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  curl -fsSL --retry 4 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github+json" -H "User-Agent: arbishield-publish" \
    "${auth[@]}" "$API$1"
}

json_field() {
  node -e '
    const fs = require("fs");
    try {
      const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const v = process.argv[2].split(".").reduce((a, k) => (a == null ? a : a[k]), d);
      if (v != null) process.stdout.write(String(v));
    } catch {}
  ' "$1" "$2"
}

published_commit() {
  [[ -f "$SIDECAR" ]] && json_field "$SIDECAR" commit
}

health_json() {
  curl -fsS --max-time 8 "$HEALTH_URL" 2>/dev/null || true
}

# Saúde aceitável: ok=true e os marcadores do contrato presentes.
health_ok() {
  local tmp body
  tmp="$(mktemp)"
  body="$(health_json)"
  [[ -z "$body" ]] && { rm -f "$tmp"; return 1; }
  printf '%s' "$body" > "$tmp"
  local ok model contract
  ok="$(json_field "$tmp" ok)"
  model="$(json_field "$tmp" createProtectionModel)"
  contract="$(json_field "$tmp" protectionFlowContract)"
  rm -f "$tmp"
  [[ "$ok" == "true" ]] || return 1
  [[ "$model" == "stake_lock_v1" ]] || return 1
  [[ -n "$contract" ]] || return 1
  return 0
}

wait_health() {
  local i
  for ((i = 1; i <= HEALTH_TRIES; i++)); do
    health_ok && return 0
    sleep 1
  done
  return 1
}

restart_service() {
  systemctl restart "${SERVICE}.service" 2>/dev/null \
    || warn "systemctl restart falhou — confira o servico ${SERVICE}"
}

snapshot() {
  local dest="$1"
  mkdir -p "$dest/lib"
  [[ -f "$RUN_DIR/arbishield-serverfn-shim.mjs" ]] \
    && cp -a "$RUN_DIR/arbishield-serverfn-shim.mjs" "$dest/"
  [[ -f "$SIDECAR" ]] && cp -a "$SIDECAR" "$dest/" || true
  if [[ -d "$RUN_DIR/lib" ]]; then
    cp -a "$RUN_DIR/lib/." "$dest/lib/" 2>/dev/null || true
  fi
}

restore() {
  local from="$1"
  [[ -f "$from/arbishield-serverfn-shim.mjs" ]] || die "backup $from sem o shim"
  cp -f "$from/arbishield-serverfn-shim.mjs" "$RUN_DIR/arbishield-serverfn-shim.mjs"
  [[ -d "$from/lib" ]] && cp -a "$from/lib/." "$RUN_DIR/lib/" 2>/dev/null || true
  if [[ -f "$from/.shim-release.json" ]]; then
    cp -f "$from/.shim-release.json" "$SIDECAR"
  else
    rm -f "$SIDECAR"
  fi
  restart_service
}

# -------------------------------------------------------------------- list ----
if [[ "$LIST" == "1" ]]; then
  cur="$(published_commit || true)"
  log "shim em execucao: ${cur:-<sem .shim-release.json>}"
  echo "  arquivo  $RUN_DIR/arbishield-serverfn-shim.mjs"
  echo "  sha256   $(sha256sum "$RUN_DIR/arbishield-serverfn-shim.mjs" 2>/dev/null | cut -c1-16)"
  echo "  health   $(health_ok && echo OK || echo RUIM)"
  log "backups disponiveis"
  found=0
  for d in "$BACKUPS"/shim-*; do
    [[ -d "$d" ]] || continue
    c=""
    [[ -f "$d/.shim-release.json" ]] && c="$(json_field "$d/.shim-release.json" commit)"
    printf '   %s  %s\n' "$(basename "$d")" "${c:0:12}"
    found=1
  done
  [[ "$found" == "1" ]] || echo "   (nenhum)"
  exit 0
fi

# ---------------------------------------------------------------- rollback ----
if [[ "$ROLLBACK" == "1" ]]; then
  last="$(ls -1d "$BACKUPS"/shim-* 2>/dev/null | tail -n 1 || true)"
  [[ -n "$last" ]] || die "sem backup para voltar"
  log "rollback para $last"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "dry-run: nada alterado"
    exit 0
  fi
  restore "$last"
  if wait_health; then
    log "OK rollback — health saudavel"
  else
    warn "health segue ruim depois do rollback — investigar manualmente"
    exit 6
  fi
  exit 0
fi

# ------------------------------------------------------------ commit alvo -----
log "1/7 resolvendo $REF"
tmp="$(mktemp)"
gh_api "/commits/${REF}" > "$tmp" || die "nao resolveu $REF"
TARGET="$(json_field "$tmp" sha)"
rm -f "$tmp"
[[ -n "$TARGET" ]] || die "commit vazio para $REF"
CURRENT="$(published_commit || true)"
log "    alvo   ${TARGET:0:12} ($REF)"
log "    no ar  ${CURRENT:-<desconhecido — sem .shim-release.json>}"

# ------------------------------------------------------- baixar o commit ------
log "2/7 baixando o repositorio no commit"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
curl -fsSL --retry 4 --retry-all-errors --retry-delay 2 \
  -H "User-Agent: arbishield-publish" \
  ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} \
  "$API/tarball/$TARGET" -o "$WORK/src.tar.gz" || die "falha ao baixar tarball"
mkdir -p "$WORK/src"
tar -xzf "$WORK/src.tar.gz" -C "$WORK/src" --strip-components=1
NEW_SHIM="$WORK/src/scripts/arbishield-serverfn-shim.mjs"
[[ -f "$NEW_SHIM" ]] || die "tarball sem scripts/arbishield-serverfn-shim.mjs"
[[ -d "$WORK/src/scripts/lib" ]] || die "tarball sem scripts/lib"

# --------------------------------------------- guarda: nunca para tras --------
log "3/7 guarda de regressao"
STATUS="desconhecido"
if [[ -n "$CURRENT" && "$CURRENT" != "$TARGET" ]]; then
  tmpc="$(mktemp)"
  if gh_api "/compare/${CURRENT}...${TARGET}" > "$tmpc" 2>/dev/null; then
    STATUS="$(json_field "$tmpc" status)"
  else
    warn "compare falhou"
  fi
  rm -f "$tmpc"
fi
gargs=(--target "$TARGET" --status "$STATUS")
[[ -n "$CURRENT" ]] && gargs+=(--current "$CURRENT")
[[ "$FORCE" == "1" ]] && gargs+=(--force)
if ! node "$WORK/src/scripts/release-cli.mjs" guard "${gargs[@]}"; then
  echo >&2
  echo "Publicacao do backend abortada para nao regredir o sistema." >&2
  echo "  no ar ${CURRENT:0:12} · alvo ${TARGET:0:12} · compare=$STATUS" >&2
  echo "  Se for intencional, repita com --force." >&2
  exit 3
fi

# --------------------------------------------------- checagem de sintaxe ------
log "4/7 checando sintaxe do shim novo"
node --check "$NEW_SHIM" || die "shim novo nao passa no node --check"
for f in "$WORK/src/scripts/lib"/*.mjs; do
  [[ -f "$f" ]] || continue
  node --check "$f" || die "lib nao passa no node --check: $(basename "$f")"
done

if [[ "$DRY_RUN" == "1" ]]; then
  log "dry-run: sintaxe OK, nada instalado nem reiniciado"
  exit 0
fi

# --------------------------------------------------------- backup + troca -----
STAMP="$(date +%Y%m%d%H%M%S)"
BK="$BACKUPS/shim-$STAMP"
log "5/7 backup em $BK"
snapshot "$BK"

log "6/7 instalando e reiniciando"
mkdir -p "$RUN_DIR/lib"
cp -f "$NEW_SHIM" "$RUN_DIR/arbishield-serverfn-shim.mjs"
cp -a "$WORK/src/scripts/lib/." "$RUN_DIR/lib/"
cat > "$SIDECAR" <<JSON
{
  "contract": "shim-release-v1",
  "commit": "$TARGET",
  "ref": "$REF",
  "publishedAt": "$(date -Is)"
}
JSON
chmod 0644 "$RUN_DIR/arbishield-serverfn-shim.mjs" "$SIDECAR"

# Cópias paralelas existiam e faziam grep mentir — mantém todas iguais.
for extra in "$SHIM_DIR/arbishield-serverfn-shim.mjs"; do
  [[ -e "$extra" ]] && cp -f "$NEW_SHIM" "$extra"
done
if [[ -d "$SHIM_DIR/lib" ]]; then
  cp -a "$WORK/src/scripts/lib/." "$SHIM_DIR/lib/"
fi

restart_service

# ------------------------------------------ verificar e voltar se ruim --------
log "7/7 verificando health"
if wait_health; then
  body="$(health_json)"
  log "OK shim ${TARGET:0:12} publicado"
  echo "  health $(printf '%s' "$body" | head -c 320)"
  echo "  backup $BK"
  echo "  rollback  bash $0 --rollback"
  exit 0
fi

warn "health nao ficou saudavel — voltando para o backup"
restore "$BK"
if wait_health; then
  warn "revertido: o shim anterior voltou e o health esta OK"
else
  warn "revertido, mas o health segue ruim — investigar $SERVICE"
fi
exit 7
