#!/usr/bin/env bash
# Publicação versionada do frontend na VPS — substitui os hotfixes por arquivo.
#
# O que muda em relação aos vps-hotfix-*.sh:
#   - baixa o repositório inteiro num commit, não um arquivo de uma branch;
#   - RECUSA publicar commit anterior ao que está no ar (fim da regressão);
#   - instala em releases/<sha> e troca o symlink de forma atômica;
#   - expõe o commit publicado em /__version.json;
#   - cache-bust vem do build, não de sed no servidor.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-publish-release.sh?ref=cursor/release-versionada-vps-4759&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "User-Agent: arbishield-publish") -- --ref main
#
# Opções:
#   --ref <branch|tag|sha>  o que publicar (default: main)
#   --dry-run               baixa, monta e valida sem trocar nada
#   --adopt-webroot         primeira vez: troca o diretório v2 por symlink de release
#   --rollback              volta para a release anterior
#   --force                 publica mesmo sendo anterior/divergente (última instância)
set -euo pipefail

REPO="${ARBISHIELD_REPO:-isaacgomes3/exchange}"
API="https://api.github.com/repos/${REPO}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
LIVE_DIR="$WEB_ROOT/v2"
RELEASES="$WEB_ROOT/releases"
HISTORY="$RELEASES/.history"
KEEP="${ARBISHIELD_KEEP_RELEASES:-5}"
PUBLIC_ORIGIN="${ARBISHIELD_ORIGIN:-https://arbishield.app}"

REF="main"
DRY_RUN=0
ADOPT=0
ROLLBACK=0
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
    --adopt-webroot) ADOPT=1; shift ;;
    --rollback) ROLLBACK=1; shift ;;
    --force) FORCE=1; shift ;;
    *) die "opcao desconhecida: $1" ;;
  esac
done

need curl
need tar
need node
mkdir -p "$RELEASES"

gh_api() {
  local path="$1"
  local auth=()
  [[ -n "${GITHUB_TOKEN:-}" ]] && auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  curl -fsSL --retry 4 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github+json" \
    -H "User-Agent: arbishield-publish" \
    "${auth[@]}" "$API$path"
}

json_field() {
  # json_field <arquivo> <campo> — sem jq, com node (que já é dependência)
  node -e '
    const fs = require("fs");
    try {
      const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const value = data[process.argv[2]];
      if (value != null) process.stdout.write(String(value));
    } catch {}
  ' "$1" "$2"
}

published_commit() {
  local file="$LIVE_DIR/__version.json"
  if [[ -f "$file" ]]; then
    json_field "$file" commit
    return
  fi
  local tmp
  tmp="$(mktemp)"
  if curl -fsSL --max-time 20 "$PUBLIC_ORIGIN/__version.json" -o "$tmp" 2>/dev/null; then
    json_field "$tmp" commit
  fi
  rm -f "$tmp"
}

flip_symlink() {
  local target="$1"
  ln -sfn "$target" "$LIVE_DIR.new"
  mv -Tf "$LIVE_DIR.new" "$LIVE_DIR"
}

reload_web() {
  if command -v nginx >/dev/null 2>&1; then
    nginx -t >/dev/null 2>&1 && nginx -s reload 2>/dev/null || warn "nginx nao recarregou"
  fi
}

confirm_live() {
  local expected="$1"
  local tmp
  tmp="$(mktemp)"
  local got=""
  if curl -fsSL --max-time 20 "$PUBLIC_ORIGIN/__version.json" -o "$tmp" 2>/dev/null; then
    got="$(json_field "$tmp" commit)"
  fi
  rm -f "$tmp"
  if [[ "$got" == "$expected" ]]; then
    log "confirmado no ar: $PUBLIC_ORIGIN/__version.json = ${expected:0:12}"
  else
    warn "no ar respondeu '${got:0:12}' (esperado ${expected:0:12}) — confira o root do nginx"
  fi
}

# ---------------------------------------------------------------- rollback ----
if [[ "$ROLLBACK" == "1" ]]; then
  [[ -f "$HISTORY" ]] || die "sem historico de releases em $HISTORY"
  current="$(published_commit || true)"
  previous="$(grep -v "^${current}$" "$HISTORY" 2>/dev/null | tail -n 1 || true)"
  [[ -n "$previous" ]] || die "sem release anterior registrada"
  [[ -d "$RELEASES/$previous" ]] || die "release anterior $previous nao esta mais no disco"
  log "rollback: ${current:0:12} -> ${previous:0:12}"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "dry-run: nao trocou o symlink"
    exit 0
  fi
  flip_symlink "$RELEASES/$previous"
  printf '%s\n' "$previous" >> "$HISTORY"
  reload_web
  confirm_live "$previous"
  log "OK rollback"
  exit 0
fi

