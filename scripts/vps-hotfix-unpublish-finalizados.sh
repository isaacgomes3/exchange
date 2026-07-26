#!/usr/bin/env bash
# Finalizados nao podem ficar is_published=true (somem da Fila/grade).
# 1) settle passa a despublicar
# 2) limpa os ja finalizados / fora da janela de 3h
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
mkdir -p "$SCRIPTS_DIR"

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

log "1/3 deploy prelive + shim"
tmp_pre="$(mktemp)"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q 'unpublishExpiredPublishedMatches' "$tmp_pre" || die "prelive sem unpublishExpiredPublishedMatches"
grep -q 'is_published: false' "$tmp_pre" || die "prelive settle sem is_published false"
grep -q 'is_published = false' "$tmp_shim" || die "shim settle sem is_published false"

for dest in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/scripts/arbishield-prelive-events.mjs"
do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_pre" "$dest"
  chmod 0755 "$dest"
  echo "  OK $dest"
done

for dest in \
  "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" \
  "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  "$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs"
do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_shim" "$dest"
  chmod 0755 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_pre" "$tmp_shim"

log "2/3 restart servicos"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || \
  systemctl restart arbishield-shim.service 2>/dev/null || true
sleep 2

log "3/3 limpar finalizados publicados agora"
CLEAN_JSON="$(mktemp)"
CODE="$(curl -sS -o "$CLEAN_JSON" -w "%{http_code}" \
  -X POST "http://127.0.0.1:3098/api/arbishield/unpublish-expired" \
  -H "Content-Type: application/json" \
  -d '{}' || true)"
echo "  HTTP $CODE"
if [[ -s "$CLEAN_JSON" ]]; then
  cat "$CLEAN_JSON"
  echo
fi
if [[ "$CODE" != "200" ]]; then
  log "aviso: endpoint falhou — limpando via service_role no node"
  node - <<'NODE'
const fs = require("fs");
const path = require("path");
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}
for (const f of [
  "/opt/arbishield/deploy/vps-supabase/.env",
  "/opt/arbishield/.env",
  path.resolve("deploy/vps-supabase/.env"),
]) loadEnv(f);
const KEY =
  process.env.ARBISHIELD_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const URL = (
  process.env.ARBISHIELD_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.API_EXTERNAL_URL ||
  "http://127.0.0.1:8000"
).replace(/\/$/, "");
if (!KEY) {
  console.error("SERVICE_ROLE_KEY ausente");
  process.exit(1);
}
const now = new Date().toISOString();
const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
const body = JSON.stringify({ is_published: false, updated_at: now });
const qs = [
  "is_published=eq.true&settled_at=not.is.null",
  "is_published=eq.true&status=in.(settled,finished,closed,cancelled,finalizado)",
  "is_published=eq.true&status_v2=in.(settled,finished,closed,cancelled,finalizado)",
  "is_published=eq.true&starts_at=lt." + encodeURIComponent(cutoff),
];
(async () => {
  let n = 0;
  for (const q of qs) {
    const res = await fetch(`${URL}/rest/v1/matches?${q}`, {
      method: "PATCH",
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body,
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : []; } catch { data = []; }
    if (!res.ok) {
      console.error("PATCH falhou", res.status, String(text).slice(0, 200));
      continue;
    }
    n += Array.isArray(data) ? data.length : 0;
  }
  console.log(JSON.stringify({ ok: true, unpublished: n, cutoff }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE
fi
rm -f "$CLEAN_JSON"

log "OK — finalizados despublicados. Ctrl+Shift+R em Gestao de Jogos / Proteger."
echo "  Celtic so sai da Fila se for despublicado, encerrado, ou passar +3h do kickoff."
