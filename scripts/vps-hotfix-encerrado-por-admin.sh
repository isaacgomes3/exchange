#!/usr/bin/env bash
# Hotfix: ao encerrar evento, grava settled_by + nome e mostra
#   "Encerrado por: <admin>" na Gestão de Jogos (aba Encerrado).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-encerrado-por-admin.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-}}"

echo "==> vps-hotfix-encerrado-por-admin.sh ($(date -Is))"

# 1) Backend settle (prelive + shim)
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
grep -q 'settled_by_name' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || {
  echo "ERRO: prelive sem settled_by_name"
  exit 1
}
grep -q 'settled_by: adminId' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || {
  echo "ERRO: prelive sem settled_by"
  exit 1
}

curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'settled_by_name' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || {
  echo "ERRO: shim sem settled_by_name"
  exit 1
}

# 2) UI admin-jogos
TMP="$(mktemp)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$TMP"
grep -q 'Encerrado por:' "$TMP" || {
  echo "ERRO: admin-jogos.html sem 'Encerrado por:'"
  exit 1
}
grep -q 'settled_by_name' "$TMP" || {
  echo "ERRO: admin-jogos.html sem settled_by_name"
  exit 1
}

n=0
while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-encerrado-por-$(date +%s)" 2>/dev/null || true
  cp -f "$TMP" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
  n=$((n + 1))
done < <(find /var/www -type f -name 'admin-jogos.html' -print0 2>/dev/null)
rm -f "$TMP"
echo "==> admin-jogos.html: $n arquivo(s)"

# 3) Restart services
systemctl restart arbishield-prelive-events.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-prelive-events-teste.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim-teste.service 2>/dev/null || true

# 4) Backfill metadata.settled_by_name em partidas já encerradas
if [[ -n "$SERVICE_KEY" ]]; then
  echo "==> backfill Encerrado por (metadata.settled_by_name)…"
  python3 - <<'PY' || echo "AVISO: backfill falhou (UI ainda resolve via profiles)"
import json, os, urllib.request, urllib.error

url = os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321").rstrip("/")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SERVICE_ROLE_KEY") or ""
headers = {
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

def get(path):
    req = urllib.request.Request(url + path, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

def patch(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url + path, data=data, headers=headers, method="PATCH")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode() or "[]")

matches = get(
    "/rest/v1/matches?or=(status.eq.settled,status_v2.eq.closed,status_v2.eq.settled,settled_at.not.is.null)"
    "&select=id,settled_by,updated_by,metadata,settled_at&deleted_at=is.null&limit=200"
)
if not isinstance(matches, list):
    matches = []

admin_ids = set()
for m in matches:
    meta = m.get("metadata") if isinstance(m.get("metadata"), dict) else {}
    aid = m.get("settled_by") or meta.get("settled_by") or (m.get("updated_by") if m.get("settled_at") else None)
    if aid:
        admin_ids.add(str(aid))

name_map = {}
if admin_ids:
    ids = ",".join(admin_ids)
    # profiles-sem-coluna-email-v1
    profs = get(f"/rest/v1/profiles?select=id,full_name&id=in.({ids})")
    for p in profs or []:
        label = (p.get("full_name") or "").strip() or str(p.get("id", ""))[:8]
        name_map[str(p["id"])] = label

updated = 0
for m in matches:
    meta = dict(m.get("metadata") or {}) if isinstance(m.get("metadata"), dict) else {}
    aid = m.get("settled_by") or meta.get("settled_by") or (m.get("updated_by") if m.get("settled_at") else None)
    if not aid:
        continue
    name = name_map.get(str(aid)) or str(aid)[:8]
    need = False
    if not meta.get("settled_by_name"):
        need = True
    if not meta.get("settled_by"):
        need = True
    if not m.get("settled_by"):
        need = True
    if not need and meta.get("settled_by_name") == name:
        continue
    meta["settled_by"] = str(aid)
    meta["settled_by_name"] = name
    if m.get("settled_at") and not meta.get("settled_at"):
        meta["settled_at"] = m["settled_at"]
    body = {"metadata": meta, "settled_by": str(aid), "updated_by": str(aid)}
    try:
        patch(f"/rest/v1/matches?id=eq.{m['id']}", body)
        updated += 1
        print(f"  OK {m['id'][:8]}… → {name}")
    except Exception as e:
        print(f"  FAIL {m['id'][:8]}… {e}")

print(f"==> backfill: {updated} partida(s)")
PY
else
  echo "AVISO: SERVICE_ROLE_KEY não encontrada — pulando backfill"
  echo "  (export SUPABASE_SERVICE_ROLE_KEY=... e rode de novo, ou a UI resolve via profiles)"
fi

sleep 1
echo "OK — Encerrado por: <admin> na Gestão de Jogos"
echo "  Ctrl+Shift+R em https://arbishield.app/admin-jogos.html"
echo "  Novos encerres gravam settled_by + metadata.settled_by_name"