# ------------------------------------------------------------ commit alvo -----
log "1/6 resolvendo $REF"
tmp_commit="$(mktemp)"
gh_api "/commits/${REF}" > "$tmp_commit" || die "nao resolveu $REF no GitHub"
TARGET="$(json_field "$tmp_commit" sha)"
rm -f "$tmp_commit"
[[ -n "$TARGET" ]] || die "commit vazio para $REF"
log "    alvo   ${TARGET:0:12} ($REF)"

CURRENT="$(published_commit || true)"
if [[ -n "$CURRENT" ]]; then
  log "    no ar  ${CURRENT:0:12}"
else
  log "    no ar  <desconhecido — sem __version.json>"
fi

# ------------------------------------------------------- baixar o commit ------
log "2/6 baixando o repositorio no commit"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
curl -fsSL --retry 4 --retry-all-errors --retry-delay 2 \
  -H "User-Agent: arbishield-publish" \
  ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} \
  "$API/tarball/$TARGET" -o "$WORK/src.tar.gz" || die "falha ao baixar tarball"
mkdir -p "$WORK/src"
tar -xzf "$WORK/src.tar.gz" -C "$WORK/src" --strip-components=1
[[ -d "$WORK/src/deploy/vps-supabase/static/v2" ]] || die "tarball sem o diretorio da UI"

# --------------------------------------------- guarda: nunca para tras --------
log "3/6 guarda de regressao"
STATUS="desconhecido"
if [[ -n "$CURRENT" && "$CURRENT" != "$TARGET" ]]; then
  tmp_cmp="$(mktemp)"
  if gh_api "/compare/${CURRENT}...${TARGET}" > "$tmp_cmp" 2>/dev/null; then
    STATUS="$(json_field "$tmp_cmp" status)"
  else
    warn "compare falhou (commit publicado pode nao existir mais no GitHub)"
  fi
  rm -f "$tmp_cmp"
fi
guard_args=(--target "$TARGET" --status "$STATUS")
[[ -n "$CURRENT" ]] && guard_args+=(--current "$CURRENT")
[[ "$FORCE" == "1" ]] && guard_args+=(--force)
if ! node "$WORK/src/scripts/release-cli.mjs" guard "${guard_args[@]}"; then
  echo >&2
  echo "Publicacao abortada para nao regredir o sistema." >&2
  echo "  no ar ${CURRENT:0:12} · alvo ${TARGET:0:12} · compare=$STATUS" >&2
  echo "  Se for intencional (ex.: revert deliberado), repita com --force." >&2
  exit 3
fi

# --------------------------------------------------- montar o artefato --------
log "4/6 montando a release"
STAGING="$WORK/release"
node "$WORK/src/scripts/build-release.mjs" \
  --source "$WORK/src" --out "$STAGING" --commit "$TARGET"
node "$WORK/src/scripts/release-cli.mjs" verify --dir "$STAGING"

if [[ "$DRY_RUN" == "1" ]]; then
  log "dry-run: artefato validado, nada foi instalado"
  log "    ficaria em $RELEASES/$TARGET"
  exit 0
fi

# --------------------------------------------------------- instalar -----------
log "5/6 instalando releases/${TARGET:0:12}"
DEST="$RELEASES/$TARGET"
rm -rf "$DEST.tmp"
cp -a "$STAGING" "$DEST.tmp"
rm -rf "$DEST"
mv "$DEST.tmp" "$DEST"
chmod -R a+rX "$DEST"

if [[ -L "$LIVE_DIR" ]]; then
  flip_symlink "$DEST"
elif [[ -e "$LIVE_DIR" ]]; then
  if [[ "$ADOPT" == "1" ]]; then
    backup="$WEB_ROOT/v2.pre-release-$(date +%Y%m%d%H%M%S)"
    log "    guardando o diretorio atual em $backup"
    mv "$LIVE_DIR" "$backup"
    flip_symlink "$DEST"
  else
    warn "$LIVE_DIR e um diretorio comum — release instalada mas NAO publicada"
    warn "rode uma vez com --adopt-webroot para trocar por symlink de release"
    exit 4
  fi
else
  flip_symlink "$DEST"
fi

printf '%s\n' "$TARGET" >> "$HISTORY"

# --------------------------------------------------------- limpeza ------------
log "6/6 retencao (mantendo $KEEP) + reload"
mapfile -t keep_list < <(tac "$HISTORY" | awk '!seen[$0]++' | head -n "$KEEP")
for dir in "$RELEASES"/*; do
  [[ -d "$dir" ]] || continue
  name="$(basename "$dir")"
  keep=0
  for k in "${keep_list[@]}"; do [[ "$name" == "$k" ]] && keep=1; done
  [[ "$keep" == "1" ]] && continue
  rm -rf "$dir"
  echo "    removida release antiga ${name:0:12}"
done

reload_web
confirm_live "$TARGET"

log "OK release ${TARGET:0:12} publicada"
echo "  ref        $REF"
echo "  commit     $TARGET"
echo "  diretorio  $DEST"
echo "  versao     $PUBLIC_ORIGIN/__version.json"
echo "  rollback   bash $0 --rollback"
